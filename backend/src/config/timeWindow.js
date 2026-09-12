// backend/src/config/timeWindow.js
/**
 * ⏳ DYNAMIC TIME MATRIX SYSTEM (REAL-TIME CACHED)
 * Listens to Firebase real-time nodes on boot to maintain a localized memory cache.
 * Keeps function execution synchronous to protect background system loops against promise crashes.
 */
import { getDatabase } from '../db/database.js';
import { DEFAULT_CONFIGURATION } from './defaultConfiguration.js';
import { getCachedConfig, getCurrentTenantId, setCachedConfig } from '../db/tenantContext.js';

const DAYS_OF_WEEK_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function activeConfig() {
  return getCachedConfig() || { ...DEFAULT_CONFIGURATION };
}

export async function refreshTenantConfigCache() {
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const data = configSnap.exists() ? configSnap.val() : { ...DEFAULT_CONFIGURATION };
    const merged = {
      ...DEFAULT_CONFIGURATION,
      ...data,
      timezone: data.timezone || DEFAULT_CONFIGURATION.timezone,
      isForceLocked: data.isForceLocked !== undefined ? data.isForceLocked : false,
      adminRoles: Array.isArray(data.adminRoles) ? data.adminRoles : [],
      helpEmbedUrl: data.helpEmbedUrl || '',
      raidHelpEmbedUrl: data.raidHelpEmbedUrl || '',
      specialEventCategories: data.specialEventCategories || DEFAULT_CONFIGURATION.specialEventCategories,
      items: data.items || DEFAULT_CONFIGURATION.items,
      events: data.events || DEFAULT_CONFIGURATION.events,
    };
    const tenantId = getCurrentTenantId();
    if (tenantId) setCachedConfig(tenantId, merged);
    return merged;
  } catch (err) {
    console.error('⚠️ Config cache refresh failed:', err.message);
    return activeConfig();
  }
}

/**
 * Synchronous Gate State Evaluation Engine
 * Instantly parses current calendar structures against cached cloud parameters without promises.
 */
export function getGateStatusDetails() {
  const cachedConfig = activeConfig();
  const { timezone, isForceLocked, events } = cachedConfig;

  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).formatToParts(now);

  const timeObj = {};
  parts.forEach(p => { timeObj[p.type] = p.value; });

  const year = parseInt(timeObj.year, 10);
  const month = parseInt(timeObj.month, 10) - 1; // 0-indexed adjustment for JavaScript months
  const day = parseInt(timeObj.day, 10);
  const trueHours = parseInt(timeObj.hour, 10) % 24;

  // Construct a localized snapshot instance to extract the true day of week integer cleanly
  const trueMinutes = parseInt(timeObj.minute, 10);

  // 🛡️ ENVIRONMENT SHIELD: Extract weekday string straight from the designated timezone frame
  const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const weekdayStr = weekdayFormat.format(now); // Output matches: "Sun", "Mon", "Tue", etc.
  
  // Cross-reference against your existing short name array to pull the exact 0-6 index
  const dayOfWeek = DAYS_SHORT_NAMES.indexOf(weekdayStr) >= 0 ? DAYS_SHORT_NAMES.indexOf(weekdayStr) : 0;

  const currentMinutesOffset = trueHours * 60 + trueMinutes;
  const currentAbs = dayOfWeek * 1440 + currentMinutesOffset;

  // 🔒 Manual administrative override lockdown check
  if (isForceLocked) {
    return {
      isGateOpen: false,
      currentSessionLabel: "Forced Operational Lockdown",
      nextStatusChangeMessage: "Bidding channels are forcefully locked by Management Officers.",
      currentPhase: 2,
      phaseIntervals: { phase1: "Force Locked", phase2: "Force Locked", phase3: "Force Locked" }
    };
  }

  function getAbsoluteMinutes(day, timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return day * 1440 + h * 60 + m;
  }

const getModularDistance = (from, to) => (to - from + 10080) % 10080;

  // ⏳ Phase 0 Blueprint: Fallback defaults strictly to Phase 0 (Intermission) if right now is outside of active cycle hours
  let currentPhase = 0;
  let activePhaseConfig = null;
  let selectedEventContext = null;
  let activeEventId = "";
  let activeEventTitle = "Raid Session";

  const validEventIds = Object.keys(events || {}).filter(id => events[id]);

  if (validEventIds.length === 0) {
    return {
      isGateOpen: false,
      currentSessionLabel: 'Setup required',
      nextStatusChangeMessage: 'Set up events in Settings',
      currentPhase: 0,
      phaseIntervals: { phase1: 'Unconfigured', phase2: 'Unconfigured', phase3: 'Unconfigured' },
      eventId: '',
      eventName: '',
      activeEventId: '',
      activeEventTitle: '',
      helpEmbedUrl: cachedConfig.helpEmbedUrl || '',
      raidHelpEmbedUrl: cachedConfig.raidHelpEmbedUrl || '',
      timezone: timezone || 'Asia/Manila',
      announcementMinutes: { phase1: [], phase2: null, phase3: null },
      announcements: { phase1: [], phase2: null, phase3: null },
      needsSetup: true,
    };
  }

  if (validEventIds.length > 0) {
    let minP3EndDistance = Infinity;
    let targetEventId = "";

    // 1. Determine active event utilizing the min(P3 End) distance metric
    validEventIds.forEach(evId => {
      const ev = events[evId];
      const p3 = ev?.phases?.[3];
      if (!p3) return;

      const p3EndAbs = getAbsoluteMinutes(p3.dayEnd, p3.timeEnd);
      const distanceToP3End = getModularDistance(currentAbs, p3EndAbs);

      if (distanceToP3End < minP3EndDistance) {
        minP3EndDistance = distanceToP3End;
        targetEventId = evId;
      }
    });

    if (targetEventId) {
      activeEventId = targetEventId;
      selectedEventContext = events[activeEventId];
      activeEventTitle = selectedEventContext.title || "Raid Session";

      // 2. Evaluate active sub-phase using wrap-around circular duration rules
      if (selectedEventContext.phases) {
        // 🚀 BOUNDARY ISOLATION GUARD: Evaluate windows via absolute boundary checks to isolate inverted clock entries from expanding
        for (const phaseKey of [1, 2, 3]) {
          const p = selectedEventContext.phases[phaseKey];
          if (!p) continue;

          const startAbs = getAbsoluteMinutes(p.dayStart, p.timeStart);
          const endAbs = getAbsoluteMinutes(p.dayEnd, p.timeEnd);

          const isPhaseActive = startAbs <= endAbs
            ? (currentAbs >= startAbs && currentAbs <= endAbs)
            : (currentAbs >= startAbs || currentAbs <= endAbs);

          if (isPhaseActive) {
            currentPhase = Number(phaseKey);
            activePhaseConfig = p;
            break; // 🛡️ FIRST-MATCH SHORT CIRCUIT: Stop evaluation immediately once the current time matches an active phase
          }
        }
      }
    }
  }

  const isGateOpen = (currentPhase === 1);
  let nextStatusChangeMessage = "";

  if (currentPhase === 0) {
    // Look ahead directly at Phase 1 parameters to show exactly when the gates open up next
    const p1 = selectedEventContext?.phases?.[1];
    const startDayName = p1 ? DAYS_OF_WEEK_NAMES[p1.dayStart] : "Target Day";
    const openTime = p1 ? p1.timeStart : "00:00";
    nextStatusChangeMessage = `No Active Event: Preparing next event. Registration for ${activeEventTitle} opens on ${startDayName} at ${openTime} (${timezone} Time).`;
  } else if (activePhaseConfig) {
    const endDayName = DAYS_OF_WEEK_NAMES[activePhaseConfig.dayEnd] || "Target Day";
    if (currentPhase === 1) {
      nextStatusChangeMessage = `Registration is OPEN for ${activeEventTitle}. Submissions close on ${endDayName} at ${activePhaseConfig.timeEnd} (${timezone} Time).`;
    } else if (currentPhase === 2) {
      nextStatusChangeMessage = `Submissions for ${activeEventTitle} are locked. Live bidding preparation commences on ${endDayName} at ${activePhaseConfig.timeEnd}.`;
    } else {
      nextStatusChangeMessage = `${activeEventTitle} Event Session is currently LIVE inside the auction arena.`;
    }
  } else {
    nextStatusChangeMessage = isGateOpen 
      ? `Registration paths are OPEN for ${activeEventTitle}. Modify choices freely inside your basket.`
      : `Registration is LOCKED for ${activeEventTitle}. Review pending allocation priority indexes.`;
  }

  // Dynamic automatic computation of phase interval display string lines
  let gmtIndicator = "UTC";
  try {
    const formatterShort = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' });
    const tzParts = formatterShort.formatToParts(new Date());
    const foundPart = tzParts.find(p => p.type === 'timeZoneName');
    if (foundPart) gmtIndicator = foundPart.value;
  } catch (e) {
    gmtIndicator = "UTC";
  }

  const phaseIntervals = { phase1: "Unconfigured", phase2: "Unconfigured", phase3: "Unconfigured" };
  const displayTargetEvent = selectedEventContext || (validEventIds.length > 0 ? events[validEventIds[0]] : null);

  if (displayTargetEvent && displayTargetEvent.phases) {
    for (const pk of [1, 2, 3]) {
      const phaseData = displayTargetEvent.phases[pk];
      if (phaseData) {
        phaseIntervals[`phase${pk}`] = `${DAYS_SHORT_NAMES[phaseData.dayStart]} ${phaseData.timeStart} ~ ${DAYS_SHORT_NAMES[phaseData.dayEnd]} ${phaseData.timeEnd} ${gmtIndicator}`;
      }
    }
  }

const computedAnnouncementMinutes = { phase1: [], phase2: null, phase3: null };

  if (selectedEventContext && selectedEventContext.phases) {
    const evAnn = selectedEventContext.announcements || {};
    
    // Phase 1 alerts: Evaluated as daily repeating variations constrained inside the Phase 1 window
    const p1 = selectedEventContext.phases[1];
    if (p1 && evAnn.phase1) {
      const p1Start = (p1.dayStart * 1440) + parseInt(p1.timeStart.split(':')[0], 10) * 60 + parseInt(p1.timeStart.split(':')[1], 10);
      const p1End = (p1.dayEnd * 1440) + parseInt(p1.timeEnd.split(':')[0], 10) * 60 + parseInt(p1.timeEnd.split(':')[1], 10);
      const p1Duration = (p1End - p1Start + 10080) % 10080;

      evAnn.phase1.forEach(timeStr => {
        for (let d = 0; d <= 6; d++) {
          const annAbs = (d * 1440) + parseInt(timeStr.split(':')[0], 10) * 60 + parseInt(timeStr.split(':')[1], 10);
          if (((annAbs - p1Start + 10080) % 10080) <= p1Duration) {
            computedAnnouncementMinutes.phase1.push(annAbs);
          }
        }
      });
      computedAnnouncementMinutes.phase1.sort((a, b) => a - b);
    }

    // Phase 2 alerts: Milestone anchored explicitly to P2 Day Start
    const p2 = selectedEventContext.phases[2];
    if (p2 && evAnn.phase2) {
      computedAnnouncementMinutes.phase2 = (p2.dayStart * 1440) + parseInt(evAnn.phase2.split(':')[0], 10) * 60 + parseInt(evAnn.phase2.split(':')[1], 10);
    }

    // Phase 3 alerts: Milestone anchored explicitly to P3 Day Start
    const p3 = selectedEventContext.phases[3];
    if (p3 && evAnn.phase3) {
      computedAnnouncementMinutes.phase3 = (p3.dayStart * 1440) + parseInt(evAnn.phase3.split(':')[0], 10) * 60 + parseInt(evAnn.phase3.split(':')[1], 10);
    }
  }

  return {
    isGateOpen,
    currentSessionLabel: currentPhase === 1 ? `${activeEventTitle} Registration Open` : currentPhase === 3 ? `${activeEventTitle} Live Event Active` : currentPhase === 0 ? `${activeEventTitle} No Active Event` : `${activeEventTitle} Registration Closed`,
    nextStatusChangeMessage,
    currentPhase,
    phaseIntervals,
    eventId: activeEventId || "",
    eventName: activeEventTitle || "Raid Session",
    activeEventId: activeEventId || "", 
    activeEventTitle: activeEventTitle || "Raid Session", 
    helpEmbedUrl: cachedConfig.helpEmbedUrl || "",
    raidHelpEmbedUrl: cachedConfig.raidHelpEmbedUrl || "",
    // 🚀 CACHE EXPOSURE: Expose the synchronized memory timezone to save client network overhead
    timezone: timezone,
    announcementMinutes: computedAnnouncementMinutes,
    announcements: selectedEventContext?.announcements || {
      phase1: [],
      phase2: null,
      phase3: null
    }
  };
}