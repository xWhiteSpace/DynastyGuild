// backend/src/api/liveRaid.routes.js
import { Router } from 'express';
import { getDatabase } from '../db/database.js';
import { discordClient } from '../discord-bot/client.js';
import crypto from 'crypto';
import {
  resolveWarRoomChannelIds,
  inferWarRoomRelationalIds,
  fetchVoiceChannelPresentUids
} from '../utils/warRoomResolver.js';
import { isDiscordCircuitOpen, getDiscordRateLimitStatus } from '../utils/discordRateLimit.js';
import {
  findCrossTabDuplicates,
  isSlotCoordKey,
} from '@guildname/shared/compositionTabs';
import { isTenantOfficer } from '../auth/officer.js';

const router = Router();

// Helper definitions for user token authentication
function resolveUserIdentity(req) {
  if (req.session?.user) return req.session.user;
  const mobileHeaderToken = req.headers['x-user-profile'];
  if (mobileHeaderToken) {
    try {
      const decodedPayload = JSON.parse(decodeURIComponent(mobileHeaderToken));
      if (decodedPayload && decodedPayload._sig) {
        const clientSignature = decodedPayload._sig;
        const profileToVerify = { ...decodedPayload };
        delete profileToVerify._sig;

        const tokenSigningSecret = process.env.DISCORD_CLIENT_SECRET || 'backup_fallback_secret_key';
        const expectedSignature = crypto
          .createHmac('sha256', tokenSigningSecret)
          .update(JSON.stringify(profileToVerify))
          .digest('hex');

        if (clientSignature === expectedSignature) {
          return profileToVerify;
        } else {
          console.error("🛑 [LIVE RAID INTERCEPT]: Detected forged header signature tamper attempt!");
        }
      }
    } catch (e) {
      console.error("Failed to parse mobile authorization header token:", e.message);
    }
  }
  return null;
}

function verifyDiscordOfficerRole(user, allowedRoles = []) {
  return isTenantOfficer(user, { adminRoles: allowedRoles }) || user?.isOfficer === true;
}

// Timezone End Timestamp Parser
function getPhase3EndTimestamp(eventDate, timezone, phase3) {
  const [year, month, day] = eventDate.split('-').map(Number);
  const [hours, minutes] = (phase3.timeEnd || "22:15").split(':').map(Number);
  
  let dayOffset = 0;
  const dayStart = parseInt(phase3.dayStart, 10) || 0;
  const dayEnd = parseInt(phase3.dayEnd, 10) || 0;
  if (dayEnd > dayStart) {
    dayOffset = dayEnd - dayStart;
  } else if (dayEnd < dayStart) {
    dayOffset = (dayEnd + 7) - dayStart;
  }

  // Establish target wall-clock parameters directly as an immutable UTC baseline frame
  const wallClockUtc = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  
  // Calculate the true timezone offset variance using native local string parsers
  let offsetMs = 0;
  try {
    const formatProxy = new Date(wallClockUtc.getTime());
    const tzString = formatProxy.toLocaleString("en-US", { timeZone: timezone });
    const tzParsed = new Date(tzString);
    offsetMs = tzParsed.getTime() - formatProxy.getTime();
  } catch (err) {
    console.error("Deterministic timezone structural offset parsing exception caught:", err);
  }

  // Shifting backwards via absolute numeric millisecond integers fixes runtime host drift completely
  let targetMs = wallClockUtc.getTime() - offsetMs;

  if (dayOffset > 0) {
    targetMs += dayOffset * 24 * 60 * 60 * 1000;
  }
  return targetMs;
}

async function loadWarRoomsCatalog(db) {
  const configSnap = await db.ref('settings/configuration').once('value');
  return configSnap.exists() ? (configSnap.val().warRooms || {}) : {};
}

async function normalizeLiveSessionWarRooms(db, session) {
  if (!session) return session;

  const warRooms = await loadWarRoomsCatalog(db);
  const sourceIdentifiers = [
    ...(session.selectedWarRoomIds || []),
    ...(session.selectedWarRooms || [])
  ];

  const resolvedChannelIds = resolveWarRoomChannelIds(sourceIdentifiers, warRooms);
  if (resolvedChannelIds.length === 0) return session;

  const hasLegacyWarRoomRefs = (session.selectedWarRooms || []).some(
    (id) => !/^\d{17,20}$/.test(String(id))
  );

  const normalizedSession = {
    ...session,
    selectedWarRooms: resolvedChannelIds,
    selectedWarRoomIds: session.selectedWarRoomIds?.length
      ? session.selectedWarRoomIds
      : inferWarRoomRelationalIds(session.selectedWarRooms || [], warRooms)
  };

  if (hasLegacyWarRoomRefs || !session.selectedWarRoomIds?.length) {
    await db.ref('attendance/live_session').update({
      selectedWarRooms: normalizedSession.selectedWarRooms,
      selectedWarRoomIds: normalizedSession.selectedWarRoomIds
    });
  }

  return normalizedSession;
}

async function pollLiveSessionVoicePresence(session) {
  const db = getDatabase();
  const warRooms = await loadWarRoomsCatalog(db);
  // Same SSOT resolution as Live UI / normalizeLiveSessionWarRooms — never poll only one field
  const sourceIdentifiers = [
    ...(session.selectedWarRoomIds || []),
    ...(session.selectedWarRooms || []),
  ];
  const channelIds = resolveWarRoomChannelIds(sourceIdentifiers, warRooms);
  if (channelIds.length === 0) {
    console.warn('[live-raid] pulse skipped VC scan — no Discord channel IDs resolved from session war rooms', {
      selectedWarRoomIds: session.selectedWarRoomIds || [],
      selectedWarRooms: session.selectedWarRooms || [],
    });
    return [];
  }
  return fetchVoiceChannelPresentUids(discordClient, channelIds);
}

/**
 * One voice-presence pulse: increment totalPulses and tally everyone currently in VC.
 */
async function runPulseOnce(pollIntervalMs, monitoringEndsAt) {
  if (isDiscordCircuitOpen()) {
    console.log('⏭️ [live-raid] Discord circuit open — skipping voice pulse.');
    return { stop: false, skipped: true };
  }

  const db = getDatabase();
  const activeSnap = await db.ref('attendance/live_session').once('value');
  if (!activeSnap.exists() || activeSnap.val().status !== 'Active') {
    return { stop: true, reason: 'inactive' };
  }

  let s = activeSnap.val();
  const endTs = monitoringEndsAt || s.monitoringEndsAt;
  if (endTs && Date.now() >= endTs) {
    console.log("⏰ Monitoring window ended. Auto-ending the Live Raid and archiving session.");
    // Auto-end: finalize + archive the raid exactly like the manual "End Raid"
    // control so officers never leave a session hanging open past its End Time.
    if (s.status === 'Active') {
      await endLiveRaidSessionInternal(s).catch((err) => {
        console.error('[live-raid] auto-end on window close failed:', err.message);
      });
    }
    return { stop: true, reason: 'ended' };
  }

  // Keep war room channel snowflakes in sync with Settings/DB before scanning VC
  s = await normalizeLiveSessionWarRooms(db, s);

  const now = Date.now();
  // Dedupe guard: ignore re-entry within half an interval (no hardcoded minute values)
  const minGapMs = Math.max(3000, Math.floor(pollIntervalMs / 2));
  if (s.lastVoicePoll?.timestamp && (now - s.lastVoicePoll.timestamp) < minGapMs) {
    return { stop: false, skipped: true };
  }

  const { totalPulses: nextTotalPulses, presentUserIds } = await applyPulseTally(db, s);

  console.log(
    `[live-raid] pulse #${nextTotalPulses} — present=${presentUserIds.length} channels=${(s.selectedWarRooms || []).length}`,
    presentUserIds
  );
  return { stop: false, pulse: nextTotalPulses, present: presentUserIds.length };
}

/**
 * Scan VC presence for the given (already war-room-normalized) session, increment
 * totalPulses, tally present members, and persist. Shared by the interval ticker
 * and the final capture pulse fired when an officer ends monitoring early.
 */
async function applyPulseTally(db, s) {
  const presentUserIds = await pollLiveSessionVoicePresence(s);
  const nextTotalPulses = (s.totalPulses || 0) + 1;
  const updatedTallies = { ...(s.userTallies || {}) };

  presentUserIds.forEach(uid => {
    updatedTallies[uid] = (updatedTallies[uid] || 0) + 1;
  });

  await db.ref('attendance/live_session').update({
    totalPulses: nextTotalPulses,
    userTallies: updatedTallies,
    lastVoicePoll: {
      timestamp: Date.now(),
      presentUids: presentUserIds,
      channelCount: (s.selectedWarRooms || []).length,
    },
  });

  return { totalPulses: nextTotalPulses, userTallies: updatedTallies, presentUserIds };
}

/**
 * Record one closing pulse when an officer ends the raid before the scheduled
 * monitoring end. Skipped if monitoring never started, or if a pulse was just
 * taken (dedupe guard) to avoid double-counting the same window.
 */
async function captureFinalMonitoringPulse(db, s) {
  const now = Date.now();
  const monStart = Number(s.monitoringStartsAt) || 0;
  if (!monStart || now < monStart) return s; // monitoring never started

  const pollIntervalMs = Math.max(15, Number(s.pollIntervalMinutes) || 15) * 60 * 1000;
  const minGapMs = Math.max(3000, Math.floor(pollIntervalMs / 2));
  if (s.lastVoicePoll?.timestamp && (now - s.lastVoicePoll.timestamp) < minGapMs) {
    return s; // a pulse was just recorded — don't double count
  }

  try {
    const normalized = await normalizeLiveSessionWarRooms(db, s);
    const { totalPulses, userTallies } = await applyPulseTally(db, normalized);
    console.log(`[live-raid] final capture pulse on early end — total=${totalPulses}`);
    return { ...normalized, totalPulses, userTallies };
  } catch (err) {
    console.error('[live-raid] final capture pulse failed:', err.message);
    return s;
  }
}

/**
 * Start the voice-presence polling ticker.
 * Fires one pulse immediately, then every pollIntervalMs.
 */
function startTicker(pollIntervalMs, monitoringEndsAt) {
  if (global.liveRaidIntervalTicker) {
    clearInterval(global.liveRaidIntervalTicker);
    global.liveRaidIntervalTicker = undefined;
  }

  let pulseInFlight = false;
  const tick = async () => {
    if (pulseInFlight) return;
    pulseInFlight = true;
    try {
      const result = await runPulseOnce(pollIntervalMs, monitoringEndsAt);
      if (result.stop) {
        if (global.liveRaidIntervalTicker) {
          clearInterval(global.liveRaidIntervalTicker);
          global.liveRaidIntervalTicker = undefined;
        }
      }
    } catch (err) {
      console.error("⚠️ Ticker error:", err.message);
    } finally {
      pulseInFlight = false;
    }
  };

  // Immediate first pulse — do not wait a full interval (was causing 0 pulses on short windows)
  tick();
  global.liveRaidIntervalTicker = setInterval(tick, pollIntervalMs);
}

/** Clear existing tickers, then start or schedule monitoring based on start/end times.
 *  Writes monitoringTickerStatus to Firebase so the UI can show armed/scheduled/ended from DB.
 */
function armMonitoringSchedule(startsAt, endsAt, intervalMins) {
  const db = getDatabase();

  if (global.liveRaidIntervalTicker) {
    clearInterval(global.liveRaidIntervalTicker);
    global.liveRaidIntervalTicker = undefined;
  }
  if (global.monitoringSchedulerTicker) {
    clearInterval(global.monitoringSchedulerTicker);
    global.monitoringSchedulerTicker = undefined;
  }

  const safeIntervalMins = Math.max(15, Number(intervalMins) || 15);
  const pollIntervalMs = safeIntervalMins * 60 * 1000;
  const now = Date.now();

  if (now >= endsAt) {
    console.log(`⏹  Monitoring window already ended (now=${now}, endsAt=${endsAt}) — not starting ticker.`);
    db.ref('attendance/live_session').update({
      monitoringTickerStatus: 'ended',
      monitoringTickerNote: 'Window already ended when armed — no pulses will be recorded.',
    }).catch(() => {});
    return { armed: false, reason: 'ended' };
  }

  if (now >= startsAt) {
    console.log(`▶️  Monitoring start reached — starting ticker (interval=${safeIntervalMins}m).`);
    db.ref('attendance/live_session').update({
      monitoringTickerStatus: 'running',
      monitoringTickerNote: `Ticker started at ${new Date().toISOString()}`,
    }).catch(() => {});
    startTicker(pollIntervalMs, endsAt);
    return { armed: true, reason: 'running' };
  }

  console.log(`⏳ Scheduling monitoring ticker for ${new Date(startsAt).toISOString()} (interval=${safeIntervalMins}m)`);
  db.ref('attendance/live_session').update({
    monitoringTickerStatus: 'scheduled',
    monitoringTickerNote: `Waiting until ${new Date(startsAt).toISOString()}`,
  }).catch(() => {});

  global.monitoringSchedulerTicker = setInterval(() => {
    if (Date.now() >= startsAt) {
      console.log(`▶️  Monitoring start time reached — starting ticker.`);
      clearInterval(global.monitoringSchedulerTicker);
      global.monitoringSchedulerTicker = undefined;
      if (Date.now() < endsAt) {
        db.ref('attendance/live_session').update({
          monitoringTickerStatus: 'running',
          monitoringTickerNote: `Ticker started at ${new Date().toISOString()}`,
        }).catch(() => {});
        startTicker(pollIntervalMs, endsAt);
      } else {
        db.ref('attendance/live_session').update({
          monitoringTickerStatus: 'ended',
          monitoringTickerNote: 'Start reached but end already passed.',
        }).catch(() => {});
      }
    }
  }, 15 * 1000);

  return { armed: true, reason: 'scheduled' };
}

/**
 * Restart-safe backstop for auto-ending a Live Raid at its End Time.
 * Independent of the in-memory ticker: if an Active session's monitoring window
 * has elapsed, archive it just like the manual "End Raid" control. Safe to call
 * repeatedly (idempotent via the status === 'Active' guard).
 */
export async function maybeAutoEndLiveRaid() {
  try {
    const db = getDatabase();
    const snap = await db.ref('attendance/live_session').once('value');
    if (!snap.exists()) return;

    const s = snap.val();
    if (s.status !== 'Active') return;
    if (!s.monitoringEndsAt || Date.now() < Number(s.monitoringEndsAt)) return;

    console.log('[live-raid] Auto-end backstop: monitoring End Time reached — archiving session.');
    await endLiveRaidSessionInternal(s);
  } catch (err) {
    console.error('[live-raid] maybeAutoEndLiveRaid failed:', err.message);
  }
}

/**
 * Re-arm monitoring after backend restart if an Active live_session still has a schedule.
 * Tickers live only in memory — without this, pulses stop permanently after a restart.
 */
export async function resumeLiveRaidMonitoringIfNeeded() {
  try {
    const db = getDatabase();
    const snap = await db.ref('attendance/live_session').once('value');
    if (!snap.exists() || snap.val().status !== 'Active') return;

    const s = snap.val();
    if (!s.monitoringStartsAt || !s.monitoringEndsAt || !s.pollIntervalMinutes) {
      console.log('[live-raid] Active session found but no monitoring schedule — nothing to resume.');
      return;
    }
    if (Date.now() > s.monitoringEndsAt) {
      console.log('[live-raid] Active session monitoring window already ended while offline — auto-ending + archiving now.');
      await endLiveRaidSessionInternal(s).catch((err) => {
        console.error('[live-raid] auto-end on boot failed:', err.message);
      });
      return;
    }

    console.log('[live-raid] Resuming monitoring ticker from active live_session…');
    armMonitoringSchedule(s.monitoringStartsAt, s.monitoringEndsAt, s.pollIntervalMinutes);
  } catch (err) {
    console.error('[live-raid] Failed to resume monitoring:', err.message);
  }
}

function parseMonitoringFields(body = {}) {
  const { monitoringStartsAt, monitoringEndsAt, pollIntervalMinutes } = body;
  if (monitoringStartsAt == null && monitoringEndsAt == null && pollIntervalMinutes == null) {
    return { ok: true, monitoring: null };
  }
  if (monitoringStartsAt == null || monitoringEndsAt == null || pollIntervalMinutes == null) {
    return { ok: false, error: 'monitoringStartsAt, monitoringEndsAt, and pollIntervalMinutes are all required when setting monitoring.' };
  }
  const startsAt = Number(monitoringStartsAt);
  const endsAt = Number(monitoringEndsAt);
  const intervalMins = Math.max(15, Number(pollIntervalMinutes));
  if (isNaN(startsAt) || isNaN(endsAt) || isNaN(intervalMins) || intervalMins < 15) {
    return { ok: false, error: 'Invalid monitoring time values. pollIntervalMinutes must be at least 15.' };
  }
  if (endsAt <= startsAt) {
    return { ok: false, error: 'monitoringEndsAt must be after monitoringStartsAt.' };
  }
  return {
    ok: true,
    monitoring: {
      monitoringStartsAt: startsAt,
      monitoringEndsAt: endsAt,
      pollIntervalMinutes: intervalMins,
    },
  };
}

// Internal end live raid handler
async function endLiveRaidSessionInternal(s) {
  const db = getDatabase();
  
  if (global.liveRaidIntervalTicker) {
    clearInterval(global.liveRaidIntervalTicker);
    global.liveRaidIntervalTicker = undefined;
  }
  if (global.monitoringSchedulerTicker) {
    clearInterval(global.monitoringSchedulerTicker);
    global.monitoringSchedulerTicker = undefined;
  }

  // --- Early-end handling: capture a closing pulse + recompute the effective window ---
  const now = Date.now();
  const monStart = Number(s.monitoringStartsAt) || 0;
  const monEnd = Number(s.monitoringEndsAt) || 0;
  const intervalMins = Number(s.pollIntervalMinutes) || 0;
  const monitoringStarted = monStart > 0 && now >= monStart;
  const endedEarly = monitoringStarted && monEnd > 0 && now < monEnd;

  // Ending mid-window: record the final headcount so no pulses are lost.
  if (endedEarly) {
    s = await captureFinalMonitoringPulse(db, s);
  }

  const totalPulses = parseInt(s.totalPulses, 10) || 0;

  // Effective end = the earlier of the scheduled end or the actual stop time.
  const effectiveMonitoringEndsAt = monitoringStarted
    ? (monEnd > 0 ? Math.min(monEnd, now) : now)
    : null;

  // Expected pulses recomputed from the ACTUAL monitored duration (not the full schedule).
  let expectedPulses = 0;
  if (monitoringStarted && intervalMins > 0 && effectiveMonitoringEndsAt) {
    const durationMs = Math.max(0, effectiveMonitoringEndsAt - monStart);
    expectedPulses = Math.max(1, Math.round(durationMs / (intervalMins * 60 * 1000)));
  }

  const membersSnap = await db.ref('auction/members').once('value');
  const membersData = membersSnap.exists() ? membersSnap.val() : {};

  const excusedUids = [];
  const commitmentsSnap = await db.ref('attendance/commitments').once('value');
  const eventCommitmentsKey = `${s.eventDate}_${s.eventKey}`;
  let commitmentsData = {};
  if (commitmentsSnap.exists() && commitmentsSnap.val()[eventCommitmentsKey]) {
    commitmentsData = commitmentsSnap.val()[eventCommitmentsKey];
    Object.entries(commitmentsData).forEach(([uid, commitment]) => {
      if (commitment.status === 'Leave') {
        excusedUids.push(uid);
      }
    });
  }

  const gridAssignedUids = new Set();
  if (s.grids) {
    Object.values(s.grids).forEach(grid => {
      if (grid.slots_allocation) {
        Object.entries(grid.slots_allocation).forEach(([coord, slot]) => {
          if (!coord.startsWith("meta_") && !coord.startsWith("party_name_") && slot?.userId) {
            gridAssignedUids.add(slot.userId);
          }
        });
      }
    });
  }

  const atomicUpdates = {};
  const sessionHistoryId = db.ref('attendance/history').push().key;

  const configSnap = await db.ref('settings/configuration').once('value');
  const systemThreshold = configSnap.exists() ? (parseInt(configSnap.val().attendancePresentThreshold, 10) || 75) : 75;

  // Collect only non-None commitments → flat uid:status map stored inside session_archive
  const commitments = {};
  Object.keys(membersData).forEach(uid => {
    const status = commitmentsData[uid]?.status;
    if (status === 'Confirmed' || status === 'Leave') {
      commitments[uid] = status;
    }
  });

  atomicUpdates[`attendance/session_archive/${sessionHistoryId}`] = {
    id: sessionHistoryId,
    eventDate: s.eventDate,
    eventTitle: s.eventTitle,
    eventKey: s.eventKey,
    committedBy: s.launchedBy || "System",
    totalPulses: totalPulses,
    expectedPulses,
    grids: s.grids || {},
    selectedWarRooms: s.selectedWarRooms || [],
    selectedWarRoomIds: s.selectedWarRoomIds || [],
    userTallies: s.userTallies || {},
    commitments,
    monitoringStartsAt: monStart || null,
    monitoringEndsAt: monEnd || null,
    pollIntervalMinutes: intervalMins || null,
    effectiveMonitoringEndsAt: effectiveMonitoringEndsAt || null,
    endedEarly,
    endedAt: now
  };

  atomicUpdates['attendance/live_session'] = null;
  await db.ref().update(atomicUpdates);
}

// Endpoints
router.get('/session', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });

  try {
    const db = getDatabase();
    const sessionSnap = await db.ref('attendance/live_session').once('value');
    if (!sessionSnap.exists()) {
      return res.json({ success: true, session: null });
    }

    const s = sessionSnap.val();
    
    const normalizedSession = await normalizeLiveSessionWarRooms(db, s);
    return res.json({ success: true, session: normalizedSession });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/create', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const allowedRoles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!verifyDiscordOfficerRole(user, allowedRoles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const activeSnap = await db.ref('attendance/live_session').once('value');
    if (activeSnap.exists()) {
      return res.status(400).json({ success: false, error: 'An active Live Raid session is already running.' });
    }

    const {
      publishedId,
      selectedWarRooms: selectedWarRoomIds,
      monitoringStartsAt,
      monitoringEndsAt,
      pollIntervalMinutes,
    } = req.body;

    if (!publishedId || !selectedWarRoomIds?.length) {
      return res.status(400).json({
        success: false,
        error: 'Select an Active Composition and at least one war room.',
      });
    }

    const settingsObj = configSnap.exists() ? configSnap.val() : {};
    const resolvedWarRoomChannelIds = resolveWarRoomChannelIds(
      selectedWarRoomIds,
      settingsObj.warRooms || {}
    );

    if (resolvedWarRoomChannelIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid Discord war room channels resolved. Map voice channel IDs in Settings.'
      });
    }

    const publishedSnap = await db.ref(`attendance/published/${publishedId}`).once('value');
    if (!publishedSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Active composition not found.' });
    }
    const published = publishedSnap.val();
    const gridsPayload = published.grids || {};
    const selectedGridIds = Array.isArray(published.selectedGridIds) && published.selectedGridIds.length > 0
      ? published.selectedGridIds
      : Object.keys(gridsPayload);
    if (selectedGridIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Selected composition has no Grid Tabs.' });
    }

    const duplicates = findCrossTabDuplicates(gridsPayload);
    if (duplicates.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot start Live Raid: composition has ${duplicates.length} member(s) assigned in multiple Grid Tabs.`,
        duplicates,
      });
    }

    const parsedMon = parseMonitoringFields({ monitoringStartsAt, monitoringEndsAt, pollIntervalMinutes });
    if (!parsedMon.ok) {
      return res.status(400).json({ success: false, error: parsedMon.error });
    }

    const eventKey = published.eventKey;
    const eventDate = published.eventDate;
    const eventTitle = published.eventTitle || published.eventKey || 'Raid Session';
    const configId = published.configId || selectedGridIds[0];

    // Firebase RTDB drops null keys — only include monitoring fields when set
    const sessionPayload = {
      status: 'Active',
      launchedBy: user.displayName || user.username || 'Officer',
      startedAt: Date.now(),
      publishedId,
      eventKey,
      eventDate,
      eventTitle,
      selectedConfigId: configId,
      selectedConfigIds: selectedGridIds,
      selectedWarRoomIds,
      selectedWarRooms: resolvedWarRoomChannelIds,
      grids: gridsPayload,
      totalPulses: 0,
      userTallies: {},
      version: 2,
      ...(parsedMon.monitoring || {}),
    };

    await db.ref('attendance/live_session').set(sessionPayload);

    if (parsedMon.monitoring) {
      const armResult = armMonitoringSchedule(
        parsedMon.monitoring.monitoringStartsAt,
        parsedMon.monitoring.monitoringEndsAt,
        parsedMon.monitoring.pollIntervalMinutes
      );
      console.log('[live-raid] create wrote monitoring to attendance/live_session:', parsedMon.monitoring, armResult);
    } else {
      console.log('[live-raid] create wrote attendance/live_session WITHOUT monitoring fields (none provided in request body)');
    }

    return res.json({ success: true, session: sessionPayload, path: 'attendance/live_session' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/update', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const allowedRoles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!verifyDiscordOfficerRole(user, allowedRoles)) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }

    const { session } = req.body;
    if (!session) return res.status(400).json({ success: false, error: 'Missing session parameters.' });

    if (session.grids) {
      // Treat live grids as tabs for uniqueness validation
      const tabShape = {};
      Object.entries(session.grids).forEach(([gridId, grid]) => {
        tabShape[gridId] = { slots_allocation: grid?.slots_allocation || {} };
      });
      const duplicates = findCrossTabDuplicates(tabShape);
      if (duplicates.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Cross-tab duplicate members detected (${duplicates.length}).`,
          duplicates,
        });
      }
    }

    await db.ref('attendance/live_session').update(session);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/cell-update', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const allowedRoles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];
    if (!verifyDiscordOfficerRole(user, allowedRoles)) {
      return res.status(403).json({ success: false, error: 'Officer access required' });
    }
    const { configId, coordKey, userId } = req.body;
    if (!configId || !coordKey) {
      return res.status(400).json({ success: false, error: 'Missing configId or coordKey.' });
    }

    const sessionSnap = await db.ref('attendance/live_session').once('value');
    if (!sessionSnap.exists()) {
      return res.status(404).json({ success: false, error: 'No active live session.' });
    }

    const session = sessionSnap.val();
    const grids = session.grids || {};
    if (!grids[configId]) {
      return res.status(404).json({ success: false, error: 'Grid Tab not found in live session.' });
    }

    const updates = {};

    // Cross-tab move: clear this uid from every grid first
    if (userId) {
      Object.entries(grids).forEach(([gridId, gridObj]) => {
        const alloc = gridObj?.slots_allocation || {};
        Object.entries(alloc).forEach(([key, slot]) => {
          if (!isSlotCoordKey(key)) return;
          if (slot?.userId === userId && !(gridId === configId && key === coordKey)) {
            updates[`attendance/live_session/grids/${gridId}/slots_allocation/${key}/userId`] = '';
          }
        });
      });
    }

    updates[`attendance/live_session/grids/${configId}/slots_allocation/${coordKey}/userId`] = userId || '';

    await db.ref().update(updates);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/voice-presence', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });

  try {
    const channelsParam = req.query.channels || '';
    const channelIdentifiers = channelsParam.split(',').filter(Boolean);
    const db = getDatabase();
    const warRooms = await loadWarRoomsCatalog(db);
    const resolvedChannelIds = resolveWarRoomChannelIds(channelIdentifiers, warRooms);
    if (isDiscordCircuitOpen()) {
      const status = getDiscordRateLimitStatus();
      return res.status(503).json({
        success: false,
        error: `Discord is temporarily blocking this server IP. Try again after ${status.untilHuman || status.remainingHuman}.`,
        presentUids: [],
      });
    }

    const presentUserIds = await fetchVoiceChannelPresentUids(discordClient, resolvedChannelIds);

    return res.json({ success: true, presentUids: presentUserIds });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/end', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const allowedRoles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!verifyDiscordOfficerRole(user, allowedRoles)) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }

    const sessionSnap = await db.ref('attendance/live_session').once('value');
    if (!sessionSnap.exists()) {
      return res.status(400).json({ success: false, error: 'No active Live Raid session found.' });
    }

    const s = sessionSnap.val();
    await endLiveRaidSessionInternal(s);

    return res.json({ success: true, message: 'Live Raid ended and archived successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/cancel', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const allowedRoles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!verifyDiscordOfficerRole(user, allowedRoles)) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }

    if (global.liveRaidIntervalTicker) {
      clearInterval(global.liveRaidIntervalTicker);
      global.liveRaidIntervalTicker = undefined;
    }

    await db.ref('attendance/live_session').set(null);
    return res.json({ success: true, message: 'Live Raid session terminated and cleared without archiving.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/history/:sessionId', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });
  if (!user.isOfficer) return res.status(403).json({ success: false, error: 'Officer access required' });

  const { sessionId } = req.params;
  if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId is required' });

  try {
    const db = getDatabase();
    await db.ref(`attendance/session_archive/${sessionId}`).remove();
    return res.json({ success: true, message: `Session ${sessionId} deleted.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/live-raid/history/:sessionId/in-game
 * Officer toggle: confirm/unconfirm that a member was present in-game for this archived session.
 * Writes attendance/session_archive/{sessionId}/inGameStatus/{userId} = true | null
 */
router.patch('/history/:sessionId/in-game', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });
  if (!user.isOfficer) return res.status(403).json({ success: false, error: 'Officer access required' });

  const { sessionId } = req.params;
  const { userId, confirmed } = req.body || {};
  if (!sessionId || !userId) {
    return res.status(400).json({ success: false, error: 'sessionId and userId are required' });
  }

  try {
    const db = getDatabase();
    const sessionRef = db.ref(`attendance/session_archive/${sessionId}`);
    const sessionSnap = await sessionRef.once('value');
    if (!sessionSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Session archive not found' });
    }

    const flagValue = confirmed === true ? true : null;
    await db.ref(`attendance/session_archive/${sessionId}/inGameStatus/${userId}`).set(flagValue);
    return res.json({ success: true, confirmed: flagValue === true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/history/all', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });

  try {
    const db = getDatabase();
    const archiveSnap = await db.ref('attendance/session_archive').once('value');
    return res.json({
      success: true,
      sessions: archiveSnap.exists() ? archiveSnap.val() : {},
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Set Monitoring Time ──────────────────────────────────────────────────────
router.post('/set-monitoring-time', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const allowedRoles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!verifyDiscordOfficerRole(user, allowedRoles)) {
      return res.status(403).json({ success: false, error: 'Officer access required' });
    }

    const parsedMon = parseMonitoringFields(req.body);
    if (!parsedMon.ok) {
      return res.status(400).json({ success: false, error: parsedMon.error });
    }
    if (!parsedMon.monitoring) {
      return res.status(400).json({ success: false, error: 'monitoringStartsAt, monitoringEndsAt, and pollIntervalMinutes are required.' });
    }

    const { monitoringStartsAt: startsAt, monitoringEndsAt: endsAt, pollIntervalMinutes: intervalMins } = parsedMon.monitoring;

    const activeSnap = await db.ref('attendance/live_session').once('value');
    if (!activeSnap.exists() || activeSnap.val().status !== 'Active') {
      return res.status(400).json({ success: false, error: 'No active Live Raid session found.' });
    }

    const monitoringPatch = {
      monitoringStartsAt: startsAt,
      monitoringEndsAt: endsAt,
      pollIntervalMinutes: intervalMins,
    };

    // Exact Firebase path: attendance/live_session/{monitoringStartsAt|monitoringEndsAt|pollIntervalMinutes}
    await db.ref('attendance/live_session').update(monitoringPatch);

    // Read-back confirmation (proves the write landed in this DB)
    const verifySnap = await db.ref('attendance/live_session').once('value');
    const verified = verifySnap.val() || {};
    console.log('[live-raid] monitoring written to attendance/live_session:', {
      monitoringStartsAt: verified.monitoringStartsAt,
      monitoringEndsAt: verified.monitoringEndsAt,
      pollIntervalMinutes: verified.pollIntervalMinutes,
    });

    if (verified.monitoringStartsAt !== startsAt) {
      return res.status(500).json({
        success: false,
        error: 'Monitoring write did not persist to Firebase. Check FIREBASE_DATABASE_URL matches the console you are viewing.',
      });
    }

    const armResult = armMonitoringSchedule(startsAt, endsAt, intervalMins);
    if (armResult?.reason === 'ended') {
      return res.status(400).json({
        success: false,
        error: 'Monitoring end time is already in the past — ticker was not started. Set a future end time.',
        path: 'attendance/live_session',
        monitoringStartsAt: verified.monitoringStartsAt,
        monitoringEndsAt: verified.monitoringEndsAt,
        pollIntervalMinutes: verified.pollIntervalMinutes,
        monitoringTickerStatus: 'ended',
      });
    }

    return res.json({
      success: true,
      path: 'attendance/live_session',
      monitoringStartsAt: verified.monitoringStartsAt,
      monitoringEndsAt: verified.monitoringEndsAt,
      pollIntervalMinutes: verified.pollIntervalMinutes,
      monitoringTickerStatus: armResult?.reason || 'unknown',
    });
  } catch (err) {
    console.error('[live-raid] set-monitoring-time failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
