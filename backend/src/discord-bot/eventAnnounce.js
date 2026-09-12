/**
 * Event Phase Announcements (Discord)
 *
 * Fires the per-event phase notifications configured in Settings → Events
 * (the 🔔 bell popover): Phase 1 registration reminders, Phase 2 bid-close,
 * and Phase 3 event-live notices.
 *
 * Design goals (why this exists instead of an in-memory tick tracker):
 *  - RESTART-SAFE: every occurrence is claimed via an idempotent Firebase
 *    marker, so a redeploy/cold-start/crash can no longer silently skip an
 *    announcement. A short catch-up window re-checks recent minutes each tick.
 *  - NO DUPLICATES: the marker is claimed with an atomic transaction, so
 *    concurrent ticks (or multiple instances) can never double-post.
 *  - SELF-HEALING: if the Discord send throws (rate limit / permissions), the
 *    marker is released so the next tick retries within the catch-up window.
 *
 * Mirrors the idempotency pattern used by attendanceAnnounce.js.
 */
import { getDatabase } from '../db/database.js';
import { discordClient } from './client.js';
import { getGuildNowParts, formatGuildDate, DEFAULT_TZ } from '../utils/guildTime.js';
import { logDiscordRateLimit, isDiscordCircuitOpen, enqueueDiscordCall } from '../utils/discordRateLimit.js';
import { discordChannel } from '../db/channels.js';

const DAY_MINUTES = 1440;

/**
 * How many recent minutes to re-check each tick. Markers make this safe from
 * duplicates, so this window heals typical restart/deploy gaps without risk.
 */
const CATCHUP_WINDOW_MINUTES = 3;

/**
 * Resolve the guild-timezone week-minute (0–10079) and calendar date for a
 * given instant. Weekday/date resolution is delegated to the guildTime SSOT so
 * this stays consistent with the rest of the scheduler; only the hour/minute
 * (not exposed by that helper) is formatted here to derive the week-minute.
 */
function getGuildMinuteContext(timezone, instant) {
  const { dayOfWeek } = getGuildNowParts(timezone, instant);

  const hmParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const t = {};
  hmParts.forEach((p) => {
    t[p.type] = p.value;
  });
  const hour = parseInt(t.hour, 10) % 24;
  const minute = parseInt(t.minute, 10);

  const absMinute = dayOfWeek * DAY_MINUTES + hour * 60 + minute;
  const dateStr = formatGuildDate(instant, timezone);
  return { absMinute, dateStr };
}

/**
 * How long a stale in-flight ('sending') marker is held before it can be
 * reclaimed. Covers two cases without hammering Discord every 60s tick:
 *  - a process crash mid-send (self-heals once past the TTL), and
 *  - a rate-limit back-off hold (see maybeAnnounceEvents catch handler).
 * Kept below the catch-up window so a held occurrence gets at most one delayed
 * retry inside the window instead of ~20 rapid-fire retries.
 */
const SENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Detect Discord global rate-limit / soft-ban style failures so the announcer
 * can back off instead of retrying (which only deepens the ban).
 */
function isRateLimitError(err) {
  if (!err) return false;
  if (err.name === 'DiscordCircuitOpenError') return true;
  const status = err.status ?? err.httpStatus ?? err.code;
  if (status === 429) return true;
  if (err.name === 'RateLimitError' || err.name === 'RateLimitedError') return true;
  return /rate limit|too many requests|being blocked/i.test(err.message || '');
}

/**
 * Atomically claim an announcement occurrence. Returns { claimed, ref }.
 * claimed === true means THIS call reserved it (marker was absent or a stale
 * in-flight hold aged past the TTL) and the caller must send. claimed === false
 * means it was already sent / is actively in-flight.
 */
async function claimAnnouncement(db, markerKey) {
  const ref = db.ref(`scheduler/event_announcements/${markerKey}`);
  const res = await ref.transaction((current) => {
    if (current === null) return { status: 'sending', at: Date.now() };
    // Reclaim a stale in-flight marker (crash mid-send, or a rate-limit hold)
    // only once it ages past the TTL — otherwise leave it so we never double-post
    // and never hammer Discord on back-to-back ticks.
    if (current.status === 'sending' && (Date.now() - (current.at || 0)) > SENDING_TTL_MS) {
      return { status: 'sending', at: Date.now() };
    }
    return; // abort — already sent or actively in-flight
  });
  return { claimed: res.committed === true, ref };
}

/**
 * Post one phase message (throws on failure so the marker can be released) and
 * fire the best-effort snapshot side-effect (never blocks the announcement).
 */
async function dispatchAnnouncement(phaseTag, eventName) {
  const auctionChannelId = discordChannel('DISCORD_AUCTION_CHANNEL_ID');
  if (!auctionChannelId) throw new Error('DISCORD_AUCTION_CHANNEL_ID is not configured');

  const channel = discordClient.channels.cache.get(auctionChannelId)
    || await enqueueDiscordCall(() => discordClient.channels.fetch(auctionChannelId));
  if (!channel || !channel.isTextBased()) {
    throw new Error('Configured auction announcement channel is missing or not text-based');
  }

  const { processAndPostDiscordSnapshot } = await import('../services/discordSnapshot.js');

  const messages = {
    p1: `📢 **${eventName} Registration Update**:\nBid requests are currently **OPEN**! Remember to check your basket modifications and confirm your item choices on the request deck.`,
    p2: `🔒 **${eventName} Registration Locked**:\nSubmissions are now closed! Bidding selections are frozen for list allocation processing by Management Officers.`,
    p3: `⚡ **${eventName} Auction Arena LIVE**:\nThe raid session has commenced! Stand by for interactive live bidding controls.`,
  };
  const text = messages[phaseTag];
  if (!text) return;

  await enqueueDiscordCall(() => channel.send(text));
  // Snapshots are a multi-chunk REST burst from the same Render IP that
  // Cloudflare then treats as OAuth abuse. Only Phase 2 (lock) posts the list;
  // Phase 1/3 stay text-only so Sign-in is not stacked on a broadcast.
  if (phaseTag !== 'p2') return;
  if (isDiscordCircuitOpen()) return;
  await processAndPostDiscordSnapshot(true, channel).catch(() => {});
}

/**
 * Determine which phase announcements are due at a given guild week-minute.
 */
function collectDuePhases(absMinute, announcementMinutes) {
  const { phase1 = [], phase2 = null, phase3 = null } = announcementMinutes || {};
  const due = [];
  if (Array.isArray(phase1) && phase1.includes(absMinute)) due.push('p1');
  if (typeof phase2 === 'number' && absMinute === phase2) due.push('p2');
  if (typeof phase3 === 'number' && absMinute === phase3) due.push('p3');
  return due;
}

/**
 * Cron-callable entrypoint (invoked every 60s from client.js). Self-gated on
 * the force-lock flag and fully idempotent: safe to call repeatedly.
 */
export async function maybeAnnounceEvents() {
  if (isDiscordCircuitOpen()) return;

  const db = getDatabase();

  const configSnap = await db.ref('settings/configuration').once('value');
  if (configSnap.exists() && configSnap.val().isForceLocked === true) return;

  const { getGateStatusDetails } = await import('../config/timeWindow.js');
  const status = getGateStatusDetails();
  if (!status || !status.announcementMinutes || !status.eventId) return;

  const timezone = status.timezone || DEFAULT_TZ;
  const eventName = status.eventName || 'Raid Session';
  const eventId = status.eventId;
  const now = new Date();

  // Walk the catch-up window from oldest → newest so backfilled announcements
  // post in chronological order.
  for (let k = CATCHUP_WINDOW_MINUTES; k >= 0; k--) {
    const instant = new Date(now.getTime() - k * 60000);
    const { absMinute, dateStr } = getGuildMinuteContext(timezone, instant);

    const duePhases = collectDuePhases(absMinute, status.announcementMinutes);
    if (duePhases.length === 0) continue;

    if (isDiscordCircuitOpen()) return;

    for (const phaseTag of duePhases) {
      if (isDiscordCircuitOpen()) return;
      // Marker scoping. Phase 1 fires at MULTIPLE times per day, so its marker
      // includes the exact week-minute (absMinute) to keep each occurrence
      // independent — otherwise a single shared daily key would let the first
      // Phase-1 time suppress the 12:00/19:00 ones. Phase 2/3 are single weekly
      // milestones, so day-scoping (dateStr) is enough and auto-resets weekly.
      const markerKey = phaseTag === 'p1'
        ? `${eventId}_${dateStr}_p1_${absMinute}`
        : `${eventId}_${dateStr}_${phaseTag}`;
      const { claimed, ref } = await claimAnnouncement(db, markerKey);
      if (!claimed) continue;

      try {
        await dispatchAnnouncement(phaseTag, eventName);
        await ref.update({ status: 'sent', at: Date.now() });
      } catch (err) {
        if (isRateLimitError(err)) {
          // Back off: KEEP the 'sending' marker so ticks stop retrying every 60s
          // (rapid retries only deepen a global soft-ban). The SENDING_TTL_MS
          // window lets a single delayed retry happen later if still viable.
          logDiscordRateLimit(`event announcement ${phaseTag}`, err);
          console.error(`⏳ Event announcement (${phaseTag}) rate-limited — holding marker to back off:`, err.message);
        } else {
          // Transient non-rate-limit failure: release so a later tick can retry.
          await ref.remove().catch(() => {});
          console.error(`⚠️ Event announcement (${phaseTag}) failed to post:`, err.message);
        }
      }
    }
  }
}
