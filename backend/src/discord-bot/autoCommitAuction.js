/**
 * Auto-commit MimicBook auction (opt-in safety net)
 *
 * Officers sometimes forget to Lock & Commit the MimicBook board before an
 * event goes live. When an officer ARMS auto-commit for a session, this module
 * finalizes whatever is currently staged in `auction/active_session` roughly
 * one minute before the active event's Phase 3 ends.
 *
 * Design goals (mirrors eventAnnounce.js):
 *  - RESTART-SAFE + NO DUPLICATES: the commit is claimed via an atomic Firebase
 *    marker (scheduler/auto_commit/{eventId}_{dateStr}); concurrent ticks or a
 *    redeploy can never double-commit.
 *  - OPT-IN: only fires when `active_session.autoCommitArmed === true`.
 *  - SKIP-IF-EMPTY: never archives an empty/half-done board (zero winners).
 *  - A short catch-up window absorbs tick jitter around the trigger minute.
 */
import { getDatabase } from '../db/database.js';
import { getGuildWeekMinute, DEFAULT_TZ } from '../utils/guildTime.js';

const WEEK_MINUTES = 10080;

/**
 * How many minutes past the trigger we still allow the commit to land. Keeps the
 * auto-commit close to "1 min before Phase 3 ends" while surviving a missed tick
 * or a brief scheduler stall. The marker keeps this duplicate-safe.
 */
const CATCHUP_WINDOW_MINUTES = 3;

/** Guild-TZ week-minute for a "day + HH:MM" phase boundary. */
function toWeekMinute(day, timeStr) {
  if (timeStr == null || Number.isNaN(Number(day))) return null;
  const [h, m] = String(timeStr).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return day * 1440 + h * 60 + m;
}

/**
 * Atomically claim the auto-commit occurrence. Returns { claimed, ref }.
 * claimed === true means THIS call reserved it and must perform the commit.
 */
async function claimAutoCommit(db, markerKey) {
  const ref = db.ref(`scheduler/auto_commit/${markerKey}`);
  const res = await ref.transaction((current) => {
    if (current === null) return { status: 'committing', at: Date.now() };
    return; // abort — already committed or in-flight
  });
  return { claimed: res.committed === true, ref };
}

/** Firebase can materialize arrays as index-keyed objects under concurrency. */
function toArray(node) {
  if (Array.isArray(node)) return node;
  if (node && typeof node === 'object') return Object.values(node);
  return [];
}

/**
 * Cron-callable entrypoint (invoked every 60s from client.js). Fully idempotent
 * and self-gated: safe to call repeatedly.
 */
export async function maybeAutoCommitAuction() {
  try {
    const db = getDatabase();

    const configSnap = await db.ref('settings/configuration').once('value');
    const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
    if (dynamicConfig.isForceLocked === true) return;

    const { getGateStatusDetails } = await import('../config/timeWindow.js');
    const status = getGateStatusDetails();
    if (!status || !status.activeEventId) return;

    const eventId = status.activeEventId;
    const timezone = status.timezone || DEFAULT_TZ;
    const eventTitle = status.activeEventTitle || status.eventName || 'Raid Session';

    const phase3 = dynamicConfig.events?.[eventId]?.phases?.[3];
    if (!phase3) return;

    const p3EndMinute = toWeekMinute(phase3.dayEnd, phase3.timeEnd);
    if (p3EndMinute == null) return;

    // Fire ~1 minute before Phase 3 ends (wrap-safe around the week boundary).
    const triggerMinute = (p3EndMinute - 1 + WEEK_MINUTES) % WEEK_MINUTES;

    const { absMinute, dateStr } = getGuildWeekMinute(timezone);
    const distanceFromTrigger = (absMinute - triggerMinute + WEEK_MINUTES) % WEEK_MINUTES;
    if (distanceFromTrigger > CATCHUP_WINDOW_MINUTES) return;

    // Only load the session once we're inside the trigger window. Guard opt-in
    // BEFORE claiming the marker so a disarmed session never burns the slot.
    const sessionSnap = await db.ref('auction/active_session').once('value');
    if (!sessionSnap.exists()) return;
    const session = sessionSnap.val();
    if (session.autoCommitArmed !== true) return;

    const itemsList = dynamicConfig.items || [];
    const membersSnap = await db.ref('auction/members').once('value');
    const membersData = membersSnap.exists() ? membersSnap.val() : {};

    const resolveName = (uid) => {
      if (!uid) return '';
      if (/^\d+$/.test(uid)) return membersData[uid]?.displayName || uid;
      return uid; // dummy placeholder names carry their own label
    };

    // Rebuild allocations server-side exactly like the frontend
    // handleCommitSessionAndFlash so the auto path and manual path are identical.
    const requestsSnap = await db.ref('auction/web_requests').once('value');
    const firebaseRequests = requestsSnap.exists() ? Object.values(requestsSnap.val()) : [];

    const { compileLeaderboard } = await import('../utils/sortingEngine.js');
    const { rankingsByItem } = compileLeaderboard(firebaseRequests, itemsList, membersData);

    const categoryAllocations = session.categoryAllocations || {};
    const initialWinnersByItem = session.initialWinnersByItem || {};

    const processedAllocations = {};
    let totalWinners = 0;

    Object.keys(categoryAllocations).forEach((cat) => {
      const boxEntries = toArray(categoryAllocations[cat]?.selected).filter((v) => v !== '' && v != null);

      const initialWinnersList = toArray(initialWinnersByItem[cat]);
      const absentList = initialWinnersList.filter((uid) => !boxEntries.includes(uid));

      const masterList = rankingsByItem[cat] || [];
      const notSelected = masterList.filter((uid) => !boxEntries.includes(uid) && !absentList.includes(uid));

      const uniqueWinners = [...new Set(boxEntries)];
      const selected = uniqueWinners.map((uid) => ({
        userId: uid,
        name: resolveName(uid),
        slots: boxEntries.filter((n) => n === uid).length,
      }));
      totalWinners += selected.length;

      processedAllocations[cat] = { selected, absent: absentList, notSelected };
    });

    // SKIP-IF-EMPTY: never archive a blank board. Do NOT claim the marker so a
    // later (still-armed) state with real winners can auto-commit within window.
    if (totalWinners === 0) {
      console.log('⏭️ [AUTO-COMMIT]: Armed but zero winners staged — skipping to avoid archiving an empty board.');
      return;
    }

    const markerKey = `${eventId}_${dateStr}`;
    const { claimed, ref } = await claimAutoCommit(db, markerKey);
    if (!claimed) return;

    try {
      const { performCommitSession } = await import('../api/request.routes.js');
      const commitDate = dynamicConfig.targetSessionDate
        || new Date().toLocaleDateString('en-US', { timeZone: timezone });

      await performCommitSession({
        event: eventTitle,
        date: commitDate,
        allocations: processedAllocations,
        summary: session.lootSummary || {},
      });

      await ref.update({ status: 'committed', at: Date.now() });
      console.log(`✅ [AUTO-COMMIT]: Auction "${eventTitle}" auto-committed (${totalWinners} winners) ~1 min before Phase 3 end.`);
    } catch (err) {
      // Release the marker so the next tick inside the window can retry.
      await ref.remove().catch(() => {});
      console.error('⚠️ [AUTO-COMMIT]: Commit failed — released marker for retry:', err.message);
    }
  } catch (err) {
    console.error('⚠️ [AUTO-COMMIT]: maybeAutoCommitAuction failed:', err.message);
  }
}
