// backend/src/api/attendance.routes.js
import { Router } from 'express';
import { getDatabase } from '../db/database.js';
import { getGateStatusDetails } from '../config/timeWindow.js';
import { discordClient } from '../discord-bot/client.js';
import { isDiscordCircuitOpen, enqueueDiscordCall } from '../utils/discordRateLimit.js';
import crypto from 'crypto';
import { ensureWeekInstances, getWeekInstances } from '../services/scheduleService.js';
import {
  applyAttendanceDecision,
  AttendanceDecisionError,
  getDefaultLeaveCredits,
} from '../services/attendanceDecision.js';
import {
  normalizeComposition,
  compositionForPersist,
  findCrossTabDuplicates,
  buildLiveGridsFromComposition,
} from '@guildname/shared/compositionTabs';
import { getCurrentTenantId } from '../db/tenantContext.js';
import { discordChannel } from '../db/channels.js';
import { checkOfficer } from '../auth/officer.js';

const router = Router();

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
          console.error("🛑 [API ROUTE INTERCEPT]: Detected forged header signature tamper attempt!");
        }
      }
    } catch (e) {
      console.error("Failed to parse mobile authorization header token:", e.message);
    }
  }
  return null;
}

async function verifyDiscordOfficerRole(req, allowedRoles = []) {
  const { user, ok } = await checkOfficer(req, { adminRoles: allowedRoles });
  return Boolean(user && ok);
}

// 🚪 POST /api/attendance/vanish -> Bot-Driven Server Eviction Gate
router.post('/vanish', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const { targetUid } = req.body;
    if (!targetUid) return res.status(400).json({ success: false, error: 'Missing user ID parameter.' });

    // 1. Best-effort kick off the active Discord Server Guild. This is NON-FATAL:
    // the bot often lacks Kick permission (or the target outranks it), and that
    // must never block the database purge below. Dummies are placeholder-only
    // (no Discord identity) so we skip the kick entirely.
    const isDummyTarget = targetUid.startsWith('dummy_');
    let kicked = false;
    if (!isDummyTarget && discordClient && discordClient.isReady() && !isDiscordCircuitOpen()) {
      try {
        const guild = discordClient.guilds.cache.get(getCurrentTenantId());
        const member = guild?.members?.cache.get(targetUid);
        if (member) {
          await enqueueDiscordCall(() =>
            member.kick('Vanished from guild via administrative dashboard web request')
          );
          kicked = true;
        }
      } catch (kickErr) {
        console.warn(`⚠️ [VANISH]: Discord kick skipped for ${targetUid} (proceeding with DB purge):`, kickErr.message);
      }
    }

    // 2. ALWAYS clear the identity record from the cloud nodes, regardless of kick outcome.
    await db.ref(`auction/members/${targetUid}`).remove();

    const kickNote = isDummyTarget
      ? 'Dummy placeholder record purged from the database.'
      : kicked
        ? 'Discord server kick completed and database profile record purged.'
        : 'Database profile record purged. Discord kick was skipped or not permitted (bot lacks permission or member already gone).';
    return res.json({ success: true, kicked, message: kickNote });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ✍️ POST /api/attendance/update-roster-status -> Atomic Property Updates
router.post('/update-roster-status', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }

    const { targetUid, updates } = req.body;
    if (!targetUid || !updates) return res.status(400).json({ success: false, error: 'Missing tracking payloads.' });

    await db.ref(`auction/members/${targetUid}`).update(updates);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🟢 GET /api/attendance/active-session
router.get('/active-session', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication token missing' });

  try {
    const db = getDatabase();
    const sessionSnap = await db.ref('attendance/active_session').once('value');
    return res.json({ success: true, session: sessionSnap.exists() ? snapshot.val() : null });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ⚔️ POST /api/attendance/begin-raid
router.post('/begin-raid', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Action restricted to authorized Officers.' });
    }

    const { initialGrid } = req.body;
    const sessionPayload = {
      status: 'Active',
      launchedBy: user.displayName || user.username,
      startedAt: Date.now(),
      gridTopology: initialGridStructure || { columns: 8, rows: 5 },
      checksPresent: 0
    };

    // Define an in-memory or single state node tracker to eliminate DB limit exhaustion
    sessionPayload.totalPulses = 0;
    sessionPayload.userTallies = {};

    await db.ref('attendance/active_session').set(sessionPayload);

    const pollIntervalMs = 15 * 60 * 1000; // 15-minute floor to avoid Discord REST pressure

    // Initialize the low-overhead synchronous connection-state polling routine
    if (global.attendanceIntervalTicker) clearInterval(global.attendanceIntervalTicker);
    
    global.attendanceIntervalTicker = setInterval(async () => {
      try {
        if (isDiscordCircuitOpen()) return;

        const activeSnap = await db.ref('attendance/active_session').once('value');
        if (!activeSnap.exists() || activeSnap.val().status !== 'Active') {
          return clearInterval(global.attendanceIntervalTicker);
        }

        const currentSession = activeSnap.val();
        const nextTotalPulses = (currentSession.totalPulses || 0) + 1;
        const updatedTallies = currentSession.userTallies || {};

        const whitelistedRooms = [
          discordChannel('DISCORD_WARROOM_ID_1'),
          discordChannel('DISCORD_WARROOM_ID_2'),
          discordChannel('DISCORD_WARROOM_ID_3'),
          discordChannel('DISCORD_WARROOM_ID_4'),
          discordChannel('DISCORD_WARROOM_ID_5')
        ].filter(Boolean);

        const { fetchVoiceChannelPresentUids } = await import('../utils/warRoomResolver.js');
        const presentUserIds = await fetchVoiceChannelPresentUids(discordClient, whitelistedRooms);

        presentUserIds.forEach(uid => {
          updatedTallies[uid] = (updatedTallies[uid] || 0) + 1;
        });

        await db.ref('attendance/active_session').update({
          checksPresent: nextTotalPulses,
          userTallies: updatedTallies
        });
      } catch (loopErr) {
        console.error("⚠️ Presence polling ticker exception caught:", loopTargetMin.message);
      }
    }, pollIntervalMs);

    return res.json({ success: true, message: 'Live Raid active. Polling initialized.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🛑 POST /api/attendance/end-raid
router.post('/end-raid', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication token missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const sessionSnap = await db.ref('attendance/active_session').once('value');
    if (!sessionSnap.exists()) {
      return res.status(400).json({ success: false, error: 'No active streaming session to commit.' });
    }

    const s = sessionSnap.val();
    const totalPulses = parseInt(s.checksPresent, 10) || 0;

    // Kill the background execution timer loop instantly
    if (global.attendanceIntervalTicker) {
      clearInterval(global.attendanceIntervalTicker);
      global.attendanceIntervalTicker = undefined;
    }

    const membersSnap = await db.ref('auction/members').once('value');
    const membersData = membersSnap.exists() ? membersSnap.val() : {};
    
    const { compositionMatrix = {}, excusedUids = [] } = req.body;
    const timestampDate = new Date().toLocaleDateString("en-US", { timeZone: configSnap.exists() ? (configSnap.val().timezone || "Asia/Manila") : "Asia/Manila" });

    const atomicUpdates = {};
    const sessionHistoryId = db.ref('attendance/history').push().key;

    // Collect non-None commitments as a flat uid:status map
    const commitments = {};
    if (Array.isArray(excusedUids)) {
      excusedUids.forEach(uid => { commitments[uid] = 'Leave'; });
    }

    // Archive overall layout metadata cleanly
    atomicUpdates[`attendance/session_archive/${sessionHistoryId}`] = {
      id: sessionHistoryId,
      date: timestampDate,
      committedBy: user.displayName || user.username,
      totalPulses: totalPulses,
      finalComposition: compositionMatrix,
      commitments,
    };

    // 🧼 Sandbox Cleansing: Permanently clear scratchpad nodes
    atomicUpdates['attendance/active_session'] = null;

    await db.ref().update(atomicUpdates);
    return res.json({ success: true, message: 'Raid session successfully finalized and archived to Firebase.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 📊 POST /api/attendance/update-job-target -> Save Recruitment Goals
router.post('/update-job-target', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const { jobCode, desiredCount } = req.body;
    if (!jobCode) return res.status(400).json({ success: false, error: 'Missing required jobCode parameter.' });

    // Commit the parameter straight into the global SSOT settings tree
    await db.ref(`settings/configuration/jobs/${jobCode}/desiredCount`).set(parseInt(desiredCount, 10) || 0);
    return res.json({ success: true, message: 'Recruitment benchmark updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🎯 POST /api/attendance/update-expected-rate -> Save the guild-wide expected attendance target (%)
router.post('/update-expected-rate', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const parsed = parseInt(req.body?.expectedAttendanceRate, 10);
    if (isNaN(parsed)) {
      return res.status(400).json({ success: false, error: 'expectedAttendanceRate must be a number (0-100).' });
    }
    const clampedRate = Math.max(0, Math.min(100, parsed));

    await db.ref('settings/configuration/expectedAttendanceRate').set(clampedRate);
    return res.json({ success: true, expectedAttendanceRate: clampedRate });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/attendance/deploy-card — same Send as /api/deploy-attendance-card (session-auth)
router.get('/deploy-card', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];
    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const { deployPublicAttendanceCardToWarAnnounce } = await import('../services/discordAttendanceCards.js');
    const result = await deployPublicAttendanceCardToWarAnnounce();
    return res.json({ success: true, result });
  } catch (err) {
    const msg = err.message || 'Failed to deploy attendance card.';
    const status = /not configured/i.test(msg) ? 400
      : /offline|rate-limited|temporarily blocking/i.test(msg) ? 503
      : /locate the war-announce/i.test(msg) ? 404
      : 500;
    return res.status(status).json({ success: false, error: msg });
  }
});

// GET /api/attendance/deploy-party-card
router.get('/deploy-party-card', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];
    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const { deployPublicPartyCardToWarAnnounce } = await import('../services/partyViewer.js');
    const result = await deployPublicPartyCardToWarAnnounce();
    return res.json({ success: true, result });
  } catch (err) {
    const msg = err.message || 'Failed to deploy party card.';
    const status = /not configured/i.test(msg) ? 400
      : /offline|rate-limited|temporarily blocking/i.test(msg) ? 503
      : /locate the war-announce/i.test(msg) ? 404
      : 500;
    return res.status(status).json({ success: false, error: msg });
  }
});

// 📢 POST /api/attendance/announce-week -> Officer-triggered Attendance card (replaces weekly thread)
router.post('/announce-week', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const channelId = discordChannel('DISCORD_WARANNOUNCE_CHANNEL_ID');
    if (!channelId) {
      return res.status(400).json({ success: false, error: 'DISCORD_WARANNOUNCE_CHANNEL_ID is not configured.' });
    }
    if (!discordClient || !discordClient.isReady()) {
      return res.status(503).json({ success: false, error: 'Discord bot client is offline.' });
    }
    const targetChannel = await enqueueDiscordCall(() => discordClient.channels.fetch(channelId));
    if (!targetChannel) {
      return res.status(404).json({ success: false, error: 'War-announce channel not found.' });
    }
    const { sendPublicAttendanceCard } = await import('../services/discordAttendanceCards.js');
    const result = await sendPublicAttendanceCard(targetChannel);
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 📅 POST /api/attendance/ensure-week -> Materialize scheduler/instances for a week
router.post('/ensure-week', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const { weekMonday, force } = req.body || {};
    const result = await ensureWeekInstances({
      weekMonday: weekMonday || undefined,
      force: force === true,
    });
    return res.json({
      success: true,
      weekMonday: result.weekMonday,
      instances: result.instances,
      timezone: result.timezone,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 📅 GET /api/attendance/week-instances -> Read materialized week (auto-ensure if empty)
router.get('/week-instances', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const weekMonday = req.query.weekMonday || undefined;
    const result = await getWeekInstances(weekMonday);
    return res.json({
      success: true,
      weekMonday: result.weekMonday,
      instances: result.instances,
      timezone: result.timezone,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 📅 GET /api/attendance/commitments -> Live RSVP tree (Admin SDK; works when client RTDB rules block)
router.get('/commitments', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const snap = await db.ref('attendance/commitments').once('value');
    return res.json({
      success: true,
      commitments: snap.exists() ? snap.val() : {},
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 📅 POST /api/attendance/commit-availability -> Log Raider Presence/Leave
router.post('/commit-availability', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const { dateStr, eventId, status } = req.body;
    if (!dateStr || !eventId || !status) {
      return res.status(400).json({ success: false, error: 'Missing scheduling configuration vectors.' });
    }

    const result = await applyAttendanceDecision({
      userId: user.id,
      displayName: user.displayName || user.username || 'Unknown Raider',
      dateStr,
      eventId,
      status,
    });

    if (result.removed) {
      return res.json({
        success: true,
        message: 'Schedule commitment removed successfully.',
        leaveCreditsRemaining: result.leaveCreditsRemaining,
      });
    }
    return res.json({
      success: true,
      message: 'Schedule commitment logged.',
      leaveCreditsRemaining: result.leaveCreditsRemaining,
    });
  } catch (err) {
    if (err instanceof AttendanceDecisionError) {
      return res.status(400).json({ success: false, error: err.message, code: err.code });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 📅 GET /api/attendance/special-events -> Retrieve Ad-Hoc Special Instances
router.get('/special-events', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const snap = await db.ref('scheduler/special_events').once('value');
    return res.json({ success: true, specialEvents: snap.exists() ? snap.val() : {} });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ➕ POST /api/attendance/special-events/add -> Authorize & Save Ad-Hoc Instances
router.post('/special-events/add', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];
    
    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const { title, description, date, dateEnd, timeStart, timeEnd, type, isAttendanceTracked, daysOfWeek, allDay } = req.body;
    if (!title || !date || !dateEnd || !timeStart || !timeEnd) {
      return res.status(400).json({ success: false, error: 'Missing required configuration fields.' });
    }
    
    const newEventRef = db.ref('scheduler/special_events').push();
    const eventPayload = {
      id: newEventRef.key,
      title,
      description: description || '',
      date, 
      dateEnd,
      timeStart,
      timeEnd,
      type: type || 'Raid',
      isAttendanceTracked: !!isAttendanceTracked,
      daysOfWeek: daysOfWeek || null,
      allDay: !!allDay,
      createdBy: user.displayName || user.username || 'Authorized Officer',
      createdAt: Date.now()
    };
    
    await newEventRef.set(eventPayload);
    return res.json({ success: true, event: eventPayload });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ❌ DELETE /api/attendance/special-events/:id -> Purge Ad-Hoc Special Instance & Signs
router.delete('/special-events/:id', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];
    
    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Missing event ID.' });

    // 1. Remove the core special event node
    await db.ref(`scheduler/special_events/${id}`).remove();
    
    // 2. Perform a targeted cleanup on commitments matching this event ID
    const commitmentsSnap = await db.ref('attendance/commitments').once('value');
    if (commitmentsSnap.exists()) {
      const commitments = commitmentsSnap.val();
      const updates = {};
      Object.keys(commitments).forEach(key => {
        if (key.endsWith(`_${id}`)) {
          updates[`attendance/commitments/${key}`] = null;
        }
      });
      if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
      }
    }

    return res.json({ success: true, message: 'Special event and localized sign-ups purged successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 📝 PUT /api/attendance/special-events/:id -> Authorize & Modify Existing Ad-Hoc Instances
router.put('/special-events/:id', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];
    
    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const { id } = req.params;
    const { title, description, date, dateEnd, timeStart, timeEnd, type, isAttendanceTracked, daysOfWeek, allDay } = req.body;
    if (!title || !date || !dateEnd || !timeStart || !timeEnd) {
      return res.status(400).json({ success: false, error: 'Missing required configuration fields.' });
    }

    await db.ref(`scheduler/special_events/${id}`).update({
      title,
      description: description || '',
      date,
      dateEnd,
      timeStart,
      timeEnd,
      type: type || 'Raid',
      isAttendanceTracked: !!isAttendanceTracked,
      daysOfWeek: daysOfWeek || null,
      allDay: !!allDay,
      updatedBy: user.displayName || user.username || 'Authorized Officer',
      updatedAt: Date.now()
    });

    return res.json({ success: true, message: 'Special event configuration modified successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
// 📁 GET /api/attendance/compositions -> Read + lazily migrate legacy flat compositions to Grid Tabs
router.get('/compositions', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const snap = await db.ref('attendance/compositions').once('value');
    const rawMap = snap.exists() ? snap.val() : {};
    const compositions = {};
    const migrationWrites = {};

    Object.entries(rawMap).forEach(([configId, raw]) => {
      const normalized = normalizeComposition(raw, configId);
      const persistable = compositionForPersist(normalized);
      compositions[configId] = persistable;
      if (normalized._migratedFromLegacy) {
        migrationWrites[`attendance/compositions/${configId}`] = persistable;
      }
    });

    if (Object.keys(migrationWrites).length > 0) {
      await db.ref().update(migrationWrites);
    }

    return res.json({ success: true, compositions });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 📁 POST /api/attendance/compositions/create -> Create blank Raid Config with one Main Grid Tab
router.post('/compositions/create', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }

    const compsSnap = await db.ref('attendance/compositions').once('value');
    let nextIndex = 1;
    if (compsSnap.exists()) {
      const existingKeys = Object.keys(compsSnap.val());
      const numericIds = existingKeys.map(k => {
        const match = k.match(/^raid_(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      });
      nextIndex = Math.max(...numericIds, 0) + 1;
    }

    const sequentialConfigId = `raid_${String(nextIndex).padStart(3, '0')}`;
    const tabId = 'tab_001';
    const blankPayload = {
      id: sequentialConfigId,
      title: `Raid Setup Configuration ${nextIndex}`,
      lastUpdated: Date.now(),
      updatedBy: user.displayName || user.username || 'Officer',
      gridTopology: { columns: 8, rows: 5 },
      tabs: {
        [tabId]: {
          id: tabId,
          name: 'Main',
          slots_allocation: {},
        },
      },
      tabOrder: [tabId],
    };

    await db.ref(`attendance/compositions/${sequentialConfigId}`).set(blankPayload);
    return res.json({ success: true, id: sequentialConfigId });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 💾 POST /api/attendance/compositions/save -> Save Raid Config + all Grid Tabs
router.post('/compositions/save', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }

    const { configId, title, tabs, tabOrder, gridMatrix, activeTabId } = req.body;
    if (!configId) return res.status(400).json({ success: false, error: 'Missing configId parameter.' });

    const existingSnap = await db.ref(`attendance/compositions/${configId}`).once('value');
    const existingNormalized = normalizeComposition(existingSnap.exists() ? existingSnap.val() : null, configId);

    let nextTabs;
    let nextOrder;

    if (tabs && typeof tabs === 'object') {
      nextTabs = tabs;
      nextOrder = Array.isArray(tabOrder) && tabOrder.length ? tabOrder : Object.keys(tabs);
    } else if (gridMatrix && activeTabId) {
      // Legacy single-matrix save targeting one tab
      nextTabs = {
        ...existingNormalized.tabs,
        [activeTabId]: {
          ...(existingNormalized.tabs[activeTabId] || { id: activeTabId, name: 'Main' }),
          id: activeTabId,
          name: existingNormalized.tabs[activeTabId]?.name || 'Main',
          slots_allocation: gridMatrix,
        },
      };
      nextOrder = existingNormalized.tabOrder;
    } else if (gridMatrix) {
      const firstTabId = existingNormalized.tabOrder[0] || 'tab_001';
      nextTabs = {
        ...existingNormalized.tabs,
        [firstTabId]: {
          ...(existingNormalized.tabs[firstTabId] || { id: firstTabId, name: 'Main' }),
          id: firstTabId,
          name: existingNormalized.tabs[firstTabId]?.name || 'Main',
          slots_allocation: gridMatrix,
        },
      };
      nextOrder = existingNormalized.tabOrder.length ? existingNormalized.tabOrder : [firstTabId];
    } else {
      return res.status(400).json({ success: false, error: 'Missing tabs or gridMatrix payload.' });
    }

    const duplicates = findCrossTabDuplicates(nextTabs);
    if (duplicates.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Cross-tab duplicate members detected (${duplicates.length}). Each member may appear in only one Grid Tab.`,
        duplicates,
      });
    }

    const persistable = compositionForPersist({
      ...existingNormalized,
      title: title ?? existingNormalized.title,
      lastUpdated: Date.now(),
      updatedBy: user.displayName || user.username || 'Officer',
      tabs: nextTabs,
      tabOrder: nextOrder,
    });

    // Replace document so legacy root slots_allocation is removed
    await db.ref(`attendance/compositions/${configId}`).set(persistable);

    return res.json({ success: true, composition: persistable });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🖨️ POST /api/attendance/compositions/duplicate -> Duplicate full config including Grid Tabs
router.post('/compositions/duplicate', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }

    const { sourceId, cleanAllocationPayload, cleanTabsPayload } = req.body;
    if (!sourceId) return res.status(400).json({ success: false, error: 'Missing sourceId parameter.' });

    const sourceSnap = await db.ref(`attendance/compositions/${sourceId}`).once('value');
    if (!sourceSnap.exists()) return res.status(404).json({ success: false, error: 'Source config not found' });

    const sourceNormalized = normalizeComposition(sourceSnap.val(), sourceId);
    const compsSnap = await db.ref('attendance/compositions').once('value');
    let nextIndex = 1;
    if (compsSnap.exists()) {
      const existingKeys = Object.keys(compsSnap.val());
      const numericIds = existingKeys.map(k => {
        const match = k.match(/^raid_(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      });
      nextIndex = Math.max(...numericIds, 0) + 1;
    }

    const sequentialConfigId = `raid_${String(nextIndex).padStart(3, '0')}`;

    let tabs = sourceNormalized.tabs;
    let tabOrder = sourceNormalized.tabOrder;

    if (cleanTabsPayload && typeof cleanTabsPayload === 'object') {
      tabs = cleanTabsPayload;
      tabOrder = Object.keys(cleanTabsPayload);
    } else if (cleanAllocationPayload) {
      // Legacy: apply cleaned allocation to first tab only
      const firstTabId = tabOrder[0] || 'tab_001';
      tabs = {
        ...tabs,
        [firstTabId]: {
          ...(tabs[firstTabId] || { id: firstTabId, name: 'Main' }),
          slots_allocation: cleanAllocationPayload,
        },
      };
    }

    const duplicatePayload = compositionForPersist({
      id: sequentialConfigId,
      title: `${sourceNormalized.title || 'Untitled'} (Copy)`,
      lastUpdated: Date.now(),
      updatedBy: user.displayName || user.username || 'Officer',
      gridTopology: sourceNormalized.gridTopology || { columns: 8, rows: 5 },
      tabs,
      tabOrder,
    });

    await db.ref(`attendance/compositions/${sequentialConfigId}`).set(duplicatePayload);
    return res.json({ success: true, id: sequentialConfigId });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🗑️ DELETE /api/attendance/compositions/delete/:id -> Delete Configuration via Admin SDK (Bypasses rules)
router.delete('/compositions/delete/:id', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }

    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Missing configuration ID.' });

    await db.ref(`attendance/compositions/${id}`).remove();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 💾 POST /api/attendance/roster/save-batch -> Bulk Leaf-Level Persistence Optimizer
router.post('/roster/save-batch', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const { stagedMembers } = req.body;
    if (!stagedMembers) return res.status(400).json({ success: false, error: 'Omitted staged roster dataset.' });

    const defaultCredits = getDefaultLeaveCredits(configSnap.exists() ? configSnap.val() : {});
    const existingSnap = await db.ref('auction/members').once('value');
    const existingMembers = existingSnap.exists() ? existingSnap.val() : {};

    const batchAtomicUpdates = {};
    Object.entries(stagedMembers).forEach(([uid, m]) => {
      batchAtomicUpdates[`auction/members/${uid}/isRaidRoster`] = m.isRaidRoster === true;
      batchAtomicUpdates[`auction/members/${uid}/jobCode`] = m.jobCode || "";
      batchAtomicUpdates[`auction/members/${uid}/roleCode`] = m.roleCode || "";
      batchAtomicUpdates[`auction/members/${uid}/groupTag`] = m.groupTag || "";
      batchAtomicUpdates[`auction/members/${uid}/joinedAt`] = m.joinedAt || "";
      
      if (m.status) {
        batchAtomicUpdates[`auction/members/${uid}/status`] = m.status;
      }

      if (m.isRaidRoster === true && !Number.isInteger(existingMembers[uid]?.leaveCreditsRemaining)) {
        batchAtomicUpdates[`auction/members/${uid}/leaveCreditsRemaining`] = defaultCredits;
      }
      if (m.isRaidRoster === true && !Number.isInteger(existingMembers[uid]?.noConfirmCount)) {
        batchAtomicUpdates[`auction/members/${uid}/noConfirmCount`] = 0;
      }

      // Dummies own an editable displayName (no Discord source), so persist it here.
      // Real member names remain Discord-owned and are never written from the batch.
      if (uid.startsWith('dummy_') || m.isDummy === true) {
        batchAtomicUpdates[`auction/members/${uid}/isDummy`] = true;
        batchAtomicUpdates[`auction/members/${uid}/displayName`] = m.displayName || "";
      }
    });

    if (Object.keys(batchAtomicUpdates).length > 0) {
      await db.ref().update(batchAtomicUpdates);
    }

    return res.json({ success: true, message: 'Roster directory batch saved successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 🧩 POST /api/attendance/dummy/create -> Create Placeholder Member with Relational dummy_### ID
router.post('/dummy/create', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const roles = configSnap.exists() ? (configSnap.val().adminRoles || []) : [];

    if (!await verifyDiscordOfficerRole(req, roles)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const { displayName, jobCode, roleCode, groupTag, joinedAt } = req.body;
    if (!displayName || !displayName.trim()) {
      return res.status(400).json({ success: false, error: 'Missing required displayName parameter.' });
    }

    // Compute next relational sequence identifier by scanning existing dummy_### keys
    const membersSnap = await db.ref('auction/members').once('value');
    let nextIndex = 1;
    if (membersSnap.exists()) {
      const numericIds = Object.keys(membersSnap.val()).map(k => {
        const match = k.match(/^dummy_(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      });
      nextIndex = Math.max(...numericIds, 0) + 1;
    }

    const dummyId = `dummy_${String(nextIndex).padStart(3, '0')}`;
    const dummyPayload = {
      isDummy: true,
      isRaidRoster: false,
      displayName: displayName.trim(),
      jobCode: jobCode || "",
      roleCode: roleCode || "",
      groupTag: groupTag || "",
      joinedAt: joinedAt || "",
      status: "Active",
      leaveCreditsRemaining: getDefaultLeaveCredits(configSnap.exists() ? configSnap.val() : {}),
      noConfirmCount: 0,
    };

    await db.ref(`auction/members/${dummyId}`).set(dummyPayload);
    return res.json({ success: true, id: dummyId, member: dummyPayload });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

async function requireOfficer(req, configSnap) {
  const config = configSnap?.exists?.() ? configSnap.val() : {};
  const { user, ok } = await checkOfficer(req, config);
  return Boolean(user && ok);
}

function parseMemberUid(raw) {
  const uid = String(raw ?? '').trim();
  if (/^\d{5,22}$/.test(uid) || /^dummy_\d+$/.test(uid)) return uid;
  return null;
}

async function buildMemberProfileResponse(db, configSnap, uid) {
  const memberSnap = await db.ref(`auction/members/${uid}`).once('value');
  if (!memberSnap.exists()) return { ok: false, status: 404, error: 'Member not found.' };
  const member = memberSnap.val();
  const defaultCredits = getDefaultLeaveCredits(configSnap.exists() ? configSnap.val() : {});
  return {
    ok: true,
    payload: {
      success: true,
      uid,
      member: {
        ...member,
        leaveCreditsRemaining: Number.isInteger(member.leaveCreditsRemaining)
          ? member.leaveCreditsRemaining
          : defaultCredits,
        noConfirmCount: parseInt(member.noConfirmCount, 10) || 0,
      },
      config: {
        jobs: configSnap.val()?.jobs || {},
        roles: configSnap.val()?.roles || {},
        defaultLeaveCredits: defaultCredits,
      },
    },
  };
}

// GET /api/attendance/profile  ?uid= optional. Omit uid to load the signed-in member.
router.get('/profile', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const uid = parseMemberUid(req.query.uid || user.id);
    if (!uid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid member id. Expected a Discord snowflake.',
        received: req.query.uid || user.id || null,
      });
    }
    const isOfficer = await requireOfficer(req, configSnap);
    if (uid !== String(user.id) && !isOfficer) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }
    const result = await buildMemberProfileResponse(db, configSnap, uid);
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
    return res.json(result.payload);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/attendance/me -> current user leave credits / no-confirm
router.get('/me', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const [memberSnap, configSnap] = await Promise.all([
      db.ref(`auction/members/${user.id}`).once('value'),
      db.ref('settings/configuration').once('value'),
    ]);
    const member = memberSnap.exists() ? memberSnap.val() : {};
    const defaultCredits = getDefaultLeaveCredits(configSnap.exists() ? configSnap.val() : {});
    return res.json({
      success: true,
      leaveCreditsRemaining: Number.isInteger(member.leaveCreditsRemaining) ? member.leaveCreditsRemaining : defaultCredits,
      noConfirmCount: parseInt(member.noConfirmCount, 10) || 0,
      defaultLeaveCredits: defaultCredits,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/attendance/members/:uid/profile
router.get('/members/:uid/profile', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const uid = parseMemberUid(req.params.uid);
    if (!uid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid member id. Expected a Discord snowflake.',
        received: req.params.uid || null,
      });
    }
    const isOfficer = await requireOfficer(req, configSnap);
    if (uid !== String(user.id) && !isOfficer) {
      return res.status(403).json({ success: false, error: 'Access Denied.' });
    }
    const result = await buildMemberProfileResponse(db, configSnap, uid);
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
    return res.json(result.payload);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/attendance/members/:uid/leave-credits  { delta: number }
router.post('/members/:uid/leave-credits', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const uid = req.params.uid;
    const delta = parseInt(req.body?.delta, 10);
    if (!Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ success: false, error: 'delta must be a non-zero integer.' });
    }
    const memberSnap = await db.ref(`auction/members/${uid}`).once('value');
    if (!memberSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }
    const member = memberSnap.val();
    const defaultCredits = getDefaultLeaveCredits(configSnap.exists() ? configSnap.val() : {});
    const current = Number.isInteger(member.leaveCreditsRemaining) ? member.leaveCreditsRemaining : defaultCredits;
    const next = Math.max(0, current + delta);
    await db.ref(`auction/members/${uid}/leaveCreditsRemaining`).set(next);
    return res.json({ success: true, leaveCreditsRemaining: next });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/attendance/compose -> active compose session
router.get('/compose', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const activeSnap = await db.ref('attendance/compose_active').once('value');
    const activeKey = activeSnap.exists() ? activeSnap.val() : null;
    if (!activeKey) return res.json({ success: true, session: null });
    const sessionSnap = await db.ref(`attendance/compose/${activeKey}`).once('value');
    return res.json({ success: true, session: sessionSnap.exists() ? { id: activeKey, ...sessionSnap.val() } : null });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/attendance/compose/create
router.post('/compose/create', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const { eventKey, eventDate, configId } = req.body || {};
    if (!eventKey || !eventDate || !configId) {
      return res.status(400).json({ success: false, error: 'eventKey, eventDate, and configId are required.' });
    }

    const events = configSnap.exists() ? (configSnap.val().events || {}) : {};
    const eventTitle = events[eventKey]?.title || eventKey;
    const compSnap = await db.ref(`attendance/compositions/${configId}`).once('value');
    if (!compSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Raid config not found.' });
    }
    const normalized = normalizeComposition(compSnap.val(), configId);
    const { grids, selectedGridIds } = buildLiveGridsFromComposition(normalized, configId);
    const compositeKey = `${eventDate}_${eventKey}`;
    const payload = {
      eventKey,
      eventDate,
      eventTitle,
      configId,
      configTitle: normalized.title || configId,
      grids,
      selectedGridIds,
      createdAt: Date.now(),
      createdBy: user.displayName || user.username || 'Officer',
      lastUpdated: Date.now(),
    };
    await db.ref(`attendance/compose/${compositeKey}`).set(payload);
    await db.ref('attendance/compose_active').set(compositeKey);
    return res.json({ success: true, session: { id: compositeKey, ...payload } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/attendance/compose/save
router.post('/compose/save', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const { sessionId, grids } = req.body || {};
    if (!sessionId || !grids) {
      return res.status(400).json({ success: false, error: 'sessionId and grids are required.' });
    }
    await db.ref(`attendance/compose/${sessionId}`).update({
      grids,
      lastUpdated: Date.now(),
      updatedBy: user.displayName || user.username || 'Officer',
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/attendance/compose/close
router.post('/compose/close', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    await db.ref('attendance/compose_active').remove();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

function normalizeTimeStart(raw) {
  const trimmed = String(raw || '').trim();
  const withColon = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  if (withColon) {
    const hh = Math.min(23, parseInt(withColon[1], 10));
    const mm = Math.min(59, parseInt(withColon[2], 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return '';
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 3) {
    const hh = Math.min(23, parseInt(digits.slice(0, 1), 10));
    const mm = Math.min(59, parseInt(digits.slice(1), 10));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  if (digits.length === 4) {
    const hh = Math.min(23, parseInt(digits.slice(0, 2), 10));
    const mm = Math.min(59, parseInt(digits.slice(2), 10));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return '';
}

// POST /api/attendance/compose/send  { eventKey, eventDate, timeStart }
router.post('/compose/send', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }

    const { eventKey, eventDate } = req.body || {};
    const timeStart = normalizeTimeStart(req.body?.timeStart);
    if (!eventKey || !eventDate || !timeStart) {
      return res.status(400).json({ success: false, error: 'eventKey, eventDate, and timeStart are required.' });
    }

    const events = configSnap.exists() ? (configSnap.val().events || {}) : {};
    if (!events[eventKey]) {
      return res.status(404).json({ success: false, error: 'Event not found.' });
    }

    const eventTitle = events[eventKey].title || eventKey;
    const { writePublishedSnapshot } = await import('../services/publishedComposition.js');
    const published = await writePublishedSnapshot({
      db,
      session: {
        eventKey,
        eventDate,
        eventTitle,
        timeStart,
        grids: {},
        selectedGridIds: [],
      },
      sessionId: `${eventDate}_${eventKey}`,
      sentBy: user.displayName || user.username || 'Officer',
    });
    if (!published.ok) {
      return res.status(400).json({ success: false, error: published.error });
    }
    return res.json({ success: true, published: { id: published.id, ...published.payload } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/attendance/compose/deploy-roster  { sessionId, grids }
router.post('/compose/deploy-roster', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const { sessionId, grids } = req.body || {};

    let composeSession = null;
    const activeKey = sessionId || (await db.ref('attendance/compose_active').once('value')).val();
    if (activeKey) {
      const sessionSnap = await db.ref(`attendance/compose/${activeKey}`).once('value');
      if (sessionSnap.exists()) {
        composeSession = { id: activeKey, ...sessionSnap.val() };
        if (grids && typeof grids === 'object') {
          composeSession.grids = grids;
        }
      }
    }
    if (!composeSession) {
      return res.status(400).json({ success: false, error: 'No compose session to publish.' });
    }

    const { writePublishedSnapshot } = await import('../services/publishedComposition.js');
    const published = await writePublishedSnapshot({
      db,
      session: composeSession,
      sessionId: composeSession.id,
      sentBy: user.displayName || user.username || 'Officer',
    });
    return res.json({ success: true, published });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/attendance/published
router.get('/published', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const { listPublished } = await import('../services/publishedComposition.js');
    const { published, anchor } = await listPublished(getDatabase());
    return res.json({ success: true, published, anchor });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/attendance/published/:id/set-active  { active: true|false }
router.post('/published/:id/set-active', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const id = decodeURIComponent(req.params.id || '');
    if (typeof req.body?.active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'active must be a boolean.' });
    }
    const active = req.body.active;
    const { setPublishedAnchor } = await import('../services/publishedComposition.js');
    const result = await setPublishedAnchor({ db, id, active });
    if (!result.ok) {
      return res.status(404).json({ success: false, error: result.error });
    }
    return res.json({ success: true, anchor: result.id });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/attendance/published/:id
router.delete('/published/:id', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const id = decodeURIComponent(req.params.id || '');
    const { deletePublished } = await import('../services/publishedComposition.js');
    await deletePublished({ db, id });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

async function loadPublishedOr404(db, id) {
  const { PUBLISHED_PATH } = await import('../services/publishedComposition.js');
  const snap = await db.ref(`${PUBLISHED_PATH}/${id}`).once('value');
  if (!snap.exists()) return null;
  return { id, ...snap.val() };
}

// POST /api/attendance/published/:id/announce-attendance
router.post('/published/:id/announce-attendance', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const id = decodeURIComponent(req.params.id || '');
    const published = await loadPublishedOr404(db, id);
    if (!published) {
      return res.status(404).json({ success: false, error: 'Published composition not found.' });
    }
    const {
      sendGenRoomMessage,
      buildAttendanceRaidAnnounce,
    } = await import('../services/discordGenAnnounce.js');
    const content = buildAttendanceRaidAnnounce({
      eventTitle: published.eventTitle || published.eventKey,
      eventDate: published.eventDate,
      timeStart: published.timeStart,
    });
    await sendGenRoomMessage(content);
    return res.json({ success: true });
  } catch (err) {
    const msg = err.message || 'Failed to announce attendance.';
    const status = /not configured/i.test(msg) ? 400
      : /offline|not connected|rate-limited|temporarily blocking/i.test(msg) ? 503
      : /not found/i.test(msg) ? 404
      : 500;
    return res.status(status).json({ success: false, error: msg });
  }
});

// POST /api/attendance/published/:id/announce-party
router.post('/published/:id/announce-party', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const id = decodeURIComponent(req.params.id || '');
    const published = await loadPublishedOr404(db, id);
    if (!published) {
      return res.status(404).json({ success: false, error: 'Published composition not found.' });
    }
    const {
      sendGenRoomMessage,
      buildPartyReadyAnnounce,
    } = await import('../services/discordGenAnnounce.js');
    const content = buildPartyReadyAnnounce({
      eventTitle: published.eventTitle || published.eventKey,
      eventDate: published.eventDate,
    });
    await sendGenRoomMessage(content);
    return res.json({ success: true });
  } catch (err) {
    const msg = err.message || 'Failed to announce party.';
    const status = /not configured/i.test(msg) ? 400
      : /offline|not connected|rate-limited|temporarily blocking/i.test(msg) ? 503
      : /not found/i.test(msg) ? 404
      : 500;
    return res.status(status).json({ success: false, error: msg });
  }
});

// POST /api/attendance/published/:id/add-config  { configId }
router.post('/published/:id/add-config', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const id = decodeURIComponent(req.params.id || '');
    const configId = String(req.body?.configId || '').trim();
    if (!configId) {
      return res.status(400).json({ success: false, error: 'configId is required.' });
    }
    const compSnap = await db.ref(`attendance/compositions/${configId}`).once('value');
    if (!compSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Raid config not found.' });
    }
    const { addConfigToPublished } = await import('../services/publishedComposition.js');
    const result = await addConfigToPublished({
      db,
      id,
      configId,
      composition: normalizeComposition(compSnap.val(), configId),
    });
    if (!result.ok) {
      const status = /not found/i.test(result.error) ? 404 : 400;
      return res.status(status).json({ success: false, error: result.error });
    }
    return res.json({ success: true, published: result.payload });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/attendance/published/:id/remove-config  { configId }
router.post('/published/:id/remove-config', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const id = decodeURIComponent(req.params.id || '');
    const configId = String(req.body?.configId || '').trim();
    if (!configId) {
      return res.status(400).json({ success: false, error: 'configId is required.' });
    }
    const { removeConfigFromPublished } = await import('../services/publishedComposition.js');
    const result = await removeConfigFromPublished({ db, id, configId });
    if (!result.ok) {
      const status = /not found/i.test(result.error) ? 404 : 400;
      return res.status(status).json({ success: false, error: result.error });
    }
    return res.json({ success: true, published: result.payload });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/attendance/published/:id/save-grids  { grids }
router.post('/published/:id/save-grids', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    if (!await requireOfficer(req, configSnap)) {
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to Officers.' });
    }
    const id = decodeURIComponent(req.params.id || '');
    const { savePublishedGrids } = await import('../services/publishedComposition.js');
    const result = await savePublishedGrids({ db, id, grids: req.body?.grids });
    if (!result.ok) {
      const status = /not found/i.test(result.error) ? 404 : 400;
      return res.status(status).json({ success: false, error: result.error });
    }
    return res.json({ success: true, published: result.payload });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;