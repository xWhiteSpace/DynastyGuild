export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function parseHm(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || (minute !== 0 && minute !== 30)) return null;
  return hour * 60 + minute;
}

export function hoursCovered(startMin, endMin) {
  if (startMin == null || endMin == null || startMin === endMin) return [];
  const hits = new Set();
  const mark = (from, to) => {
    for (let hour = 0; hour < 24; hour += 1) {
      const binStart = hour * 60;
      const binEnd = binStart + 60;
      if (from < binEnd && to > binStart) hits.add(hour);
    }
  };
  if (endMin > startMin) mark(startMin, endMin);
  else {
    mark(startMin, 24 * 60);
    mark(0, endMin);
  }
  return [...hits].sort((a, b) => a - b);
}

function uniqueHours(list) {
  const hours = [...new Set(
    (Array.isArray(list) ? list : [])
      .map((value) => parseInt(value, 10))
      .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
  )].sort((a, b) => a - b);
  return hours;
}

function hoursFromWindow(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const startMin = parseHm(raw.start);
  const endMin = parseHm(raw.end);
  return hoursCovered(startMin, endMin);
}

export function normalizePlaySchedule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hours = {};
  let hasHour = false;

  if (raw.hours && typeof raw.hours === 'object' && !Array.isArray(raw.hours)) {
    for (const key of DAY_KEYS) {
      const dayHours = uniqueHours(raw.hours[key]);
      if (dayHours.length) {
        hours[key] = dayHours;
        hasHour = true;
      }
    }
  } else if (raw.days && !Array.isArray(raw.days) && typeof raw.days === 'object') {
    for (const key of DAY_KEYS) {
      const dayHours = hoursFromWindow(raw.days[key]);
      if (dayHours.length) {
        hours[key] = dayHours;
        hasHour = true;
      }
    }
  } else {
    const windowHours = hoursFromWindow({ start: raw.start, end: raw.end });
    const legacyDays = Array.isArray(raw.days) ? raw.days : [];
    if (windowHours.length) {
      for (const day of legacyDays) {
        const key = String(day || '').toLowerCase().slice(0, 3);
        if (!DAY_KEYS.includes(key)) continue;
        hours[key] = [...windowHours];
        hasHour = true;
      }
    }
  }

  if (!hasHour) return null;
  return { hours, updatedAt: Number(raw.updatedAt) || 0 };
}

export function isPeakHoursEligible(uid, member) {
  if (!member || typeof member !== 'object') return false;
  if (String(uid).startsWith('dummy_') || member.isDummy === true) return false;
  return member.isRaidRoster === true;
}

export function rosterDisplayName(member, uid) {
  const name = String(member?.displayName || '').trim();
  return name || String(uid);
}

export function emptyHeatmap() {
  return DAY_KEYS.map(() => Array.from({ length: 24 }, () => 0));
}

export function addScheduleToHeatmap(heatmap, schedule) {
  for (const key of DAY_KEYS) {
    const dayIndex = DAY_KEYS.indexOf(key);
    for (const hour of schedule.hours?.[key] || []) {
      heatmap[dayIndex][hour] += 1;
    }
  }
}

function collapseDayIndexes(indexes) {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  if (!sorted.length) return '';
  const labels = sorted.map((i) => DAY_LABELS[i]);
  const consecutive = sorted.every((value, i) => i === 0 || value === sorted[i - 1] + 1);
  if (consecutive && labels.length > 1) return `${labels[0]}–${labels[labels.length - 1]}`;
  return labels.join(', ');
}

export function describePeak(heatmap) {
  let max = 0;
  for (const row of heatmap) {
    for (const count of row) if (count > max) max = count;
  }
  if (max === 0) return null;

  const tally = new Map();
  DAY_KEYS.forEach((_, dayIndex) => {
    let hour = 0;
    while (hour < 24) {
      if (heatmap[dayIndex][hour] !== max) {
        hour += 1;
        continue;
      }
      let end = hour;
      while (end < 24 && heatmap[dayIndex][end] === max) end += 1;
      const key = `${hour}-${end}`;
      if (!tally.has(key)) tally.set(key, { start: hour, end, days: [] });
      tally.get(key).days.push(dayIndex);
      hour = end;
    }
  });

  let best = null;
  for (const item of tally.values()) {
    const score = (item.end - item.start) * item.days.length;
    if (!best || score > best.score) best = { ...item, score };
  }
  if (!best) return null;

  const endDisplay = best.end === 24 ? '00:00' : `${String(best.end).padStart(2, '0')}:00`;
  const startDisplay = `${String(best.start).padStart(2, '0')}:00`;
  return {
    count: max,
    startHour: best.start,
    endHour: best.end,
    days: best.days,
    label: `Peak: ${collapseDayIndexes(best.days)} ${startDisplay}–${endDisplay} (${max} member${max === 1 ? '' : 's'})`,
  };
}

export function aggregatePeakHours(members) {
  const heatmap = emptyHeatmap();
  const missing = [];
  let filled = 0;
  let total = 0;

  for (const [uid, member] of Object.entries(members || {})) {
    if (!isPeakHoursEligible(uid, member)) continue;
    total += 1;
    const schedule = normalizePlaySchedule(member.playSchedule);
    if (!schedule) {
      missing.push({
        uid: String(uid),
        displayName: rosterDisplayName(member, uid),
      });
      continue;
    }
    filled += 1;
    addScheduleToHeatmap(heatmap, schedule);
  }

  missing.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { heatmap, peak: describePeak(heatmap), filled, total, missing };
}
