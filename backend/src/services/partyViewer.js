/**
 * Party Viewer: resolve a member's P#-S# column from the Set Active published composition,
 * plus the public Discord launcher / personal ephemeral panel.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getDatabase } from '../db/database.js';
import { isSlotCoordKey } from '@guildname/shared/compositionTabs';
import { enqueueDiscordCall } from '../utils/discordRateLimit.js';
import { resolveAnchoredComposition } from './publishedComposition.js';
import { discordChannel } from '../db/channels.js';

const EMBED_COLOR = '#9333ea';

function parseCoord(coordKey) {
  if (!isSlotCoordKey(coordKey)) return null;
  const [col, row] = coordKey.split('-').map((n) => parseInt(n, 10));
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  return { col, row, label: `P${col}-S${row}` };
}

function catalogName(catalog, code) {
  if (!code) return '—';
  return catalog?.[code]?.name || code;
}

function memberLabel(members, uid) {
  const m = members[uid] || {};
  return m.displayName || m.name || uid;
}

/**
 * Find the viewer on the Set Active published composition grid and build their column party.
 */
export async function resolveViewerParty(snowflakeId) {
  const db = getDatabase();
  const uid = String(snowflakeId);
  const session = await resolveAnchoredComposition(db);
  if (!session) {
    return { ok: false, reason: 'no_compose' };
  }
  const activeKey = session.id;
  const grids = session.grids || {};

  let found = null;
  for (const [gridId, gridObj] of Object.entries(grids)) {
    const alloc = gridObj?.slots_allocation || {};
    for (const [coordKey, slot] of Object.entries(alloc)) {
      if (!slot?.userId || String(slot.userId) !== uid) continue;
      const parsed = parseCoord(coordKey);
      if (!parsed) continue;
      found = {
        gridId,
        tabName: gridObj.name || gridObj.title || gridId,
        coordKey,
        col: parsed.col,
        row: parsed.row,
        slotLabel: parsed.label,
        alloc,
      };
      break;
    }
    if (found) break;
  }

  if (!found) {
    return {
      ok: false,
      reason: 'not_assigned',
      eventTitle: session.eventTitle || session.eventKey || 'Raid',
      eventDate: session.eventDate || '',
    };
  }

  const columnSlots = [];
  Object.entries(found.alloc).forEach(([coordKey, slot]) => {
    const parsed = parseCoord(coordKey);
    if (!parsed || parsed.col !== found.col || !slot?.userId) return;
    columnSlots.push({
      userId: String(slot.userId),
      coordKey,
      row: parsed.row,
      slotLabel: parsed.label,
      isPartyLeader: slot.isPartyLeader === true,
      isRaidLeader: slot.isRaidLeader === true,
    });
  });
  columnSlots.sort((a, b) => a.row - b.row);

  const subLeaderSlot = columnSlots.find((s) => s.isPartyLeader) || null;

  let raidLeaderSlot = null;
  Object.entries(found.alloc).forEach(([coordKey, slot]) => {
    if (!slot?.isRaidLeader || !slot?.userId) return;
    const parsed = parseCoord(coordKey);
    if (!parsed) return;
    raidLeaderSlot = {
      userId: String(slot.userId),
      coordKey,
      slotLabel: parsed.label,
    };
  });

  const rest = columnSlots.filter((s) => !subLeaderSlot || s.userId !== subLeaderSlot.userId);
  const ordered = subLeaderSlot ? [subLeaderSlot, ...rest] : columnSlots;

  const [membersSnap, configSnap, instanceSnap] = await Promise.all([
    db.ref('auction/members').once('value'),
    db.ref('settings/configuration').once('value'),
    db.ref(`scheduler/instances/${activeKey}`).once('value'),
  ]);
  const members = membersSnap.exists() ? membersSnap.val() : {};
  const config = configSnap.exists() ? configSnap.val() : {};
  const jobs = config.jobs || {};
  const roles = config.roles || {};

  let timeStart = instanceSnap.exists() ? instanceSnap.val().timeStart : '';
  if (!timeStart) {
    timeStart = config.events?.[session.eventKey]?.phases?.[3]?.timeStart || '';
  }

  const partyName = found.alloc[`party_name_${found.col}`] || `P${found.col}`;

  const list = ordered.map((slot) => {
    const profile = members[slot.userId] || {};
    return {
      userId: slot.userId,
      displayName: memberLabel(members, slot.userId),
      slotLabel: slot.slotLabel,
      isPartyLeader: slot.isPartyLeader,
      isRaidLeader: slot.isRaidLeader,
      jobName: catalogName(jobs, profile.jobCode),
      roleName: catalogName(roles, profile.roleCode),
    };
  });

  return {
    ok: true,
    eventTitle: session.eventTitle || session.eventKey || 'Raid',
    eventDate: session.eventDate || '',
    timeStart: timeStart || '—',
    tabName: found.tabName,
    partyName,
    viewerSlot: found.slotLabel,
    viewerCol: found.col,
    leader: subLeaderSlot
      ? {
          userId: subLeaderSlot.userId,
          displayName: memberLabel(members, subLeaderSlot.userId),
          slotLabel: subLeaderSlot.slotLabel,
        }
      : null,
    raidLeader: raidLeaderSlot
      ? {
          userId: raidLeaderSlot.userId,
          displayName: memberLabel(members, raidLeaderSlot.userId),
          slotLabel: raidLeaderSlot.slotLabel,
        }
      : null,
    members: list,
  };
}

// Discord embed code blocks wrap around ~45–48 monospace chars (ephemeral is
// narrower than a normal channel message). Budget:
//   idx 3 + name 15 + gap + class 15 + gap + role 10  = 45
const IDX_W = 3;
const NAME_W = 15;
const JOB_W = 15;
const ROLE_W = 10;

function visualLen(s) {
  return [...String(s ?? '')].length;
}

function clip(s, width) {
  const chars = [...String(s ?? '')];
  if (chars.length <= width) return chars.join('');
  return chars.slice(0, width).join('');
}

function padEndWidth(s, width) {
  const t = clip(s, width);
  const extra = width - visualLen(t);
  return extra > 0 ? t + ' '.repeat(extra) : t;
}

// Discord ```ansi```: 1=bold, 36=cyan (readable on the dark code-block bg).
const ANSI_VIEWER = '\u001b[1;36m';
const ANSI_RESET = '\u001b[0m';

function formatMemberRow(member, index, isViewer) {
  const line =
    `${padEndWidth(`${index}.`, IDX_W)}` +
    `${padEndWidth(member.displayName, NAME_W)} ` +
    `${padEndWidth(member.jobName, JOB_W)} ` +
    `${clip(member.roleName, ROLE_W)}`;
  return isViewer ? `${ANSI_VIEWER}${line}${ANSI_RESET}` : line;
}

function buildPartyEmbed(party, viewerId) {
  const embed = new EmbedBuilder().setTitle('Party').setColor(EMBED_COLOR).setTimestamp();

  if (party.reason === 'no_compose') {
    embed.setDescription('No composition is set active yet.');
    return embed;
  }
  if (party.reason === 'not_assigned') {
    embed.setDescription('You are not assigned to a party on the active composition.');
    return embed;
  }

  const raidLeaderLine = party.raidLeader
    ? `${party.raidLeader.displayName} (${party.raidLeader.slotLabel})`
    : '—';
  const subLeaderLine = party.leader
    ? `${party.leader.displayName} (${party.leader.slotLabel})`
    : '—';

  const header =
    `${padEndWidth('#', IDX_W)}` +
    `${padEndWidth('Name', NAME_W)} ` +
    `${padEndWidth('Class', JOB_W)} ` +
    `Role`;
  const rows = party.members.map((m, i) => {
    const isViewer = String(m.userId) === String(viewerId);
    return formatMemberRow(m, i + 1, isViewer);
  });

  embed.setDescription(
    `**Event:** ${party.eventTitle}\n` +
      `**Date:** ${party.eventDate || '—'}\n` +
      `**Time:** ${party.timeStart}\n` +
      `**Tab:** ${party.tabName}\n` +
      `**Your slot:** \`${party.viewerSlot}\`\n` +
      `**Party:** ${party.partyName}\n\n` +
      `**Raid Leader:** ${raidLeaderLine}\n` +
      `**Sub Leader:** ${subLeaderLine}\n\n` +
      `\`\`\`ansi\n${header}\n${rows.join('\n')}\n\`\`\``
  );

  return embed;
}

export async function sendPublicPartyCard(channel) {
  const embed = new EmbedBuilder()
    .setTitle('Party')
    .setColor(EMBED_COLOR)
    .setDescription('See which party you were assigned to on the active composition.\n\nClick below to open your personal party panel.')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('partycard:open')
      .setLabel('Open My Party')
      .setStyle(ButtonStyle.Primary)
  );

  await enqueueDiscordCall(() => channel.send({ embeds: [embed], components: [row] }));
  return { posted: true };
}

export async function deployPublicPartyCardToWarAnnounce() {
  const channelId = discordChannel('DISCORD_WARANNOUNCE_CHANNEL_ID');
  if (!channelId) {
    throw new Error('DISCORD_WARANNOUNCE_CHANNEL_ID is not configured.');
  }

  const { discordClient } = await import('../discord-bot/client.js');
  const { isDiscordCircuitOpen, getDiscordRateLimitStatus } = await import('../utils/discordRateLimit.js');

  if (!discordClient || !discordClient.isReady()) {
    throw new Error(
      'Discord bot gateway is not connected on this backend. ' +
      'Website Sign-in can still work because OAuth is offloaded to Vercel — that does not mean the bot is online. ' +
      'Check Render for "successfully deployed as" or GET /api/debug/discord-ratelimit (botReady).'
    );
  }
  if (isDiscordCircuitOpen()) {
    const status = getDiscordRateLimitStatus();
    const when = status.circuitUntilHuman || status.untilHuman || status.circuitRemainingHuman || status.remainingHuman;
    throw new Error(`Discord is temporarily blocking this server IP. Try again after ${when}.`);
  }

  const targetChannel = await enqueueDiscordCall(() => discordClient.channels.fetch(channelId));
  if (!targetChannel) {
    throw new Error('Discord gateway client failed to locate the war-announce channel.');
  }
  return await sendPublicPartyCard(targetChannel);
}

export async function handlePartyCardInteraction(interaction) {
  if (interaction.customId !== 'partycard:open') return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const db = getDatabase();
  const configSnap = await db.ref('settings/configuration').once('value');
  if (configSnap.exists() && configSnap.val().isForceLocked === true) {
    return await interaction.editReply({ content: '🔒 Interaction Rejected: System under administrative lockdown freeze.' });
  }

  const party = await resolveViewerParty(interaction.user.id);
  const embed = buildPartyEmbed(party, interaction.user.id);
  return await interaction.editReply({ embeds: [embed], components: [] });
}
