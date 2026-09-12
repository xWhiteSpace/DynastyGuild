// backend/src/api/request.routes.js
import { Router } from 'express';
import { getDatabase } from '../db/database.js';
import { getGateStatusDetails } from '../config/timeWindow.js';
import { DEFAULT_CONFIGURATION } from '../config/defaultConfiguration.js';
import { getCurrentTenantId } from '../db/tenantContext.js';

import crypto from 'crypto'; // 🛡️ Cryptographic token verification module
import { isDiscordCircuitOpen, getDiscordRateLimitStatus, logDiscordHttpFailure } from '../utils/discordRateLimit.js';

const router = Router();

// 💡 SEED MATRIX BOUNDARIES (Only utilized to safely configure blank database tracks automatically)
const DEFAULT_SESSION_STRUCTURE = {
  activeStep: 1,
  qtyPerPage: 4,
  lootRows: [],
  lootSummary: {},
  categoryAllocations: {},
  initialWinnersByItem: {},
  isDiscordGateOpen: false 
};

function getGMT8DateString() {
  // 🚀 DYNAMIC TIMEZONE PIPELINE: Authoritatively bind date string resolutions straight to the user-configured settings tab parameters
  const timeGateStatus = getGateStatusDetails() || {};
  const targetTimezone = timeGateStatus.timezone; 

  try {
    const localString = new Date().toLocaleString("en-US", { timeZone: targetTimezone });
    const tzDate = new Date(localString);
    const month = tzDate.getMonth() + 1;
    const day = tzDate.getDate();
    const year = tzDate.getFullYear();
    return `${month}/${day}/${year}`;
  } catch (e) {
    // Structural runtime environmental fallback if the database parameters are completely empty during application boot
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }
}

function parseCSVToRawArrays(csvText, headerMatchKeyword) {
  const lines = csvText.split(/\r?\n/);
  let tableStarted = false;
  const dataRows = [];
  for (let line of lines) {
    if (!line.trim()) continue;
    const cleanLine = line.replace(/^\ufeff/, '');
    const cells = cleanLine.split(',').map(c => c.trim().replace(/^"|"$/g, '').trim());
    if (!tableStarted) {
      if (cells.map(c => c.toLowerCase()).includes(headerMatchKeyword.toLowerCase())) {
        tableStarted = true;
      }
      continue;
    }
    if (cells.every(c => c === '')) continue;
    dataRows.push(cells);
  }
  return dataRows;
}

function resolveUserIdentity(req) {
  if (req.session?.user) return req.session.user;
  const mobileHeaderToken = req.headers['x-user-profile'];
  if (mobileHeaderToken) {
    try {
      const decodedPayload = JSON.parse(decodeURIComponent(mobileHeaderToken));
      
      // 🔒 TAMPER-PROOF VERIFICATION GATEWAY: Re-hash profile and assert cryptographic signature matching
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
          return profileToVerify; // Clear authorization verified successfully
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

/**
 * 🛡️ DYNAMIC ROLE INTERSECTOR
 * Compares the active Discord user profile arrays directly against authorized configurations
 */
function verifyDiscordOfficerRole(user, allowedRoles = []) {
  if (!user) return false;
  if (user.roles && Array.isArray(user.roles)) {
    return user.roles.some(roleName => allowedRoles.includes(roleName));
  }
  return user.isOfficer === true;
}

/**
 * ⚡ RELATIONAL PRIORITY SCORE ENGINE
 * Tracks historical targets strictly using unchanging relational sequence identifiers (item_001)
 */
async function calculatePriorityScore(db, userId, itemId, itemNameFallback) {
  const playerHistorySnap = await db.ref('auction/web_requests')
    .orderByChild('userId')
    .equalTo(userId)
    .once('value');

  if (!playerHistorySnap.exists()) return 0;

  const records = playerHistorySnap.val();
  const sortedKeys = Object.keys(records).sort();
  const combinedItemTimeline = [];

  // ⚙️ DYNAMIC LOOKBACK SETTING: Fetch the preference from configuration, defaulting to 30 days if unconfigured
  const configSnap = await db.ref('settings/configuration').once('value');
  const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
  const lookbackDays = parseInt(dynamicConfig.priorityLookbackDays, 10) || 30; 
  
  const expirationWindowInMs = lookbackDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  // 💰 HIGH VALUE RULING: Precious items retain (instead of reset) priority when a
  // chosen member ends up Absent — only an actual pickup or an officer's manual
  // reset should zero the streak out for these items.
  const itemsList = dynamicConfig.items || [];
  const targetItemMeta = itemsList.find(i => {
    if (i.id && itemId) return i.id.trim().toLowerCase() === itemId.trim().toLowerCase();
    return false;
  }) || (itemNameFallback ? itemsList.find(i => (i.name || '').trim().toLowerCase() === itemNameFallback.trim().toLowerCase()) : null);
  const isHighValueItem = targetItemMeta?.isHighValue === true;

  sortedKeys.forEach(key => {
    const record = records[key];
    
    // 🛡️ ROLLING EXPIRATION FILTER: Dynamically drops rows older than your custom setting window
    const recordDateStr = record.date || "";
    const recordTimeMs = Date.parse(recordDateStr);
    if (!isNaN(recordTimeMs) && (nowMs - recordTimeMs) > expirationWindowInMs) {
      return; // Safe lookback boundary: skips this entry and proceeds to next key
    }

    const recordItemId = record.itemId;
    
let isMatch = false;
    if (recordItemId) {
      if (recordItemId.trim().toLowerCase() === itemId.trim().toLowerCase()) isMatch = true;
    } else if (record.item && itemNameFallback) {
      if (record.item.trim().toLowerCase() === itemNameFallback.trim().toLowerCase()) isMatch = true;
    }

    if (isMatch) {
      // Store each matched record's status alongside its own night key so the
      // counting loop stays aligned to THIS item's filtered timeline (per-item).
      combinedItemTimeline.push({
        status: (record.selectionStatus || 'pending').toLowerCase(),
        date: record.date || record.eventDate
      });
    }
  });

  let lastSelectedIdx = -1;
  for (let i = combinedItemTimeline.length - 1; i >= 0; i--) {
    const { status } = combinedItemTimeline[i];
    // 🛡️ 'reset' is an officer-issued manual override and always terminates the streak.
    // 'absent' only terminates the streak for regular items — High Value items retain
    // priority through an Absent outcome instead of resetting it.
    const isTerminal = status === 'selected' || status === 'reset' || (status === 'absent' && !isHighValueItem);
    if (isTerminal) {
      lastSelectedIdx = i;
      break;
    }
  }

  let priorityPoints = 0;
  const countedDates = new Set();
  const searchStart = lastSelectedIdx !== -1 ? lastSelectedIdx + 1 : 0;
  for (let i = searchStart; i < combinedItemTimeline.length; i++) {
    const { status, date: uniqueNightKey } = combinedItemTimeline[i];

    const countsTowardPity = status === 'notselected' || (status === 'absent' && isHighValueItem);
    if (countsTowardPity && uniqueNightKey && !countedDates.has(uniqueNightKey)) {
      priorityPoints++;
      countedDates.add(uniqueNightKey);
    }
  }

  return priorityPoints;
}

/**
 * POST /api/requests/settings/unlock
 * Verifies master password against server-side variables
 */
router.post('/settings/unlock', (req, res) => {
  const { masterKey } = req.body;
  const trueSecret = process.env.SETTINGS_MASTER_KEY;
  const user = resolveUserIdentity(req);

  if (user?.isOfficer) {
    if (req.session) req.session.settingsUnlocked = true;
    return res.json({ success: true, message: 'Officer configuration desk unlocked.' });
  }

  if (!trueSecret) {
    return res.status(401).json({ success: false, error: 'Officers can unlock Settings. A master key is not configured.' });
  }

  if (masterKey === trueSecret) {
    if (req.session) {
      req.session.settingsUnlocked = true;
    }
    return res.json({ success: true, message: 'Authorization verified. Configuration channels unlocked.' });
  }

  return res.status(401).json({ success: false, error: 'Invalid configuration master verification key.' });
});

/**
 * GET /api/requests/settings/get
 * Extracts system options matrix directly out of Firebase paths
 */
router.get('/settings/get', async (req, res) => {
  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    
    if (!configSnap.exists()) {
      const defaultData = { ...DEFAULT_CONFIGURATION };
      await db.ref('settings/configuration').set(defaultData);
      return res.json({ success: true, config: defaultData });
    }

    return res.json({ success: true, config: configSnap.val() });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/requests/settings/save
 * Commits panel adjustments down into cloud storage nodes
 */
router.post('/settings/save', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!req.session?.settingsUnlocked && !user?.isOfficer) {
    return res.status(403).json({ success: false, error: 'Operation rejected: Configuration desk input gates are key locked.' });
  }

  try {
    const { config } = req.body;
    if (!config) return res.status(400).json({ success: false, error: 'Omitted payload configuration parameter maps.' });

    const db = getDatabase();
    await db.ref('settings/configuration').set(config);
    return res.json({ success: true, message: 'Global parameter fields synchronized successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/requests/active-session
 */
router.get('/active-session', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const dynamicConfig = configSnap.exists() ? configSnap.val() : { items: [] };
    const itemsList = dynamicConfig.items || [];
    
    const sessionSnap = await db.ref('auction/active_session').once('value');

    if (!sessionSnap.exists()) {
      return res.json({ success: true, session: null });
    }

    const currentSessionData = sessionSnap.val();
    const timeDeltaMilliseconds = Date.now() - (currentSessionData.lastUpdated || 0);
    const maximumAllowedAgeInMs = 24 * 60 * 60 * 1000; 

    if (timeDeltaMilliseconds > maximumAllowedAgeInMs) {
      const gateDetails = getGateStatusDetails() || {};
      const activeLoots = dynamicConfig.events?.[gateDetails.activeEventId]?.loots || {};
      const firstItemId = itemsList.length > 0 ? itemsList[0].id : '';

      // 🛡️ SEPARATION COMPLETE: The server seeds transactional variables without cluttering cloud nodes with visual metadata
      const freshReset = {
        ...DEFAULT_SESSION_STRUCTURE,
        lootRows: firstItemId ? [{ id: 1, itemType: firstItemId, startPage: 1, startPos: 1, endPage: 1, endPos: 4, limit: activeLoots[firstItemId] || 1 }] : [],
        lastUpdated: Date.now()
      };

      itemsList.forEach(item => {
        freshReset.lootSummary[item.id] = { qty: 0, limit: activeLoots[item.id] || 1, seats: 0 };
        freshReset.categoryAllocations[item.id] = { selected: [] };
        freshReset.initialWinnersByItem[item.id] = [];
      });
      await db.ref('auction/active_session').set(freshReset);
      return res.json({ success: true, session: freshReset });
    }

    if (currentSessionData.categoryAllocations) {
        const gateDetails = getGateStatusDetails() || {};
        const activeLoots = dynamicConfig.events?.[gateDetails.activeEventId]?.loots || {};
        itemsList.forEach(item => {
          if (!currentSessionData.categoryAllocations[item.id]) {
            currentSessionData.categoryAllocations[item.id] = { selected: [] };
          }
          if (!currentSessionData.lootSummary[item.id]) {
            currentSessionData.lootSummary[item.id] = { qty: 0, limit: activeLoots[item.id] || 1, seats: 0 };
          }
        });
    }

    // 🛡️ Ensure default geometric layout parameter maps are never undefined
    if (currentSessionData.qtyPerPage === undefined) {
      currentSessionData.qtyPerPage = 4;
    }

    return res.json({ success: true, session: currentSessionData });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/requests/update-session
 */
router.post('/update-session', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const allowedRoles = configSnap.exists() ? (configSnap.val().adminRoles || []) : ["GUILD LEADER", "Vice Guild Leader", "Commander"];

    if (!verifyDiscordOfficerRole(user, allowedRoles)) {
      console.error(`🛑 [SECURITY OVERRIDE REJECTION]: User "${user.displayName || user.username}" lacks authorized management roles. Write blocked.`);
      return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to authorized Discord Management Officers only.' });
    }

    console.log(`📡 [SERVER SESSION UPDATE]: Writing payload data. Gate Override Status: ${req.body.session?.isDiscordGateOpen}`);
    const incomingWorkspacePayload = req.body.session;
    if (!incomingWorkspacePayload) {
      return res.status(400).json({ success: false, error: 'Payload configuration parameters missing.' });
    }

    // Run an atomic transaction to ensure out-of-order network packets can never degrade the state version
    const activeSessionNodeRef = db.ref('auction/active_session');
    await activeSessionNodeRef.transaction((currentDatabaseState) => {
      if (currentDatabaseState) {
        // Abort write smoothly if the incoming packet version is less than what is already committed in the database
        if (incomingWorkspacePayload.version !== undefined && currentDatabaseState.version !== undefined) {
          if (incomingWorkspacePayload.version < currentDatabaseState.version) {
            return; 
          }
        }
      }
      incomingWorkspacePayload.lastUpdated = Date.now();
      return incomingWorkspacePayload;
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/requests/init
 */
router.get('/init', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const playerDisplayName = user.displayName || user.username;
    const playerLower = playerDisplayName.trim().toLowerCase();
    
    const db = getDatabase();
    const configSnap = await db.ref('settings/configuration').once('value');
    const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
    const itemsList = dynamicConfig.items || [];
    const timezone = dynamicConfig.timezone || "Asia/Manila";
    const targetSessionDate = dynamicConfig.targetSessionDate || new Date().toLocaleDateString("en-US", { timeZone: timezone });
    
    const timeGateStatus = getGateStatusDetails();
      // Dynamic Filter Pass: Extract only items that are explicitly included in the active event's loot tree
      const activeEvent = dynamicConfig.events?.[timeGateStatus.activeEventId];
      const activeLoots = activeEvent?.loots || {};
      const activeItemsList = [];
      itemsList.forEach(masterItem => {
        if (activeLoots[masterItem.id] !== undefined) {
          activeItemsList.push({
            id: masterItem.id,
            name: masterItem.name,
            colorTheme: masterItem.colorTheme || 'slate',
            limitQty: activeLoots[masterItem.id],
            isHighValue: masterItem.isHighValue === true
          });
        }
      });

      // 🚀 INDEXED MEMORY OPTIMIZATION: Query only active 'Pending' records to prevent historical table bloat
      const snapshot = await db.ref('auction/web_requests')
        .orderByChild('selectionStatus')
        .equalTo('Pending')
        .once('value');
      const firebaseRequests = snapshot.exists() ? Object.values(snapshot.val()) : [];

      const liveCounts = {};
      const rankingsByItem = {};
      const requestsByItemDetails = {};

      // ✅ FIX: Initializing with itemsList covers all master indices, preventing TypeErrors on empty context pools
      itemsList.forEach(item => { 
      liveCounts[item.id] = 0; 
      rankingsByItem[item.id] = [];
      requestsByItemDetails[item.id] = {};
    });

    firebaseRequests.forEach(req => {
      if (req.userId === user.id) {
        const selStatus = (req.selectionStatus || 'pending').toLowerCase();
        const appStatus = (req.applicationStatus || '').toLowerCase();
        
        let targetItemId = req.itemId;
        if (!targetItemId && req.item) {
          const found = itemsList.find(i => i.name === req.item);
          if (found) targetItemId = found.id;
        }

        if (selStatus === 'pending' && targetItemId && liveCounts[targetItemId] !== undefined) {
          if (appStatus === 'requested') liveCounts[targetItemId] += req.quantity;
          if (appStatus === 'canceled')  liveCounts[targetItemId] -= req.quantity;
        }
      }
    });

    Object.keys(liveCounts).forEach(k => { if (liveCounts[k] < 0) liveCounts[k] = 0; });

    const membersListSnap = await db.ref('auction/members').once('value');
    const fullRosterArray = [];
    if (membersListSnap.exists()) {
      Object.values(membersListSnap.val()).forEach(m => {
        if (m?.displayName) fullRosterArray.push(m.displayName);
      });
    }

    // Query global commitments node tree to ensure state persistence across interface loads
    const commitmentsSnap = await db.ref('attendance/commitments').once('value');
    const commitmentsData = commitmentsSnap.exists() ? commitmentsSnap.val() : {};
    const membersData = membersListSnap.exists() ? membersListSnap.val() : {};

    // Phase 4 Clean Up: Query explicit administrative active instances to pipe down to the frontend
    const instancesSnap = await db.ref('scheduler/active_instances').once('value');
    const activeInstancesData = instancesSnap.exists() ? instancesSnap.val() : {};
    const { compileLeaderboard } = await import('../utils/sortingEngine.js');
    const computedLists = compileLeaderboard(firebaseRequests, itemsList, membersData);
    
    Object.assign(rankingsByItem, computedLists.rankingsByItem);
    Object.assign(requestsByItemDetails, computedLists.requestsByItemDetails);

    return res.json({
      success: true,
      displayName: playerDisplayName,
      date: targetSessionDate, 
      items: activeItemsList,
      liveCounts,
      isGateOpen: timeGateStatus.isGateOpen,
      currentSessionLabel: timeGateStatus.currentSessionLabel,
      nextStatusChangeMessage: timeGateStatus.nextStatusChangeMessage,
      currentPhase: timeGateStatus.currentPhase,
      phaseIntervals: timeGateStatus.phaseIntervals,
      eventId: timeGateStatus.activeEventId || "", 
      eventName: timeGateStatus.activeEventTitle || "Raid Session", 
      helpEmbedUrl: timeGateStatus.helpEmbedUrl || "",
      announcementMinutes: timeGateStatus.announcementMinutes || { phase1: [], phase2: null, phase3: null },
      events: dynamicConfig.events || {}, 
      commitments: commitmentsData, // Transmit the tracking map downstream to protect state cache values
      activeInstances: activeInstancesData, // Transmit administrative cancellations and operational custom notes
      rankingsByItem,
      requestsByItemDetails,
      fullRoster: fullRosterArray.sort(),
      members: membersListSnap.exists() ? membersListSnap.val() : {}
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/requests/sync-roster
 * Industry-standard Leaf-Level Synchronization Pass with Ghost Account Evaluation Rules
 */
router.post('/sync-roster', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = (getCurrentTenantId() || process.env.DISCORD_GUILD_ID);

  if (!botToken || !guildId) {
    return res.status(500).json({ success: false, error: 'Missing Discord credentials inside backend configurations.' });
  }

  if (isDiscordCircuitOpen()) {
    const status = getDiscordRateLimitStatus();
    return res.status(503).json({
      success: false,
      error: `Discord is temporarily blocking this server IP. Try again after ${status.untilHuman || status.remainingHuman}.`,
    });
  }

  try {
    const discordResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
      method: 'GET',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!discordResponse.ok) {
      const errorText = await discordResponse.text();
      let parsed = null;
      try { parsed = JSON.parse(errorText); } catch { parsed = { message: errorText }; }
      logDiscordHttpFailure('sync-roster members fetch', discordResponse, parsed);
      const status = getDiscordRateLimitStatus();
      if (isDiscordCircuitOpen()) {
        return res.status(503).json({
          success: false,
          error: `Discord is temporarily blocking this server IP. Try again after ${status.untilHuman || status.remainingHuman}.`,
        });
      }
      return res.status(discordResponse.status).json({ success: false, error: `Discord API communication rejected: ${errorText}` });
    }

    const discordMembers = await discordResponse.json();
    const db = getDatabase();
    
    const configSnap = await db.ref('settings/configuration').once('value');
    const timezone = configSnap.exists() ? (configSnap.val().timezone || "Asia/Manila") : "Asia/Manila";
    const currentTimestampDate = new Date().toLocaleDateString("en-US", { timeZone: timezone });
    
    const currentDbMembersSnap = await db.ref('auction/members').once('value');
    const currentDbMembers = currentDbMembersSnap.exists() ? currentDbMembersSnap.val() : {};

    const structuralLeafPatches = {};
    const discordActiveSnowflakeIds = new Set();

    discordMembers.forEach(member => {
      if (member.user?.id) {
        const uid = member.user.id;
        discordActiveSnowflakeIds.add(uid);

        const serverNickname = (member.nick || member.user?.global_name || member.user?.username || '').trim();
        const resolvedName = serverNickname || member.user.username || 'Unknown Member';
        const rawJoinedAt = member.joined_at ? new Date(member.joined_at).toISOString().slice(0, 10) : currentTimestampDate;

        structuralLeafPatches[`auction/members/${uid}/displayName`] = resolvedName;
        structuralLeafPatches[`auction/members/${uid}/syncedAt`] = currentTimestampDate;
        
        if (!currentDbMembers[uid]?.joinedAt) {
          structuralLeafPatches[`auction/members/${uid}/joinedAt`] = rawJoinedAt;
        }

        if (currentDbMembers[uid]?.status === 'Ghost') {
          structuralLeafPatches[`auction/members/${uid}/status`] = "Active";
        }
      }
    });

    Object.keys(currentDbMembers).forEach(dbUid => {
      // Dummies have no Discord identity, so the sync pass must never touch or Ghost them
      if (dbUid.startsWith('dummy_') || currentDbMembers[dbUid]?.isDummy === true) return;
      if (!discordActiveSnowflakeIds.has(dbUid)) {
        structuralLeafPatches[`auction/members/${dbUid}/status`] = "Ghost";
      }
    });

    if (Object.keys(structuralLeafPatches).length === 0) {
      return res.status(422).json({ success: false, error: 'No valid user profiles extracted.' });
    }

    await db.ref().update(structuralLeafPatches);
    return res.json({ success: true, count: Object.keys(structuralLeafPatches).length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/requests/submit
 */
router.post('/submit', async (req, res) => {
  const timeGateStatus = getGateStatusDetails();
  if (!timeGateStatus.isGateOpen) {
    return res.status(423).json({ success: false, error: `Bidding registration is closed. ${timeGateStatus.nextStatusChangeMessage}` });
  }

  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  const { selections } = req.body; 
  if (!selections || Object.keys(selections).length === 0) {
    return res.status(400).json({ success: false, error: 'No item selections detected.' });
  }

  try {
    const playerDisplayName = user.displayName || user.username;
    // ✅ FIXED: Declared playerLower locally to prevent the ReferenceError crash during ledger compilation
    const playerLower = playerDisplayName.trim().toLowerCase();
    const db = getDatabase();

    const configSnap = await db.ref('settings/configuration').once('value');
    const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
    const itemsList = dynamicConfig.items || [];
    const timezone = dynamicConfig.timezone || "Asia/Manila";
    const targetSessionDate = dynamicConfig.targetSessionDate || "";

    // 🩹 SELF-HEAL: if this raider's member record was purged or left nameless
    // (e.g. deleted while clearing a duplicate), repair it here so the bidding
    // boards can resolve their name again on the next request. This works even
    // on mobile clients that reuse a cached x-user-profile token and never
    // re-hit the OAuth callback. Never touch dummy_ ids and never overwrite an
    // existing Discord-owned displayName.
    if (user.id && !String(user.id).startsWith('dummy_')) {
      const memberSnap = await db.ref(`auction/members/${user.id}`).once('value');
      const existingMember = memberSnap.exists() ? memberSnap.val() : null;
      if (!existingMember || !existingMember.displayName) {
        await db.ref(`auction/members/${user.id}`).update({
          displayName: playerDisplayName,
          status: existingMember?.status || 'Active',
          syncedAt: new Date().toLocaleDateString("en-US", { timeZone: timezone }),
        });
      }
    }

    const chosenItemIds = Object.keys(selections);
    // 🚀 INDEXED MEMORY OPTIMIZATION: Query only this specific raider's history to minimize processing latency
    const snapshot = await db.ref('auction/web_requests')
      .orderByChild('userId')
      .equalTo(user.id)
      .once('value');
    const firebaseRequests = snapshot.exists() ? Object.values(snapshot.val()) : [];
    
    const currentNetCounts = {};
    itemsList.forEach(item => { currentNetCounts[item.id] = 0; });

    firebaseRequests.forEach(req => {
      if (req.userId === user.id && (req.selectionStatus || 'Pending') === 'Pending') {
        let targetItemId = req.itemId;
        if (!targetItemId && req.item) {
          const found = itemsList.find(i => i.name === req.item);
          if (found) targetItemId = found.id;
        }
        if (targetItemId && currentNetCounts[targetItemId] !== undefined) {
          if (req.applicationStatus.toLowerCase() === 'requested') currentNetCounts[targetItemId] += req.quantity;
          if (req.applicationStatus.toLowerCase() === 'canceled')  currentNetCounts[targetItemId] -= req.quantity;
        }
      }
    });

    // 2. Loop through the submission payload to process the transaction deltas
    for (const itemId of chosenItemIds) {
      const desiredQty = parseInt(selections[itemId], 10) || 0;
      const currentQty = currentNetCounts[itemId] || 0;
      const delta = desiredQty - currentQty;

      if (delta === 0) continue; // No modification made to this selection size, skip safely

      const resolvedItemObj = itemsList.find(i => i.id === itemId) || { name: itemId };
      const activeEvent = dynamicConfig.events?.[timeGateStatus.activeEventId];
      const maxAllowedLimit = activeEvent?.loots?.[itemId] || 0;

      // Validate quantity boundaries against cap maximums only when adding items
      if (desiredQty > maxAllowedLimit) {
        return res.status(422).json({ success: false, error: `Submission rejected: Requested volume for ${resolvedItemObj.name} exceeds the allowed event cap.` });
      }

      const dynamicPriority = await calculatePriorityScore(db, user.id, itemId, resolvedItemObj.name);
      const newRequestRef = db.ref('auction/web_requests').push();

      if (delta > 0) {
       // Log an incremental addition transaction record
        await newRequestRef.set({
          id: newRequestRef.key,
          userId: user.id,
          date: new Date().toLocaleDateString("en-US", { timeZone: timezone }),          
          time: new Date().toLocaleTimeString("en-US", { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }),
          member: playerDisplayName,
          item: resolvedItemObj.name, 
          itemId: itemId,             
          quantity: delta,
          applicationStatus: 'Requested', 
          selectionStatus: 'Pending',     
          liveStatus: '',                 
          priority: dynamicPriority,
          eventDate: targetSessionDate    
        });
      } else if (delta < 0) {
        // Log an incremental reduction transaction record
        await newRequestRef.set({
          id: newRequestRef.key,
          userId: user.id,
          date: new Date().toLocaleDateString("en-US", { timeZone: timezone }),          
          time: new Date().toLocaleTimeString("en-US", { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }),
          member: playerDisplayName,
          item: resolvedItemObj.name, 
          itemId: itemId,             
          quantity: Math.abs(delta),
          applicationStatus: 'Canceled', 
          selectionStatus: 'Pending',     
          liveStatus: '',                 
          priority: 0,
          eventDate: targetSessionDate    
        });
      }
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/requests/cancel
 */
router.post('/cancel', async (req, res) => {
  const timeGateStatus = getGateStatusDetails();
  if (timeGateStatus.currentPhase === 3) {
    return res.status(423).json({ success: false, error: 'Cancellations are locked during the Live Event / Auction phase.' });
  }

  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  const { itemId, itemName, cancelQty } = req.body;
  try {
    const playerDisplayName = user.displayName || user.username;
    const playerLower = playerDisplayName.trim().toLowerCase();
    const db = getDatabase();
    
    const configSnap = await db.ref('settings/configuration').once('value');
    const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
    const timezone = dynamicConfig.timezone || "Asia/Manila";
    const targetSessionDate = dynamicConfig.targetSessionDate || "";
    const itemsList = dynamicConfig.items || [];

    // 1. Query history to find current active balance to force total down to 0
    const snapshot = await db.ref('auction/web_requests').once('value');
    const firebaseRequests = snapshot.exists() ? Object.values(snapshot.val()) : [];
    
    let activeNetQty = 0;
    firebaseRequests.forEach(req => {
      if (req.userId === user.id && (req.selectionStatus || 'Pending') === 'Pending') {
        let targetItemId = req.itemId;
        if (!targetItemId && req.item) {
          const found = itemsList.find(i => i.name === req.item);
          if (found) targetItemId = found.id;
        }
        
        if (targetItemId === itemId || req.item === itemName) {
          if (req.applicationStatus.toLowerCase() === 'requested') activeNetQty += req.quantity;
          if (req.applicationStatus.toLowerCase() === 'canceled')  activeNetQty -= req.quantity;
        }
      }
    });

    if (activeNetQty <= 0) {
      return res.json({ success: true, message: 'Selection registry is already empty.' });
    }

    // 2. Append the formal cancellation entry to the request ledger history
    const newCancelRef = db.ref('auction/web_requests').push();
    await newCancelRef.set({
      id: newCancelRef.key,
      userId: user.id,
      date: new Date().toLocaleDateString("en-US", { timeZone: timezone }), 
      member: playerDisplayName,
      item: itemName || itemId,
      itemId: itemId || "item_unknown",
      quantity: activeNetQty,
      applicationStatus: 'Canceled', 
      selectionStatus: 'Pending',    
      liveStatus: '',                 
      priority: 0,
      eventDate: targetSessionDate 
    });

    // 🧼 3. AUTO-SCRUBBER HOOK: Silently clear this player out of active officer allocations
    const sessionSnap = await db.ref('auction/active_session').once('value');
    if (sessionSnap.exists()) {
      const sessionData = sessionSnap.val();
      const targetAllocationPath = `auction/active_session/categoryAllocations/${itemId}/selected`;
      let selectedList = sessionData.categoryAllocations?.[itemId]?.selected || [];

      if (selectedList.length > 0) {
        const initialLength = selectedList.length;
        let reclaimedSlotsCount = 0;

        // Strip the slots matching our user's unique ID from the allocation array
        selectedList = selectedList.filter(winner => {
          if (winner === user.id) {
            reclaimedSlotsCount += 1;
            return false;
          }
          return true;
        });

        // If a match was found and stripped, update the matrix rows and summary statistics counters
        if (selectedList.length !== initialLength) {
          await db.ref(targetAllocationPath).set(selectedList);

          if (sessionData.lootSummary?.[itemId]) {
            const currentSummary = sessionData.lootSummary[itemId];
            const updatedAllocatedQty = Math.max(0, (parseInt(currentSummary.qty, 10) || 0) - reclaimedSlotsCount);
            const updatedFilledSeats = Math.max(0, (parseInt(currentSummary.seats, 10) || 0) - 1);

            await db.ref(`auction/active_session/lootSummary/${itemId}`).update({
              qty: updatedAllocatedQty,
              seats: updatedFilledSeats
            });
          }
        }
      }
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Shared commit-session ledger writer. Consumed by the POST /commit-session route
 * and by the automatic auto-commit scheduler so both paths write an identical
 * atomic bundle (loot_history, past_auctions, web_request status flips) and clear
 * the active staging session. Throws on failure; callers own the HTTP/logging shell.
 */
export async function performCommitSession({ event, date, allocations, summary }) {
  const db = getDatabase();
  const configSnap = await db.ref('settings/configuration').once('value');
  const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
  const timezone = dynamicConfig.timezone || "Asia/Manila";
  const itemsList = dynamicConfig.items || [];

  if (!allocations) {
    throw new Error('No allocation parameters detected.');
  }

  {
    const snapshot = await db.ref('auction/web_requests').once('value');
    const firebaseRequests = snapshot.exists() ? snapshot.val() : {};

    const itemIds = Object.keys(allocations);
        let timestampDate = date || new Date().toLocaleDateString("en-US", { timeZone: timezone });
        
        // Normalize the frontend's raw HTML5 YYYY-MM-DD picker values down to standard MM/DD/YYYY slashes
        if (timestampDate && timestampDate.includes('-')) {
          const dParts = timestampDate.split('-');
          if (dParts.length === 3 && dParts[0].length === 4) {
            timestampDate = `${parseInt(dParts[1], 10)}/${parseInt(dParts[2], 10)}/${dParts[0]}`;
          }
        }
    
    // 🛡️ ATOMIC TRANSACTION BUNDLE: Consolidate all database actions into a single operational pass
    const atomicUpdates = {};

    const membersListSnap = await db.ref('auction/members').once('value');
    const membersData = membersListSnap.exists() ? membersListSnap.val() : {};
    const nameToUidMap = {};
    Object.entries(membersData).forEach(([uid, m]) => {
      if (m?.displayName) {
        // Strict Guard: Only map pure numeric Discord Snowflake UIDs
        if (/^\d+$/.test(uid)) {
          nameToUidMap[m.displayName.trim().toLowerCase()] = uid;
        }
      }
    });

    if (summary) {
      for (const itemKeyId of Object.keys(summary)) {
        const itemData = summary[itemKeyId];
        if (itemData && itemData.qty > 0) {
          const resolvedItem = itemsList.find(i => i.id === itemKeyId) || { name: itemKeyId };
          const newPushKey = db.ref('auction/loot_history').push().key;
          
          atomicUpdates[`auction/loot_history/${newPushKey}`] = {
            id: newPushKey,
            date: timestampDate,
            event: event || 'GuildLeague',
            item: resolvedItem.name,
            itemId: itemKeyId,
            quantity: parseInt(itemData.qty, 10),
            max: parseInt(itemData.limit, 10),
            mem: parseInt(itemData.seats, 10)
          };
        }
      }
    }

    for (const targetItemId of itemIds) {
      const { selected = [], absent = [], notSelected = [] } = allocations[targetItemId];
      const resolvedItem = itemsList.find(i => i.id === targetItemId) || { name: targetItemId };

      const keysByTrackingKey = {};
      Object.keys(firebaseRequests).forEach(key => {
        const r = firebaseRequests[key];
        let reqItemId = r.itemId;
        if (!reqItemId && r.item) {
          const found = itemsList.find(i => i.name === r.item);
          if (found) reqItemId = found.id;
        }

        if (reqItemId === targetItemId && (r.selectionStatus || 'pending').toLowerCase() === 'pending') {
          const tKey = r.userId;
          if (tKey) {
            if (!keysByTrackingKey[tKey]) keysByTrackingKey[tKey] = [];
            keysByTrackingKey[tKey].push(key);
          }
        }
      });

      const getKeysForUid = (uid) => {
        return keysByTrackingKey[uid] || [];
      };

      for (const uid of absent) {
        const keyList = getKeysForUid(uid);
        if (keyList.length > 0) {
          const finalKey = keyList[keyList.length - 1];
          atomicUpdates[`auction/web_requests/${finalKey}/selectionStatus`] = 'Absent';
          const redundant = keyList.slice(0, keyList.length - 1);
          for (const k of redundant) atomicUpdates[`auction/web_requests/${k}/selectionStatus`] = 'Superseded';
        }
      }

      for (const uid of notSelected) {
        const keyList = getKeysForUid(uid);
        if (keyList.length > 0) {
          const finalKey = keyList[keyList.length - 1];
          atomicUpdates[`auction/web_requests/${finalKey}/selectionStatus`] = 'NotSelected';
          const redundant = keyList.slice(0, keyList.length - 1);
          for (const k of redundant) atomicUpdates[`auction/web_requests/${k}/selectionStatus`] = 'Superseded';
        }
      }

      for (const winner of selected) {
        const { userId, name, slots } = winner;
        const keyList = getKeysForUid(userId);
        const resolvedName = name || membersData[userId]?.displayName || 'Unknown Member';

        if (keyList.length > 0) {
          const primaryWinnerKey = keyList[keyList.length - 1];
          atomicUpdates[`auction/web_requests/${primaryWinnerKey}/selectionStatus`] = 'Selected';
          atomicUpdates[`auction/web_requests/${primaryWinnerKey}/quantity`] = slots;
          atomicUpdates[`auction/web_requests/${primaryWinnerKey}/liveStatus`] = 'Done';

          const intermediateRedundantLines = keyList.slice(0, keyList.length - 1);
          for (const duplicateKey of intermediateRedundantLines) {
            atomicUpdates[`auction/web_requests/${duplicateKey}/selectionStatus`] = 'Superseded';
          }
        } else {
          const newRequestKey = db.ref('auction/web_requests').push().key;
          atomicUpdates[`auction/web_requests/${newRequestKey}`] = {
            id: newRequestKey,
            userId: userId,
            date: timestampDate,
            member: resolvedName,
            item: resolvedItem.name,
            itemId: targetItemId,
            quantity: slots,
            applicationStatus: 'ForcedAdd',
            selectionStatus: 'Selected',
            liveStatus: 'Done',
            priority: 0
          };
        }

        const newPastAuctionKey = db.ref('auction/past_auctions').push().key;
        atomicUpdates[`auction/past_auctions/${newPastAuctionKey}`] = {
          id: newPastAuctionKey,
          date: timestampDate,
          event: event || 'GuildLeague',
          item: resolvedItem.name,
          itemId: targetItemId,
          quantity: slots,
          userId: userId,
          mem: resolvedName
        };
      }
    }

    // 🧹 Tear down the active staging cache concurrently alongside our master updates payload block
    atomicUpdates['auction/active_session'] = null;

    // Fire everything down to Firebase in a single synchronized network pass
    await db.ref().update(atomicUpdates);
  }
}

/**
 * POST /api/requests/commit-session
 */
router.post('/commit-session', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  const db = getDatabase();
  const configSnap = await db.ref('settings/configuration').once('value');
  const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
  const allowedRoles = dynamicConfig.adminRoles || ["GUILD LEADER", "Vice Guild Leader", "Commander"];

  if (!verifyDiscordOfficerRole(user, allowedRoles)) {
    return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to authorized Discord Management Officers only.' });
  }

  const { event, date, allocations, summary } = req.body;
  if (!allocations) {
    return res.status(400).json({ success: false, error: 'No allocation parameters detected.' });
  }

  try {
    await performCommitSession({ event, date, allocations, summary });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/requests/reset-priority
 * 🛡️ OFFICER GUARDRAIL: Manual override for the High Value retained-priority ruling.
 * Writes a terminal 'Reset' marker into the ledger so calculatePriorityScore zeroes
 * the streak out from this point forward, without touching prior historical rows.
 */
router.post('/reset-priority', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  const db = getDatabase();
  const configSnap = await db.ref('settings/configuration').once('value');
  const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
  const allowedRoles = dynamicConfig.adminRoles || ["GUILD LEADER", "Vice Guild Leader", "Commander"];
  const timezone = dynamicConfig.timezone || "Asia/Manila";
  const itemsList = dynamicConfig.items || [];

  if (!verifyDiscordOfficerRole(user, allowedRoles)) {
    return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to authorized Discord Management Officers only.' });
  }

  const { userId: targetUserId, itemId } = req.body;
  if (!targetUserId || !itemId) {
    return res.status(400).json({ success: false, error: 'Missing target member or item identifier.' });
  }

  try {
    const resolvedItem = itemsList.find(i => i.id === itemId) || { name: itemId };
    const membersSnap = await db.ref('auction/members').once('value');
    const membersMap = membersSnap.exists() ? membersSnap.val() : {};
    const resolvedName = membersMap[targetUserId]?.displayName || 'Unknown Member';

    const newResetRef = db.ref('auction/web_requests').push();
    await newResetRef.set({
      id: newResetRef.key,
      userId: targetUserId,
      date: new Date().toLocaleDateString("en-US", { timeZone: timezone }),
      member: resolvedName,
      item: resolvedItem.name,
      itemId,
      quantity: 0,
      applicationStatus: 'AdminReset',
      selectionStatus: 'Reset',
      liveStatus: '',
      priority: 0
    });

    return res.json({ success: true, message: `Priority for ${resolvedName} on ${resolvedItem.name} has been manually reset.` });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/requests/clear-history
 * 🛡️ OFFICER GUARDRAIL: Permanently deletes Request History ledger rows whose
 * request Timestamp falls within an officer-selected date range (inclusive).
 */
router.post('/clear-history', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  const db = getDatabase();
  const configSnap = await db.ref('settings/configuration').once('value');
  const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
  const allowedRoles = dynamicConfig.adminRoles || ["GUILD LEADER", "Vice Guild Leader", "Commander"];

  if (!verifyDiscordOfficerRole(user, allowedRoles)) {
    return res.status(403).json({ success: false, error: 'Access Denied: Action restricted to authorized Discord Management Officers only.' });
  }

  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, error: 'Both a start and end date are required.' });
  }

  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(`${endDate}T23:59:59.999`);
  if (isNaN(rangeStart) || isNaN(rangeEnd) || rangeStart > rangeEnd) {
    return res.status(400).json({ success: false, error: 'Invalid date range.' });
  }

  try {
    const snapshot = await db.ref('auction/web_requests').once('value');
    const records = snapshot.exists() ? snapshot.val() : {};

    const atomicUpdates = {};
    let deletedCount = 0;
    Object.entries(records).forEach(([key, record]) => {
      const recordDate = new Date(record.date || '');
      if (!isNaN(recordDate) && recordDate >= rangeStart && recordDate <= rangeEnd) {
        atomicUpdates[`auction/web_requests/${key}`] = null;
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      await db.ref().update(atomicUpdates);
    }

    return res.json({ success: true, deletedCount });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/requests/loot-history
 */
router.get('/loot-history', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const lootHistorySnap = await db.ref('auction/loot_history').once('value');
    if (!lootHistorySnap.exists()) return res.json({ success: true, history: [] });

    const rawData = lootHistorySnap.val();
    const sortedKeys = Object.keys(rawData).sort();
    const lootHistoryArray = sortedKeys.map(key => ({
      id: key,
      date: rawData[key].date || "",
      event: rawData[key].event || "",
      item: rawData[key].item || "", 
      itemId: rawData[key].itemId || "",
      quantity: parseInt(rawData[key].quantity, 10) || 0,
      max: parseInt(rawData[key].max, 10) || 1,
      mem: parseInt(rawData[key].mem, 10) || 0
    }));

    return res.json({ success: true, history: lootHistoryArray.reverse() });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/requests/past-auctions
 */
router.get('/past-auctions', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const pastAuctionsSnap = await db.ref('auction/past_auctions').once('value');
    const membersSnap = await db.ref('auction/members').once('value');
    const membersMap = membersSnap.exists() ? membersSnap.val() : {};

    if (!pastAuctionsSnap.exists()) return res.json({ success: true, history: [], members: membersMap });

    const rawData = pastAuctionsSnap.val();
    const sortedKeys = Object.keys(rawData).sort();
    const pastAuctionsArray = sortedKeys.map(key => ({
      id: key,
      date: rawData[key].date || "",
      event: rawData[key].event || "",
      item: rawData[key].item || "", 
      itemId: rawData[key].itemId || "",
      quantity: parseInt(rawData[key].quantity, 10) || 0,
      userId: rawData[key].userId || "",
      // Read the historical member name directly from the row's 'mem' attribute fallback
      mem: rawData[key].mem || "Unknown Member"
    }));

    return res.json({ success: true, history: pastAuctionsArray.reverse(), members: membersMap });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/requests/request-history
 */
router.get('/request-history', async (req, res) => {
  const user = resolveUserIdentity(req);
  if (!user) return res.status(401).json({ success: false, error: 'Session identity missing' });

  try {
    const db = getDatabase();
    const historySnap = await db.ref('auction/web_requests').once('value');
    if (!historySnap.exists()) return res.json({ success: true, history: [] });

    // Grab the live presentation directory to resolve past names dynamically
    const membersSnap = await db.ref('auction/members').once('value');
    const membersMap = membersSnap.exists() ? membersSnap.val() : {};

    const rawData = historySnap.val();
    const sortedKeys = Object.keys(rawData).sort();
    const historyArray = sortedKeys.map(key => ({
      id: rawData[key].id || key,
      userId: rawData[key].userId || "",
      date: rawData[key].date || "",
      member: rawData[key].member || "Unknown Member",
      item: rawData[key].item || "",
      itemId: rawData[key].itemId || "",
      quantity: parseInt(rawData[key].quantity, 10) || 0,
      applicationStatus: rawData[key].applicationStatus || "Requested",
      selectionStatus: rawData[key].selectionStatus || "Pending",
      liveStatus: rawData[key].liveStatus || "", 
      priority: parseInt(rawData[key].priority, 10) || 0,
      eventDate: rawData[key].eventDate || ""
    }));

    return res.json({ success: true, history: historyArray.reverse() });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;