/**
 * Schedule SSOT: materialize weekly instances + shared commitment writes.
 */
import { getDatabase } from '../db/database.js';
import {
  getWeekMonday,
  enumerateWeekDates,
  buildCompositeKey,
  parseCompositeKey,
  DEFAULT_TZ,
} from '../utils/guildTime.js';

/**
 * Resolve guild timezone from settings (or default).
 */
export async function resolveGuildTimezone(db = getDatabase()) {
  const snap = await db.ref('settings/configuration/timezone').once('value');
  return snap.exists() ? (snap.val() || DEFAULT_TZ) : DEFAULT_TZ;
}

/**
 * Build instance payloads for a week from floating templates + special events.
 * Does not write — returns a map of compositeKey → instance.
 */
export function buildWeekInstanceMap({ weekMonday, events, specialEvents, existingInstances = {} }) {
  const map = {};
  const weekDates = enumerateWeekDates(weekMonday);

  for (const { dateStr, dayOfWeek } of weekDates) {
    if (events && typeof events === 'object') {
      for (const [eventId, ev] of Object.entries(events)) {
        const p3 = ev?.phases?.[3];
        if (!p3 || parseInt(p3.dayStart, 10) !== dayOfWeek) continue;
        const key = buildCompositeKey(dateStr, eventId);
        const prior = existingInstances[key] || {};
        map[key] = {
          weekMonday,
          eventId,
          date: dateStr,
          title: prior.title || ev.title || eventId,
          timeStart: p3.timeStart || '20:55',
          timeEnd: p3.timeEnd || '22:15',
          isSpecial: false,
          isCancelled: prior.isCancelled === true,
          notes: prior.notes || '',
          source: 'weekly',
        };
      }
    }

    if (specialEvents && typeof specialEvents === 'object') {
      for (const [eventId, ev] of Object.entries(specialEvents)) {
        if (!ev?.title) continue;

        let matches = ev.date === dateStr;
        if (!matches && ev.daysOfWeek) {
          let days = ev.daysOfWeek;
          if (typeof days === 'string') {
            try {
              days = JSON.parse(days);
            } catch {
              days = days.split(',').map(Number);
            }
          }
          if (Array.isArray(days)) {
            const inRange = (!ev.date || dateStr >= ev.date) && (!ev.dateEnd || dateStr <= ev.dateEnd);
            matches = inRange && days.map(Number).includes(dayOfWeek);
          }
        }
        if (!matches) continue;

        const key = buildCompositeKey(dateStr, eventId);
        const prior = existingInstances[key] || {};
        map[key] = {
          weekMonday,
          eventId,
          date: dateStr,
          title: prior.title || ev.title,
          timeStart: ev.timeStart || '21:30',
          timeEnd: ev.timeEnd || '23:00',
          isSpecial: true,
          isCancelled: prior.isCancelled === true,
          notes: prior.notes || '',
          source: 'special',
        };
      }
    }
  }

  return map;
}

/**
 * Idempotent materialize of scheduler/instances for a week.
 * Preserves isCancelled / notes / custom title on existing keys.
 * @returns {{ weekMonday: string, instances: object }}
 */
export async function ensureWeekInstances({ weekMonday: requestedMonday, force = false } = {}) {
  const db = getDatabase();
  const timezone = await resolveGuildTimezone(db);
  const weekMonday = requestedMonday || getWeekMonday(timezone);

  const [eventsSnap, specialSnap, existingSnap] = await Promise.all([
    db.ref('settings/configuration/events').once('value'),
    db.ref('scheduler/special_events').once('value'),
    db.ref('scheduler/instances').once('value'),
  ]);

  const events = eventsSnap.exists() ? eventsSnap.val() : {};
  const specialEvents = specialSnap.exists() ? specialSnap.val() : {};
  const allExisting = existingSnap.exists() ? existingSnap.val() : {};

  // Only pass existing instances for this week (or any key we'll overwrite)
  const weekExisting = {};
  for (const [key, val] of Object.entries(allExisting)) {
    if (val?.weekMonday === weekMonday || key.startsWith(weekMonday.slice(0, 7))) {
      // Prefer exact weekMonday match; also keep keys whose date falls in this week
      const parsed = parseCompositeKey(key);
      if (parsed) {
        const weekDates = enumerateWeekDates(weekMonday).map((d) => d.dateStr);
        if (weekDates.includes(parsed.dateStr)) weekExisting[key] = val;
      }
    }
  }

  const map = buildWeekInstanceMap({
    weekMonday,
    events,
    specialEvents,
    existingInstances: force ? {} : weekExisting,
  });

  // When force-refreshing, still preserve cancellation/notes from prior
  if (force) {
    for (const key of Object.keys(map)) {
      if (weekExisting[key]) {
        map[key].isCancelled = weekExisting[key].isCancelled === true;
        map[key].notes = weekExisting[key].notes || '';
        if (weekExisting[key].title) map[key].title = weekExisting[key].title;
      }
    }
  }

  const updates = {};
  for (const [key, instance] of Object.entries(map)) {
    updates[`scheduler/instances/${key}`] = instance;
  }
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }

  return { weekMonday, instances: map, timezone };
}

/**
 * Shared commitment writer used by REST + Discord.
 */
export async function writeCommitment({
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
    if (!parsed) throw new Error('Invalid compositeKey');
    date = parsed.dateStr;
    eid = parsed.eventId;
  }

  if (!userId || !date || !eid || !status) {
    throw new Error('Missing commitment fields');
  }

  const compositeKey = buildCompositeKey(date, eid);
  const uid = String(userId);

  if (status === 'None') {
    await db.ref(`attendance/commitments/${compositeKey}/${uid}`).remove();
    return { compositeKey, removed: true };
  }

  const payload = {
    displayName: displayName || 'Unknown Raider',
    status,
    declaredAt: Date.now(),
  };
  await db.ref(`attendance/commitments/${compositeKey}/${uid}`).set(payload);
  return { compositeKey, removed: false, payload };
}

/**
 * Load instances for a week (ensure first if empty).
 */
export async function getWeekInstances(weekMonday) {
  const db = getDatabase();
  const timezone = await resolveGuildTimezone(db);
  const monday = weekMonday || getWeekMonday(timezone);

  let snap = await db.ref('scheduler/instances').once('value');
  let all = snap.exists() ? snap.val() : {};
  const weekDates = new Set(enumerateWeekDates(monday).map((d) => d.dateStr));

  let filtered = {};
  for (const [key, val] of Object.entries(all)) {
    if (val?.weekMonday === monday || (val?.date && weekDates.has(val.date))) {
      filtered[key] = val;
    } else {
      const parsed = parseCompositeKey(key);
      if (parsed && weekDates.has(parsed.dateStr)) filtered[key] = val;
    }
  }

  if (Object.keys(filtered).length === 0) {
    const ensured = await ensureWeekInstances({ weekMonday: monday });
    return ensured;
  }

  return { weekMonday: monday, instances: filtered, timezone };
}
