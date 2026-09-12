import { getDatabase } from '../db/database.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { ensureWeekInstances, resolveGuildTimezone } from '../services/scheduleService.js';
import {
  applyAttendanceDecision,
  getDefaultLeaveCredits,
  getEventDeadlineMs,
} from '../services/attendanceDecision.js';
import { buildCompositeKey, parseCompositeKey } from '../utils/guildTime.js';

async function generateRSVPMatrixDashboard(db, snowflakeId, page = 1) {
  const timezone = await resolveGuildTimezone(db);
  const { weekMonday, instances } = await ensureWeekInstances({});
  const [memberSnap, configSnap] = await Promise.all([
    db.ref(`auction/members/${snowflakeId}`).once('value'),
    db.ref('settings/configuration').once('value'),
  ]);
  const member = memberSnap.exists() ? memberSnap.val() : {};
  const defaultCredits = getDefaultLeaveCredits(configSnap.exists() ? configSnap.val() : {});
  const credits = Number.isInteger(member.leaveCreditsRemaining)
    ? member.leaveCreditsRemaining
    : defaultCredits;

  const sorted = Object.entries(instances || {})
    .map(([key, inst]) => ({ key, ...inst }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.timeStart || '').localeCompare(b.timeStart || ''));

  const embed = new EmbedBuilder()
    .setTitle('🗓️ Upcoming Week Sign-Up (7 Days)')
    .setDescription(
      `Review active raid deployments for week starting \`${weekMonday}\` (Monday - Sunday).\n` +
        `Leave Credits: **${credits}**  •  RSVP locks 24 hours before start.`
    )
    .setColor('#9333ea')
    .setTimestamp();

  const componentRows = [];

  for (const ev of sorted) {
    const compositeKey = ev.key || buildCompositeKey(ev.date, ev.eventId);
    const commitmentSnap = await db.ref(`attendance/commitments/${compositeKey}/${snowflakeId}`).once('value');
    const userStatus = commitmentSnap.exists() ? commitmentSnap.val().status : 'Unanswered';

    const isCancelled = ev.isCancelled === true;
    const deadlineMs = getEventDeadlineMs(ev, timezone);
    const pastDeadline = Number.isFinite(deadlineMs) && Date.now() > deadlineMs;
    const customTitle = ev.title || ev.eventId;
    const customNotes = ev.notes ? `\n📝 **Notes:** ${ev.notes}` : '';
    const typeLabel = ev.isSpecial ? 'Special' : 'Weekly';

    embed.addFields([{
      name: `${isCancelled ? '❌ [CANCELLED]' : (ev.isSpecial ? '⚔️' : '📅')} ${customTitle}`,
      value: `Target Window: \`${ev.date}\` | Current Status: **${isCancelled ? 'N/A' : userStatus}**${customNotes}`,
      inline: false
    }]);

    const row = new ActionRowBuilder();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`lbl:${typeLabel}:${ev.eventId}`.slice(0, 100))
        .setLabel(`${String(customTitle).slice(0, 10)}...`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`matrsvp:confirm:${compositeKey}:1`)
        .setLabel(userStatus === 'Confirmed' ? '✅ Confirmed' : 'Confirm')
        .setStyle(userStatus === 'Confirmed' ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(isCancelled || pastDeadline)
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`matrsvp:leave:${compositeKey}:${page}`)
        .setLabel(userStatus === 'Leave' ? '❌ Leave' : 'Leave')
        .setStyle(userStatus === 'Leave' ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setDisabled(isCancelled || pastDeadline || (credits <= 0 && userStatus !== 'Leave'))
    );

    componentRows.push(row);
  }

  return { embeds: [embed], components: componentRows };
}

/**
 * 📣 CENTRAL SLASH COMMAND ROUTER
 */
export async function handleSlashCommand(interaction) {
  const { commandName } = interaction;
  const db = getDatabase(); // Establish direct Realtime DB handle[cite: 1]
  const snowflakeId = interaction.user.id; // Unique Snowflake key[cite: 1, 2]

  // ⏱️ ACK-FIRST: acknowledge within Discord's hard 3-second window BEFORE any
  // Firebase read or REST call. Slow/cold reads can otherwise expire the
  // interaction token and surface as "Unknown interaction" (10062). Everything
  // below responds via editReply against this deferred (ephemeral) ack.
  const KNOWN_COMMANDS = ['jobchange', 'rolechange', 'namechange', 'event', 'myparty'];
  if (!KNOWN_COMMANDS.includes(commandName)) return;
  await interaction.deferReply({ ephemeral: true });

  // Phase 3: Global System Lockdown Verification Gate
  if (['jobchange', 'rolechange', 'event'].includes(commandName)) {
    const globalConfigSnap = await db.ref('settings/configuration').once('value');
    if (globalConfigSnap.exists() && globalConfigSnap.val().isForceLocked === true) {
      return await interaction.editReply({ content: '🔒 System Notice: The database is currently locked down by an administrative freeze. Modification requests are suspended.' });
    }
  }

  // 1. /jobchange Execution
  if (commandName === 'jobchange') {
    const configSnap = await db.ref('settings/configuration/jobs').once('value'); //[cite: 1]
    if (!configSnap.exists()) return interaction.editReply({ content: '❌ Jobs database catalog missing.' });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_job_selection')
      .setPlaceholder('Select your active character class spec...')
      .addOptions(Object.entries(configSnap.val()).map(([code, jobObj]) => ({
        label: jobObj.name || code,
        value: code // Maps to standard jobCode properties[cite: 1]
      })));

    return await interaction.editReply({ content: 'Select your new Job Class:', components: [new ActionRowBuilder().addComponents(menu)] });
  }

  // 2. /rolechange Execution
  if (commandName === 'rolechange') {
    const configSnap = await db.ref('settings/configuration/roles').once('value');
    if (!configSnap.exists()) return interaction.editReply({ content: '❌ Roles database catalog missing.' });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_role_selection')
      .setPlaceholder('Select your primary combat group role...')
      .addOptions(Object.entries(configSnap.val()).map(([code, roleObj]) => ({
        label: roleObj.name || code,
        value: code
      })));

    return await interaction.editReply({ content: 'Select your Combat Role assignment:', components: [new ActionRowBuilder().addComponents(menu)] });
  }

  // 3. /namechange Execution
  if (commandName === 'namechange') {
    const desiredNickname = interaction.options.getString('nickname');
    try {
      await interaction.member.setNickname(desiredNickname);
      return await interaction.editReply({ content: `✅ Guild server display profile name shifted to **${desiredNickname}**.` });
    } catch (err) {
      return await interaction.editReply({ content: '❌ Security baseline mutation blocked. Server owners or higher ranked roles cannot be renamed by automation bots.' });
    }
  }

  // 4. /event Execution (Upgraded Button Matrix Board Layout)
  if (commandName === 'event') {
    try {
      const payload = await generateRSVPMatrixDashboard(db, snowflakeId, 1);
      return await interaction.editReply(payload);
    } catch (err) {
      console.error("Matrix generation error:", err);
      return await interaction.editReply({ content: '❌ Internal failure compiling the matrix dashboard.' });
    }
  }

  // 5. /myparty Execution (Fixed Roster Schema Verification Pipeline)
  if (commandName === 'myparty') {
    const liveSessionSnap = await db.ref('attendance/live_session').once('value'); //[cite: 2]

    if (!liveSessionSnap.exists()) {
      return await interaction.editReply({
        content:
          '❌ No active Live Raid session found.\n' +
          'Open the **Live Raid** tab on the dashboard and click **Start Live Raid Deck** first.\n' +
          '_(Raid Party planning alone does not create a live session.)_'
      });
    }

    const liveData = liveSessionSnap.val();
    if (!liveData || liveData.status !== 'Active') {
      return await interaction.editReply({
        content:
          '❌ Live Raid data exists but is not marked **Active**.\n' +
          'End/cancel any stuck session on the dashboard, then start a fresh Live Raid.'
      });
    }

    // Phase 3 Mitigation: Assert cross-reference checks against explicit instance cancellations
    const currentActiveDateStr = new Date().toISOString().split('T')[0];
    const activeEventIdField = liveData.eventId || liveData.eventKey || "unknown";
    const activeInstanceKey = `${currentActiveDateStr}_${activeEventIdField}`;
    const activeInstanceCheck = await db.ref(`scheduler/instances/${activeInstanceKey}`).once('value');
    if (activeInstanceCheck.exists() && activeInstanceCheck.val().isCancelled === true) {
      return await interaction.editReply({ content: '🛑 Notice: The scheduled raid operation assigned for tonight has been marked as officially CANCELLED by guild officers.' });
    }
    let locatedSlot = null;
    let raidConfigName = null;
    let raidLeaderName = null;
    let subLeaderName = null;

    if (liveData.grids) {
      for (const [gridId, gridObj] of Object.entries(liveData.grids)) {
        if (!gridObj.slots_allocation) continue;

        let viewerCol = null;
        let viewerSlotLabel = null;
        let raidLeaderUid = null;
        let subLeaderUid = null;

        for (const [coordKey, slotData] of Object.entries(gridObj.slots_allocation)) {
          if (!slotData) continue;
          const parts = String(coordKey).split('-');
          const partyNum = parseInt(parts[0], 10);
          const slotNum = parseInt(parts[1], 10);
          const isCoord = !Number.isNaN(partyNum) && !Number.isNaN(slotNum);

          if (slotData.userId === snowflakeId && isCoord) {
            viewerCol = partyNum;
            viewerSlotLabel = `P${partyNum}-S${slotNum}`;
            raidConfigName = gridObj.name || gridObj.title || gridId;
          }
          if (slotData.isRaidLeader && slotData.userId) {
            raidLeaderUid = slotData.userId;
          }
        }

        if (!viewerSlotLabel) continue;

        locatedSlot = viewerSlotLabel;

        for (const [coordKey, slotData] of Object.entries(gridObj.slots_allocation)) {
          if (!slotData?.isPartyLeader || !slotData.userId) continue;
          const partyNum = parseInt(String(coordKey).split('-')[0], 10);
          if (partyNum === viewerCol) {
            subLeaderUid = slotData.userId;
            break;
          }
        }

        if (raidLeaderUid) {
          const leaderSnap = await db.ref(`auction/members/${raidLeaderUid}`).once('value');
          if (leaderSnap.exists()) {
            raidLeaderName = leaderSnap.val().displayName || leaderSnap.val().username || raidLeaderUid;
          }
        }
        if (subLeaderUid) {
          const leaderSnap = await db.ref(`auction/members/${subLeaderUid}`).once('value');
          if (leaderSnap.exists()) {
            subLeaderName = leaderSnap.val().displayName || leaderSnap.val().username || subLeaderUid;
          }
        }
        break;
      }
    }

    if (!locatedSlot) {
      return await interaction.editReply({ content: 'ℹ️ Your Snowflake ID is not found allocated inside the active Live Raid Grid Roster slots right now.' });
    }

    const embedFields = [
      { name: 'Grid Tab', value: `\`${raidConfigName || 'Untitled Tab'}\``, inline: true },
      { name: 'Roster Placement Slot', value: `**${locatedSlot}**`, inline: true },
    ];

    if (raidLeaderName) {
      embedFields.push({ name: '👑 Raid Leader', value: `**${raidLeaderName}**`, inline: false });
    }
    if (subLeaderName) {
      embedFields.push({ name: '🔵 Sub Leader', value: `**${subLeaderName}**`, inline: false });
    }

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Active Live Deployment Slot Matrix')
      .setColor('#9333ea')
      .addFields(embedFields)
      .setTimestamp();

    return await interaction.editReply({ content: null, embeds: [embed] });
  }
}

/**
 * 🕹️ INTERACTIVE COMPONENTS ROUTER (Dynamic Event Loops & Dashboard Re-renders)
 */
export async function handleComponentInteraction(interaction) {
  const db = getDatabase(); //[cite: 1]
  const snowflakeId = interaction.user.id; //[cite: 1, 2]

  // ⏱️ ACK-FIRST: defer the component update before any Firebase I/O so slow
  // reads can never expire the interaction token (10062). All branches below
  // edit the (ephemeral) source message via editReply.
  await interaction.deferUpdate();

  // Phase 3: Component Interaction Lockdown Safety Gate
  if (interaction.customId.startsWith('menu_') || interaction.customId.startsWith('matrsvp:')) {
    const globalConfigSnap = await db.ref('settings/configuration').once('value');
    if (globalConfigSnap.exists() && globalConfigSnap.val().isForceLocked === true) {
      return await interaction.editReply({ content: '🔒 Interaction Rejected: System under administrative lockdown freeze.', components: [] }).catch(() => {});
    }
  }

  // A. Chained Job Selection dropdown hooks
  if (interaction.customId === 'menu_job_selection') {
    const selectedJobCode = interaction.values[0];
    await db.ref(`auction/members/${snowflakeId}`).update({ jobCode: selectedJobCode }); //[cite: 1]

    const configSnap = await db.ref('settings/configuration/roles').once('value');
    if (!configSnap.exists()) return await interaction.editReply({ content: `✅ Job spec successfully saved.`, components: [] });

    const roleMenu = new StringSelectMenuBuilder()
      .setCustomId('menu_role_selection_chained')
      .setPlaceholder('Next, confirm your primary combat raid role...')
      .addOptions(Object.entries(configSnap.val()).map(([code, roleObj]) => ({ label: roleObj.name || code, value: code })));

    return await interaction.editReply({
      content: `✅ Job specialized to **${selectedJobCode}**! Let's update your role configuration next:`,
      components: [new ActionRowBuilder().addComponents(roleMenu)]
    });
  }

  // B. Standard / Chained Role configuration hooks
  if (interaction.customId === 'menu_role_selection' || interaction.customId === 'menu_role_selection_chained') {
    const selectedRoleCode = interaction.values[0];
    await db.ref(`auction/members/${snowflakeId}`).update({ roleCode: selectedRoleCode });
    return await interaction.editReply({ content: `🎉 Profile configuration set! Saved combat role: **${selectedRoleCode}**.`, components: [] });
  }

  // C. Upgraded Rapid-Fire Availability Button Grid Handler (Colon delimited parsing)
  if (interaction.customId.startsWith('matrsvp:')) {
    const parts = interaction.customId.split(':');
    const action = parts[1]; // 'confirm' or 'leave'
    const compositeKey = parts[2]; // Extracts the safe unbroken format: dateStr_eventId
    const currentPage = parseInt(parts[3], 10);
    const targetStatus = action === 'confirm' ? 'Confirmed' : 'Leave';

    // Guard Rule: Intercept button event mutations if the targeted instance night was cancelled mid-flight
    const instanceCheck = await db.ref(`scheduler/instances/${compositeKey}`).once('value');
    if (instanceCheck.exists() && instanceCheck.val().isCancelled === true) return;

    const raiderProfileSnap = await db.ref(`auction/members/${snowflakeId}`).once('value');
    const member = raiderProfileSnap.exists() ? raiderProfileSnap.val() : {};
    const displayName = member.displayName || member.name || interaction.user.username;

    const parsed = parseCompositeKey(compositeKey);
    const existingSnap = await db.ref(`attendance/commitments/${compositeKey}/${snowflakeId}`).once('value');
    const current = existingSnap.exists() ? existingSnap.val().status : null;
    const status = current === targetStatus ? 'None' : targetStatus;
    try {
      await applyAttendanceDecision({
        userId: snowflakeId,
        displayName,
        dateStr: parsed?.dateStr,
        eventId: parsed?.eventId,
        status,
        compositeKey,
      });
    } catch (err) {
      return await interaction.editReply({
        content: `❌ ${err.message || 'Could not update attendance.'}`,
        components: [],
      }).catch(() => {});
    }

    // Re-render the matrix instantly to update component visual states
    const updatedPayload = await generateRSVPMatrixDashboard(db, snowflakeId, currentPage);
    return await interaction.editReply(updatedPayload);
  }

  // Dashboard Pagination Controls dropped to maintain clean alignment with the single-week schedule framework
}