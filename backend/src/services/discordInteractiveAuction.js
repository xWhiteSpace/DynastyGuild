// backend/src/services/discordInteractiveAuction.js
import { getDatabase } from '../db/database.js';
import { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getGateStatusDetails } from '../config/timeWindow.js'; // ⏰ Timeline Intersector: Imports master clock calculations

// Pure message text block formatting the in-game display alignment rule
const IN_GAME_TAB_REMINDER = `🚩 **PLEASE READ!!**:\n` +
  `> Please make sure to **click** the **[GUILD AUCTION]** and **[ALL]** Tab on your in-game auction book screen! ` +
  `This guarantees your game client layout matches our Request Page and Slot numbering system.`;

/**
 * Phase 3 Actual Bid Limit: Loot Registry (session lootSummary) is source of truth.
 * Settings loots remain the fallback seed when summary has not been allocated yet.
 */
function resolveActualBidLimit(session, settingsLoots, itemId) {
  const sessionLimit = session?.lootSummary?.[itemId]?.limit;
  if (sessionLimit !== undefined && sessionLimit !== null && Number(sessionLimit) >= 1) {
    return Number(sessionLimit);
  }
  if (settingsLoots && settingsLoots[itemId] !== undefined) {
    return settingsLoots[itemId];
  }
  return 0;
}

/**
 * ⚙️ CORE COMPILER: Calculates book geometry coordinates dynamically in runtime memory
 * Projects a pure Single Source of Truth layout map out of Phase 2 flat allocation arrays.
 */
function computeVirtualMatrix(items, categoryAllocations, qtyPerPage = 4, membersMap = {}) {
  let currentVirtualPage = 1, currentVirtualSlot = 1;
  const matrix = [];

  items.forEach(item => {
    const rawSelectedNode = categoryAllocations[item.id]?.selected;
    const flatBoxArray = Array.isArray(rawSelectedNode)
      ? rawSelectedNode
      : Object.values(rawSelectedNode || {});

    flatBoxArray.forEach((slotValue, index) => {
      const slotUid = /^\d+$/.test(slotValue) ? slotValue : null;
      const slotName = slotUid ? (membersMap[slotUid]?.displayName || slotUid) : slotValue;

      matrix.push({
        itemType: item.id,
        itemName: item.name,
        index: index, 
        page: currentVirtualPage,
        slot: currentVirtualSlot,
        name: slotName === "" ? "" : slotName,
        uid: slotUid
      });

      currentVirtualSlot++;
      if (currentVirtualSlot > qtyPerPage) {
        currentVirtualSlot = 1;
        currentVirtualPage++;
      }
    });
  });
  return matrix;
}

/**
 * 🛰️ HELPER: Dynamically generates the real-time personal ledger claim summary text block
 */
function compileUserClaimsSummary(virtualMatrix, userId, finalRosterName) {
  const matchingClaims = virtualMatrix.filter(slot => slot.uid === userId );

  if (matchingClaims.length === 0) {
    return `📦 **YOUR REQUEST LIST SUMMARY**:\n*• No item slot coordinates secured yet during this session.*`;
  }

  const listLines = matchingClaims.map(slot => 
    `• **${slot.itemName}** ➔ Page ${slot.page}, Slot ${slot.slot}`
  );

  return `📦 **YOUR REQUEST LIST SUMMARY**:\n${listLines.join('\n')}`;
}

/**
 * 📣 Renders the permanent, pinned public message card containing the launch action button
 */
export async function sendPublicAuctionCard(channel) {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ LIVE AUCTION INTERACTION PANEL')
    .setDescription('During Live Auction, Please Review and claim remaining vacant item slots right here.\n\nClick the button below to open your personal Request panel.')
    .setColor('#4f46e5');

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_auction_panel')
      .setLabel('🔍 Open My Personal Request Panel')
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [buttonRow] });
}

/**
 * 🛰️ HELPER: Generates the Master Item Category Selection View (Step 2)
 */
async function renderItemCategoryView(interaction, finalRosterName, prefixMessage = "") {
  const db = getDatabase();
  const configSnap = await db.ref('settings/configuration').once('value');
  const sessionSnap = await db.ref('auction/active_session').once('value');

  if (!sessionSnap.exists() || !configSnap.exists()) {
    return await interaction.editReply({ content: '❌ **ERROR**: No active allocation session is currently running on the officer dashboard.', components: [] });
  }

  const { items = [] } = configSnap.val();
  const { categoryAllocations = {}, qtyPerPage = 4 } = sessionSnap.val();

  const membersSnap = await db.ref('auction/members').once('value');
  const membersMap = membersSnap.exists() ? membersSnap.val() : {};

  // Compile dynamic layout map from Phase 2 array blocks using relational lookups
  const virtualMatrix = computeVirtualMatrix(items, categoryAllocations, qtyPerPage, membersMap);

  const itemVacancyCounts = {};
  virtualMatrix.forEach(slot => {
    if (slot.name === "") {
      itemVacancyCounts[slot.itemType] = (itemVacancyCounts[slot.itemType] || 0) + 1;
    }
  });

  // 🚀 ALIGNMENT OVERRIDE Pass: If the dashboard switch is manually turned ON, bypass strict calendar clock constraints
  const isDashboardOverrideActive = sessionSnap.exists() && sessionSnap.val().isDiscordGateOpen === true;
  
  const gateDetails = getGateStatusDetails() || {};
  const activeEventObj = configSnap.val().events?.[gateDetails.activeEventId || Object.keys(configSnap.val().events || {})[0]];
  const activeLoots = activeEventObj?.loots || {};

  const menuOptions = items
    .filter(item => {
      const isItemActiveInDropPool = isDashboardOverrideActive || (activeLoots[item.id] !== undefined);
      return isItemActiveInDropPool && (itemVacancyCounts[item.id] || 0) > 0;
    })
    .map(item => ({
      label: item.name,
      description: `${itemVacancyCounts[item.id] || 0} empty layout slots available.`,
      value: `select_item_${item.id}`
    }));

  const userClaimsSummaryText = compileUserClaimsSummary(virtualMatrix, interaction.user.id, finalRosterName);

  if (Object.keys(activeLoots).length === 0) {
    return await interaction.editReply({
      content: `${prefixMessage}\n\n❌ **NO ITEMS SCHEDULED**: There are no items scheduled for registration in tonight's auction cycle.`,
      components: []
    });
  }

  if (menuOptions.length === 0) {
    return await interaction.editReply({ 
      content: `${prefixMessage}\n\n${IN_GAME_TAB_REMINDER}\n\n${userClaimsSummaryText}\n\n🎉 **ALL OPEN SLOTS CLAIMED**: Every single available slots has been filled!`, 
      components: [] 
    });
  }

  const isGateOpen = sessionSnap.val().isDiscordGateOpen === true;
  
  const baseContent = `🔒 **USER INFORMATION**\n👤 Name: **${finalRosterName}**\n\n${IN_GAME_TAB_REMINDER}\n\n${userClaimsSummaryText}\n\n${
    !isGateOpen 
      ? "🚫 **AUCTION PAUSED**: Bidding controls are currently muted. Please stand by for management to broadcast the allocation sequence." 
      : "Please choose an Item category below to view open & available slots:"
  }`;

  const components = isGateOpen ? [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('auction_select_item_type')
        .setPlaceholder('Select a Loot Category...')
        .addOptions(menuOptions)
    )
  ] : [];

  await interaction.editReply({
    content: prefixMessage ? `${prefixMessage}\n\n${baseContent}` : baseContent,
    components: components
  });
}

/**
 * 🛰️ HELPER: Generates the Fast-Tap Button Grid Matrix (Step 3 Upgraded)
 */
async function renderSpecificSlotView(interaction, itemId, finalRosterName, prefixMessage = "") {
  const db = getDatabase();
  const configSnap = await db.ref('settings/configuration').once('value');
  const sessionSnap = await db.ref('auction/active_session').once('value');

  const { items = [] } = configSnap.val();
  const sessionData = sessionSnap.exists() ? sessionSnap.val() : {};
  const { categoryAllocations = {}, qtyPerPage = 4 } = sessionData;

  const selectedItemObj = items.find(i => i.id === itemId);
  const gateDetails = getGateStatusDetails() || {};
  const activeEventObj = configSnap.val().events?.[gateDetails.activeEventId];
  const maxAllowedLimit = resolveActualBidLimit(sessionData, activeEventObj?.loots, itemId);

  const membersSnap = await db.ref('auction/members').once('value');
  const membersMap = membersSnap.exists() ? membersSnap.val() : {};

  const virtualMatrix = computeVirtualMatrix(items, categoryAllocations, qtyPerPage, membersMap);
  const userClaimedCount = virtualMatrix.filter(s => s.itemType === itemId && s.uid === interaction.user.id).length;

  // Build functional buttons using the index location inside categoryAllocations list maps
  const rawButtonsArray = [];
  virtualMatrix.forEach((slot) => {
    if (slot.itemType === itemId && slot.name === "") {
      rawButtonsArray.push(
        new ButtonBuilder()
          .setCustomId(`claim_slot_btn_${slot.index}_item_${itemId}`) // Maps straight to flat index
          .setLabel(`Page ${slot.page} Slot ${slot.slot}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
  });

  const userClaimsSummaryText = compileUserClaimsSummary(virtualMatrix, interaction.user.id, finalRosterName);

  if (userClaimedCount >= maxAllowedLimit) {
    return await renderItemCategoryView(interaction, finalRosterName, `❌ **CLAIM RESTRICTED**: You have reached your capacity limit (**${userClaimedCount}/${maxAllowedLimit}**) for **${selectedItemObj?.name}**.`);
  }

  if (rawButtonsArray.length === 0) {
    return await renderItemCategoryView(interaction, finalRosterName, `⚠️ **CATEGORY EXPIRED**: The remaining slots for **${selectedItemObj?.name}** were just snapped up!`);
  }

  // 🛡️ DYNAMIC CEILING GUARD: Self-calculates the maximum button capacity based on active navigation items
  const utilityRowsReserved = 1; // Rows explicitly claimed by Back/Utility controls
  const totalAvailableSlotRows = 5 - utilityRowsReserved; // Discord maximum absolute limit is 5 rows per view
  const maxSafeButtonCapacity = totalAvailableSlotRows * 5; // Exactly 5 button elements can fit per ActionRow frame

  const cappedButtons = rawButtonsArray.slice(0, maxSafeButtonCapacity);
  const totalComponentRows = [];

  for (let i = 0; i < cappedButtons.length; i += 5) {
    const actionRow = new ActionRowBuilder().addComponents(cappedButtons.slice(i, i + 5));
    totalComponentRows.push(actionRow);
  }

  const backButton = new ButtonBuilder()
    .setCustomId('open_auction_panel_back')
    .setLabel('↩️ Return to Categories')
    .setStyle(ButtonStyle.Danger);

  const utilityRow = new ActionRowBuilder().addComponents(backButton);
  totalComponentRows.push(utilityRow);

  const baseContent = `📋 **Loot Target**: **${selectedItemObj?.name}**\n👤 Your Limit Status: **${userClaimedCount}/${maxAllowedLimit} Claimed**\n\n${IN_GAME_TAB_REMINDER}\n\n${userClaimsSummaryText}\n\nTap any vacant grid coordinate button below to lock your claim instantly:`;

  await interaction.editReply({
    content: prefixMessage ? `${prefixMessage}\n\n${baseContent}` : baseContent,
    components: totalComponentRows
  });
}

/**
 * ⚡ CORE INTERACTION INTERCEPT ROUTINE
 */
export async function handleAuctionInteraction(interaction) {
  const db = getDatabase();

  // ⏱️ ACK-FIRST: acknowledge based on the component (customId — no I/O) BEFORE
  // any Firebase read, so slow/cold reads can never expire the interaction token
  // and surface as "Unknown interaction" (10062). The public entry button opens
  // a fresh ephemeral panel (deferReply); every other control edits in place
  // (deferUpdate).
  const opensNewPanel = interaction.isButton() && interaction.customId === 'open_auction_panel';
  if (opensNewPanel) {
    await interaction.deferReply({ ephemeral: true });
  } else {
    await interaction.deferUpdate();
  }

  // 🚨 ABSOLUTE EMERGENCY OVERRIDE SHIELD: Instantly terminate all gateway interactions if Forced Lock is active
  const globalConfigSnap = await db.ref('settings/configuration').once('value');
  if (globalConfigSnap.exists() && globalConfigSnap.val().isForceLocked === true) {
    const lockdownNotice = `🚨 **ADMINISTRATIVE LOCKDOWN**: The bidding framework has been completely frozen by management. Discord inputs are currently offline.`;
    await interaction.editReply({ content: lockdownNotice, components: [] }).catch(() => {});
    return;
  }

  const finalRosterName = (interaction.member?.nickname || interaction.member?.displayName || interaction.user?.globalName || interaction.user?.username || '').trim();
  // 🛡️ SLASH SHIELD: Added forward slash to the regex catch to prevent directory folder breakages
  const sanitizedFirebaseKey = finalRosterName.replace(/[\.\#\$\/\[\]]/g, '_');

    // ─── STEP 1: USER CLICKS THE PUBLIC ENTRY BUTTON ───
  if (interaction.isButton() && interaction.customId === 'open_auction_panel') {
    // (ack handled at top via deferReply)

    // 🛡️ SECURE DISCORD INPUT INTERCEPTOR: Checks the manual override switch on your admin dashboard before accepting inputs
    const sessionSnap = await db.ref('auction/active_session').once('value');
    const isGateOpen = sessionSnap.exists() && sessionSnap.val().isDiscordGateOpen === true;

    // Removed the hard-block check here so that renderItemCategoryView 
    // can display the persistent view even when isGateOpen is false.

    const memberCheckSnap = await db.ref(`auction/members/${interaction.user.id}`).once('value');
    if (!memberCheckSnap.exists()) {
      return await interaction.editReply({
        content: `⚠️ **ROSTER DISCONNECT**: Your Discord account ID is not linked to an active guild roster row.\n\n👉 *Please tell a Guild officer to Synchronize the web app profile again.*`
      });
    }

    await renderItemCategoryView(interaction, finalRosterName);
  }

  // ─── LOOPBACK JUMP: USER CLICKS THE BACK BUTTON INSIDE THE CORE WORKFLOW ───
  if (interaction.isButton() && interaction.customId === 'open_auction_panel_back') {
    // (ack handled at top via deferUpdate)
    await renderItemCategoryView(interaction, finalRosterName);
  }

  // ─── STEP 2: USER SELECTS AN ITEM CATEGORY DROPDOWN ───
  if (interaction.isStringSelectMenu() && interaction.customId === 'auction_select_item_type') {
    // (ack handled at top via deferUpdate)
    const itemId = interaction.values[0].replace('select_item_', '');
    await renderSpecificSlotView(interaction, itemId, finalRosterName);
  }

  // ─── STEP 3 & 4: USER TAPS A SPECIFIC GRID CANVAS BUTTON MATRIX CELL ───
  if (interaction.isButton() && interaction.customId.startsWith('claim_slot_btn_')) {
    // (ack handled at top via deferUpdate)

    const rawValueToken = interaction.customId.replace('claim_slot_btn_', '');
    const valueParts = rawValueToken.split('_item_');

    const targetIndex = parseInt(valueParts[0], 10);
    const itemId = valueParts[1];

    try {
      const preClaimConfigSnap = await db.ref('settings/configuration').once('value');
      const gateDetailsForClaim = getGateStatusDetails() || {};
      const settingsLootsForClaim = preClaimConfigSnap.val()?.events?.[gateDetailsForClaim.activeEventId]?.loots || {};

        // 🚀 UNIFIED MULTI-WRITER ALIGNMENT: Elevate transaction to the root node to update coordinates and increment master version simultaneously
      const txResult = await db.ref('auction/active_session').transaction((currentSession) => {
        if (!currentSession) return currentSession;

        if (!currentSession.categoryAllocations) {
          currentSession.categoryAllocations = {};
        }
        if (!currentSession.categoryAllocations[itemId]) {
          currentSession.categoryAllocations[itemId] = { selected: [] };
        }

        let selectedList = currentSession.categoryAllocations[itemId].selected;
        if (!selectedList) {
          selectedList = [];
        } else if (!Array.isArray(selectedList)) {
          selectedList = Object.values(selectedList);
        }

        // Force fill empty spaces up to target index to prevent sparse array skips
        while (selectedList.length <= targetIndex) {
          selectedList.push("");
        }

        // Anti-collision guard: Check if another thread claimed it first
        if (selectedList[targetIndex] !== "") {
          return; // 🛑 Abort transaction safely if slot is occupied
        }

        // Enforce Actual Bid Limit from Loot Registry before assigning the claim
        const maxAllowedLimit = resolveActualBidLimit(currentSession, settingsLootsForClaim, itemId);
        const currentUserClaims = selectedList.filter(slotValue => slotValue === interaction.user.id).length;
        if (maxAllowedLimit > 0 && currentUserClaims >= maxAllowedLimit) {
          return; // 🛑 Abort — member already at Actual Bid Limit
        }

        selectedList[targetIndex] = interaction.user.id; // Pure relational ID assignment
        currentSession.categoryAllocations[itemId].selected = selectedList;

        // Atomically advance the master sequence number to clear the dashboard fence
        const activeVersion = parseInt(currentSession.version, 10) || 0;
        currentSession.version = activeVersion + 1;
        currentSession.lastUpdated = Date.now();

        return currentSession;
      });

      // Differentiate slot collision vs Actual Bid Limit abort
      if (!txResult.committed) {
        const abortedSession = txResult.snapshot?.val() || {};
        let abortedSelected = abortedSession.categoryAllocations?.[itemId]?.selected || [];
        if (!Array.isArray(abortedSelected)) abortedSelected = Object.values(abortedSelected);
        const slotOccupied = abortedSelected[targetIndex] && abortedSelected[targetIndex] !== "";
        const abortedLimit = resolveActualBidLimit(abortedSession, settingsLootsForClaim, itemId);
        const abortedUserClaims = abortedSelected.filter(slotValue => slotValue === interaction.user.id).length;
        if (!slotOccupied && abortedLimit > 0 && abortedUserClaims >= abortedLimit) {
          throw new Error('LIMIT_REACHED');
        }
        throw new Error('COLLISION_DETECTED');
      }

      const updatedConfigSnap = preClaimConfigSnap;
      const localSessionCacheSnap = await db.ref('auction/active_session').once('value');
      const membersSnap = await db.ref('auction/members').once('value');
      
      const finalItems = updatedConfigSnap.val().items || [];
      const sessionCacheObj = localSessionCacheSnap.val() || {};
      const finalQtyPerPage = sessionCacheObj.qtyPerPage || 4;
      const membersMap = membersSnap.exists() ? membersSnap.val() : {};
      
      // Inject the atomic array patch directly into our local session cache memory block from the hoisted root snapshot
      const finalAllocations = sessionCacheObj.categoryAllocations || {};
      if (finalAllocations[itemId]) {
        const committedSession = txResult.snapshot.val();
        const committedSelected = committedSession?.categoryAllocations?.[itemId]?.selected;
        finalAllocations[itemId].selected = Array.isArray(committedSelected)
          ? committedSelected
          : Object.values(committedSelected || {});
      }

      const freshMatrix = computeVirtualMatrix(finalItems, finalAllocations, finalQtyPerPage, membersMap);
      const resolvedSlot = freshMatrix.find(s => s.itemType === itemId && s.index === targetIndex);
        // 🔍 LIMIT INTEGRITY CHECK: Actual Bid Limit from Loot Registry session (Settings fallback)
      const activeEventObj = updatedConfigSnap.val().events?.[gateDetailsForClaim.activeEventId];
      const maxAllowedLimit = resolveActualBidLimit(sessionCacheObj, activeEventObj?.loots, itemId);
      const userClaimedCount = freshMatrix.filter(s => s.itemType === itemId && s.uid === interaction.user.id).length;

      if (userClaimedCount >= maxAllowedLimit) {
        // 🚪 LIMIT EXHAUSTED KICKBACK: Auto-transfer them back to categories menu with a comprehensive notice
        const limitReachedBanner = `✅ **SUCCESSFULLY SECURED!**\n• Item Locked: **${resolvedSlot?.itemName} (Page ${resolvedSlot?.page}, Slot ${resolvedSlot?.slot})**\n\n🎉 **LIMIT COMPLETED**: You have fully filled your allocation quota (**${userClaimedCount}/${maxAllowedLimit}**) for this item category!...`;
        await renderItemCategoryView(interaction, finalRosterName, limitReachedBanner);
      } else {
        // 🕹️ STAY-AND-TAP CONTINUATION: Keep them locked on this exact grid view to rapid-fire their remaining bids
        const continuousBanner = `✅ **SUCCESSFULLY SECURED!**\n• Item Locked: **${resolvedSlot?.itemName} (Page ${resolvedSlot?.page}, Slot ${resolvedSlot?.slot})**\n• Running Total: **${userClaimedCount}/${maxAllowedLimit} Secured**\n\n*The ledger has updated. Tap another open item below to claim slot:*`;
        await renderSpecificSlotView(interaction, itemId, finalRosterName, continuousBanner);
      }

    } catch (err) {
      // Re-read current database layout parameters to recover slot details safely for collision receipts
      const updatedConfigSnap = await db.ref('settings/configuration').once('value');
      const updatedSessionSnap = await db.ref('auction/active_session').once('value');
      const finalItems = updatedConfigSnap.val().items || [];
      const finalAllocations = updatedSessionSnap.val().categoryAllocations || {};
      const finalQtyPerPage = updatedSessionSnap.val().qtyPerPage || 4;
      const freshMatrix = computeVirtualMatrix(finalItems, finalAllocations, finalQtyPerPage);
      const resolvedSlot = freshMatrix.find(s => s.itemType === itemId && s.index === targetIndex);
      if (err.message === 'LIMIT_REACHED') {
        const gateDetails = getGateStatusDetails() || {};
        const activeEventObj = updatedConfigSnap.val().events?.[gateDetails.activeEventId];
        const maxAllowedLimit = resolveActualBidLimit(updatedSessionSnap.val(), activeEventObj?.loots, itemId);
        const membersSnap = await db.ref('auction/members').once('value');
        const membersMap = membersSnap.exists() ? membersSnap.val() : {};
        const limitMatrix = computeVirtualMatrix(finalItems, finalAllocations, finalQtyPerPage, membersMap);
        const userClaimedCount = limitMatrix.filter(s => s.itemType === itemId && s.uid === interaction.user.id).length;
        await renderItemCategoryView(
          interaction,
          finalRosterName,
          `❌ **CLAIM RESTRICTED**: You have reached your capacity limit (**${userClaimedCount}/${maxAllowedLimit}**) for this item category.`
        );
      } else if (err.message === 'COLLISION_DETECTED') {
        // 🎯 Safely parse coordinates directly from the dynamically compiled memory matrix 
        const collisionBanner = `⚠️ **SLOT OCCUPIED!** Another member claimed **Page ${resolvedSlot?.page || '?'}, Slot ${resolvedSlot?.slot || '?'}** right before you tapped.\n\n*No layout cells were overwritten. Try claiming another item below:*`;

        // Loop back smoothly inside that SAME button view so they can try an adjacent button instantly
        await renderSpecificSlotView(interaction, itemId, finalRosterName, collisionBanner);
      } else {
        console.error("Button Matrix Open Loop Step 3 Exception Caught:", err.message);
        await interaction.editReply({ content: '❌ Critical error executing real-time database ledger updates.', components: [] });
      }
    }
  }
}