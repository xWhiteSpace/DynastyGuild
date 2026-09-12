/**
 * Attendance RSVP SSOT: leave credits, deadline lock, next-event targeting,
 * deadline closer, and monthly leave-credit refresh.
 */
import { getDatabase } from '../db/database.js';
import { writeCommitment, ensureWeekInstances, resolveGuildTimezone } from './scheduleService.js';
import {
  getWeekMonday,
  parseCompositeKey,
  buildCompositeKey,
  guildWallTimeToUtcMs,
  getGuildNowParts,
  DEFAULT_TZ,
} from '../utils/guildTime.js';
import { resolveAnchoredComposition } from './publishedComposition.js';

export const DEFAULT_LEAVE_CREDITS = 3;
const DEADLINE_OFFSET_MS = 24 * 60 * 60 * 1000;

export function getDefaultLeaveCredits(config) {
  const parsed = parseInt(config?.defaultLeaveCredits, 10);
  if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  return DEFAULT_LEAVE_CREDITS;
}

export function getEventStartMs(instance, timezone = DEFAULT_TZ) {
  if (!instance?.date) return NaN;
  return guildWallTimeToUtcMs(instance.timeStart || '20:55', timezone, instance.date);
}

export function getEventDeadlineMs(instance, timezone = DEFAULT_TZ) {
  const start = getEventStartMs(instance, timezone);
  if (!Number.isFinite(start)) return NaN;
  return start - DEADLINE_OFFSET_MS;
}

function isRaidRosterMember(m) {
  return m?.isRaidRoster === true && m?.status !== 'Ghost';
}

async function loadInstance(db, compositeKey) {
  const snap = await db.ref(`scheduler/instances/${compositeKey}`).once('value');
  if (snap.exists()) return { key: compositeKey, ...snap.val() };
  const parsed = parseCompositeKey(compositeKey);
  if (!parsed) return null;
  const ensured = await ensureWeekInstances({ weekMonday: getWeekMonday() });
  const inst = ensured.instances?.[compositeKey];
  return inst ? { key: compositeKey, ...inst } : null;
}

/**
 * Collect current + next week instances, sorted by start time.
 * includePreviousWeek: also load last week (deadline closer catch-up).
 */
export async function listUpcomingInstances({ timezone, includePreviousWeek = false } = {}) {
  const db = getDatabase();
  const tz = timezone || (await resolveGuildTimezone(db));
  const thisMonday = getWeekMonday(tz);
  const shiftMonday = (base, days) => {
    const d = new Date(`${base}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  const nextMonday = shiftMonday(thisMonday, 7);
  const weekMondays = includePreviousWeek
    ? [shiftMonday(thisMonday, -7), thisMonday, nextMonday]
    : [thisMonday, nextMonday];

  const weeks = await Promise.all(weekMondays.map((weekMonday) => ensureWeekInstances({ weekMonday })));
  const map = weeks.reduce((acc, week) => ({ ...acc, ...(week.instances || {}) }), {});
  return Object.entries(map)
    .map(([key, inst]) => ({ key, ...inst }))
    .filter((ev) => ev.isCancelled !== true)
    .sort((a, b) => {
      const aMs = getEventStartMs(a, tz);
      const bMs = getEventStartMs(b, tz);
      return aMs - bMs;
    });
}

/**
 * Next event whose Phase-3 start is in the future AND whose RSVP deadline has not passed.
 */
export async function resolveNextAttendanceEvent({ timezone, nowMs = Date.now() } = {}) {
  const db = getDatabase();
  const tz = timezone || (await resolveGuildTimezone(db));
  const upcoming = await listUpcomingInstances({ timezone: tz });
  for (const ev of upcoming) {
    const startMs = getEventStartMs(ev, tz);
    const deadlineMs = getEventDeadlineMs(ev, tz);
    if (!Number.isFinite(startMs) || startMs <= nowMs) continue;
    if (!Number.isFinite(deadlineMs) || deadlineMs <= nowMs) continue;
    return { event: ev, timezone: tz, startMs, deadlineMs };
  }
  return { event: null, timezone: tz, startMs: null, deadlineMs: null };
}

/**
 * Attendance card target: Set Active published composition when present,
 * otherwise the next upcoming event with an open RSVP window.
 */
export async function resolveAttendanceTargetEvent({ timezone, nowMs = Date.now() } = {}) {
  const db = getDatabase();
  const tz = timezone || (await resolveGuildTimezone(db));
  const anchored = await resolveAnchoredComposition(db);
  if (anchored?.eventKey && anchored?.eventDate) {
    const compositeKey = buildCompositeKey(anchored.eventDate, anchored.eventKey);
    const instance = await loadInstance(db, compositeKey);
    if (!instance || instance.isCancelled === true) {
      return {
        event: null,
        timezone: tz,
        startMs: null,
        deadlineMs: null,
        anchored: true,
        missing: true,
      };
    }
    const startMs = getEventStartMs(instance, tz);
    const deadlineMs = getEventDeadlineMs(instance, tz);
    return {
      event: {
        ...instance,
        title: instance.title || anchored.eventTitle || instance.eventId,
      },
      timezone: tz,
      startMs,
      deadlineMs,
      anchored: true,
      missing: false,
    };
  }
  const next = await resolveNextAttendanceEvent({ timezone: tz, nowMs });
  return { ...next, anchored: false, missing: false };
}

export class AttendanceDecisionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'AttendanceDecisionError';
  }
}

/**
 * Credit-aware, deadline-aware RSVP write. Used by Discord cards, Scheduler, and /event.
 */
export async function applyAttendanceDecision({
  userId,
  displayName,
  dateStr,
  eventId,
  status,
  compositeKey: rawKey,
}) {
  const db = getDatabase();
  let date = dateStr;
  let eid = eventId;
  if (rawKey && (!date || !eid)) {
    const parsed = parseCompositeKey(rawKey);
    if (!parsed) throw new AttendanceDecisionError('invalid_key', 'Invalid compositeKey');
    date = parsed.dateStr;
    eid = parsed.eventId;
  }
  if (!userId || !date || !eid || !status) {
    throw new AttendanceDecisionError('missing_fields', 'Missing commitment fields');
  }

  const allowed = ['Confirmed', 'Leave', 'None'];
  if (!allowed.includes(status)) {
    throw new AttendanceDecisionError('invalid_status', 'Invalid attendance status');
  }

  const compositeKey = buildCompositeKey(date, eid);
  const uid = String(userId);
  const timezone = await resolveGuildTimezone(db);
  const instance = await loadInstance(db, compositeKey);
  if (!instance) {
    throw new AttendanceDecisionError('not_found', 'Scheduled event not found.');
  }
  if (instance.isCancelled === true) {
    throw new AttendanceDecisionError('cancelled', 'This event is cancelled.');
  }

  const deadlineMs = getEventDeadlineMs(instance, timezone);
  if (Number.isFinite(deadlineMs) && Date.now() > deadlineMs) {
    throw new AttendanceDecisionError('deadline', 'Attendance is locked — the RSVP deadline has passed.');
  }

  const [memberSnap, commitSnap, configSnap] = await Promise.all([
    db.ref(`auction/members/${uid}`).once('value'),
    db.ref(`attendance/commitments/${compositeKey}/${uid}`).once('value'),
    db.ref('settings/configuration').once('value'),
  ]);
  const member = memberSnap.exists() ? memberSnap.val() : {};
  const prevStatus = commitSnap.exists() ? commitSnap.val().status : null;
  const defaultCredits = getDefaultLeaveCredits(configSnap.exists() ? configSnap.val() : {});
  let credits = Number.isInteger(member.leaveCreditsRemaining)
    ? member.leaveCreditsRemaining
    : defaultCredits;

  let nextCredits = credits;
  if (status === 'Leave' && prevStatus !== 'Leave') {
    if (credits <= 0) {
      throw new AttendanceDecisionError('no_credits', 'No leave credits remaining. You must Confirm, or you will receive a No Confirm.');
    }
    nextCredits = credits - 1;
  } else if (prevStatus === 'Leave' && (status === 'Confirmed' || status === 'None')) {
    nextCredits = credits + 1;
  }

  const result = await writeCommitment({
    userId: uid,
    displayName: displayName || member.displayName || 'Unknown Raider',
    dateStr: date,
    eventId: eid,
    status,
    compositeKey,
  });

  if (nextCredits !== credits) {
    await db.ref(`auction/members/${uid}/leaveCreditsRemaining`).set(nextCredits);
  } else if (!Number.isInteger(member.leaveCreditsRemaining)) {
    await db.ref(`auction/members/${uid}/leaveCreditsRemaining`).set(credits);
  }

  return {
    ...result,
    leaveCreditsRemaining: nextCredits,
    previousStatus: prevStatus || 'Unanswered',
    deadlineMs,
  };
}

/**
 * When an event's deadline has passed, mark unanswered raid-roster members NoConfirm.
 * Idempotent per event/member.
 */
export async function closeExpiredDeadlines({ nowMs = Date.now() } = {}) {
  const db = getDatabase();
  const timezone = await resolveGuildTimezone(db);
  const upcoming = await listUpcomingInstances({ timezone, includePreviousWeek: true });
  const membersSnap = await db.ref('auction/members').once('value');
  const members = membersSnap.exists() ? membersSnap.val() : {};
  const rosterUids = Object.entries(members)
    .filter(([, m]) => isRaidRosterMember(m))
    .map(([uid]) => uid);

  let closed = 0;
  for (const ev of upcoming) {
    const startMs = getEventStartMs(ev, timezone);
    const deadlineMs = getEventDeadlineMs(ev, timezone);
    if (!Number.isFinite(deadlineMs) || deadlineMs > nowMs) continue;
    if (Number.isFinite(startMs) && startMs + 7 * 24 * 60 * 60 * 1000 < nowMs) continue;

    const commitSnap = await db.ref(`attendance/commitments/${ev.key}`).once('value');
    const commits = commitSnap.exists() ? commitSnap.val() : {};
    const markerSnap = await db.ref(`attendance/deadline_closed/${ev.key}`).once('value');
    if (markerSnap.exists()) continue;

    const updates = {};
    let eventClosed = 0;
    for (const uid of rosterUids) {
      const existing = commits[uid]?.status;
      if (existing === 'Confirmed' || existing === 'Leave' || existing === 'NoConfirm') continue;
      updates[`attendance/commitments/${ev.key}/${uid}`] = {
        displayName: members[uid]?.displayName || 'Unknown Raider',
        status: 'NoConfirm',
        declaredAt: nowMs,
      };
      const prev = parseInt(members[uid]?.noConfirmCount, 10) || 0;
      updates[`auction/members/${uid}/noConfirmCount`] = prev + 1;
      eventClosed++;
    }
    updates[`attendance/deadline_closed/${ev.key}`] = { closedAt: nowMs, count: eventClosed };
    await db.ref().update(updates);
    closed += eventClosed;
  }
  return { closed };
}

/**
 * Guild-TZ 1st of month: reset every raid-roster member to defaultLeaveCredits.
 */
export async function maybeRefreshMonthlyLeaveCredits({ now = new Date() } = {}) {
  const db = getDatabase();
  const timezone = await resolveGuildTimezone(db);
  const parts = getGuildNowParts(timezone, now);
  if (parseInt(parts.day, 10) !== 1) return { skipped: true, reason: 'not-first' };

  const ym = `${parts.year}-${parts.month}`;
  const markerRef = db.ref(`attendance/leave_credit_refresh/${ym}`);
  const markerSnap = await markerRef.once('value');
  if (markerSnap.exists()) return { skipped: true, reason: 'already-ran', ym };

  const [configSnap, membersSnap] = await Promise.all([
    db.ref('settings/configuration').once('value'),
    db.ref('auction/members').once('value'),
  ]);
  const defaultCredits = getDefaultLeaveCredits(configSnap.exists() ? configSnap.val() : {});
  const members = membersSnap.exists() ? membersSnap.val() : {};
  const updates = {};
  let count = 0;
  Object.entries(members).forEach(([uid, m]) => {
    if (!isRaidRosterMember(m)) return;
    updates[`auction/members/${uid}/leaveCreditsRemaining`] = defaultCredits;
    count++;
  });
  updates[`attendance/leave_credit_refresh/${ym}`] = {
    ranAt: Date.now(),
    defaultCredits,
    count,
  };
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }
  return { skipped: false, ym, count, defaultCredits };
}

export async function seedMissingLeaveCredits() {
  const db = getDatabase();
  const [configSnap, membersSnap] = await Promise.all([
    db.ref('settings/configuration').once('value'),
    db.ref('auction/members').once('value'),
  ]);
  const defaultCredits = getDefaultLeaveCredits(configSnap.exists() ? configSnap.val() : {});
  const members = membersSnap.exists() ? membersSnap.val() : {};
  const updates = {};
  Object.entries(members).forEach(([uid, m]) => {
    if (!isRaidRosterMember(m)) return;
    if (Number.isInteger(m.leaveCreditsRemaining)) return;
    updates[`auction/members/${uid}/leaveCreditsRemaining`] = defaultCredits;
    if (!Number.isInteger(m.noConfirmCount)) {
      updates[`auction/members/${uid}/noConfirmCount`] = 0;
    }
  });
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }
  return { seeded: Object.keys(updates).length, defaultCredits };
}
