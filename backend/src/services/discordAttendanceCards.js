/**
 * Per-event GVG Readiness Check Discord card (auction-card pattern).
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import admin from 'firebase-admin';
import {
  applyAttendanceDecision,
  AttendanceDecisionError,
  resolveAttendanceTargetEvent,
  getDefaultLeaveCredits,
} from './attendanceDecision.js';
import { enqueueDiscordCall, isDiscordCircuitOpen } from '../utils/discordRateLimit.js';
import { jobIconEmoji, withJobIcon } from './discordJobEmojis.js';

const EMBED_COLOR = '#9333ea';
const ANNOUNCE_COOLDOWN_MS = 60 * 1000;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DISCORD_SELECT_LIMIT = 25;
const CONFIRMED_CLASS_FIELD_LIMIT = 1024;
const PANEL_TITLE = 'GVG Readiness Check';

const userEventLocks = new Map();
const lastAnnounceAt = new Map();

function withUserEventLock(key, fn) {
  const prev = userEventLocks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  userEventLocks.set(key, next);
  return next.finally(() => {
    if (userEventLocks.get(key) === next) userEventLocks.delete(key);
  });
}

function consumeAnnounceCooldown(key) {
  const now = Date.now();
  const last = lastAnnounceAt.get(key) || 0;
  if (now - last < ANNOUNCE_COOLDOWN_MS) return false;
  lastAnnounceAt.set(key, now);
  return true;
}

function formatEventWhen(dateStr, timeStart) {
  if (!dateStr) return '—';
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const mon = MONTHS_SHORT[(month || 1) - 1] || '—';
  const dd = Number.isFinite(day) ? String(day).padStart(2, '0') : '—';
  const time = timeStart || '20:55';
  return Number.isFinite(year) ? `${mon} ${dd}, ${year}  ${time}` : `${dateStr}  ${time}`;
}

const AVAILABILITY_COPY =
  'Please confirm your availability for our upcoming GVG.\n' +
  'This will help our officers to build balanced parties. Your Response is greatly appreciated.';

function buildRsvpAnnounceLine({ displayName, action, eventTitle, whenLabel }) {
  const name = displayName || 'A raider';
  const event = eventTitle || 'the raid';
  const when = whenLabel || '—';
  const warId = (process.env.DISCORD_WARANNOUNCE_CHANNEL_ID || '').trim();
  const cta = warId ? ` Confirm yours at <#${warId}>.` : '';
  if (action === 'Leave') {
    return `🕊️ **${name}** will **Leave** on **${event}** this coming **${when}.** Rest well — the guild has you covered.${cta}`;
  }
  return `⚔️ **${name}** will **Confirm** on **${event}** this coming **${when}.** Locked in — see you there.${cta}`;
}

async function announceAttendanceToGenRoom({ displayName, action, eventTitle, whenLabel }) {
  const genRoomId = (process.env.DISCORD_GENROOM_ID_1 || '').trim();
  if (!genRoomId) return;
  if (isDiscordCircuitOpen()) return;

  const { discordClient } = await import('../discord-bot/client.js');
  if (!discordClient?.isReady()) return;

  const content = buildRsvpAnnounceLine({ displayName, action, eventTitle, whenLabel });
  await enqueueDiscordCall(async () => {
    if (isDiscordCircuitOpen() || !discordClient.isReady()) return;
    let channel = discordClient.channels.cache.get(genRoomId);
    if (!channel) {
      channel = await discordClient.channels.fetch(genRoomId);
    }
    if (!channel) return;
    await channel.send({ content });
  });
}

function formatDeadline(deadlineMs, timezone) {
  if (!Number.isFinite(deadlineMs)) return '—';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(deadlineMs))
      .map((p) => [p.type, p.value])
  );
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function attendanceEmptyDescription(missing) {
  return missing
    ? "The Set Active composition's scheduled event is missing or cancelled."
    : 'No upcoming GVG has an open RSVP window right now.';
}

function catalogName(catalog, code) {
  if (!code) return '—';
  return catalog?.[code]?.name || code;
}

function catalogSelectOptions(catalog) {
  return Object.entries(catalog || {})
    .slice(0, DISCORD_SELECT_LIMIT)
    .map(([code, obj]) => {
      const opt = {
        label: String(obj?.name || code).slice(0, 100) || code,
        value: String(code).slice(0, 100),
      };
      const emoji = jobIconEmoji(obj?.iconFile);
      if (emoji) opt.emoji = { id: emoji.id };
      return opt;
    })
    .filter((opt) => opt.value);
}

function tallyConfirmedClasses(commitments, members, jobsCatalog) {
  const counts = new Map();
  Object.entries(commitments || {}).forEach(([uid, rec]) => {
    if (rec?.status !== 'Confirmed' && rec?.status !== 'Confirm') return;
    const jobCode = members?.[uid]?.jobCode || '';
    const key = jobCode || '__unassigned__';
    const prev = counts.get(key) || { jobCode, count: 0 };
    prev.count += 1;
    counts.set(key, prev);
  });
  const rows = [...counts.values()].map((row) => {
    const job = row.jobCode ? jobsCatalog?.[row.jobCode] : null;
    const name = row.jobCode ? (job?.name || row.jobCode) : 'Unassigned';
    return {
      name,
      count: row.count,
      text: withJobIcon(job?.iconFile, `${name} - ${row.count}`),
    };
  }).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  if (!rows.length) return 'None yet';
  let value = '';
  for (const row of rows) {
    const next = value ? `${value}\n${row.text}` : row.text;
    if (next.length > CONFIRMED_CLASS_FIELD_LIMIT) break;
    value = next;
  }
  return value || 'None yet';
}

function lockedReply() {
  return {
    content: '🔒 Interaction Rejected: System under administrative lockdown freeze.',
    embeds: [],
    components: [],
  };
}

function buildBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('attcard:back')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildJobChangeView(jobsCatalog) {
  const options = catalogSelectOptions(jobsCatalog);
  if (!options.length) {
    return {
      content: '❌ Jobs database catalog missing.',
      embeds: [],
      components: [buildBackRow()],
    };
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId('attcard:job:select')
    .setPlaceholder('Select your active character class spec...')
    .addOptions(options);
  return {
    content: 'Select your new Job Class:',
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(menu),
      buildBackRow(),
    ],
  };
}

function buildRoleChangeView(rolesCatalog) {
  const options = catalogSelectOptions(rolesCatalog);
  if (!options.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('attcard:role:select')
    .setPlaceholder('Next, confirm your primary combat raid role...')
    .addOptions(options);
  return {
    content: 'Job saved. Next, select your combat role:',
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(menu),
      buildBackRow(),
    ],
  };
}

export async function sendPublicAttendanceCard(channel) {
  const embed = new EmbedBuilder()
    .setTitle(PANEL_TITLE)
    .setColor(EMBED_COLOR)
    .setDescription(AVAILABILITY_COPY);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('attcard:open')
      .setLabel('Open Attendance')
      .setStyle(ButtonStyle.Primary)
  );

  await enqueueDiscordCall(() => channel.send({ embeds: [embed], components: [row] }));
  return { posted: true };
}

/**
 * Settings Send: post the public launcher into DISCORD_WARANNOUNCE_CHANNEL_ID.
 */
export async function deployPublicAttendanceCardToWarAnnounce() {
  const channelId = process.env.DISCORD_WARANNOUNCE_CHANNEL_ID;
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
  return await sendPublicAttendanceCard(targetChannel);
}

async function buildPersonalPanel(snowflakeId) {
  const db = admin.database();
  const { event, timezone, deadlineMs, missing } = await resolveAttendanceTargetEvent();
  const [memberSnap, configSnap] = await Promise.all([
    db.ref(`auction/members/${snowflakeId}`).once('value'),
    db.ref('settings/configuration').once('value'),
  ]);
  const member = memberSnap.exists() ? memberSnap.val() : {};
  const config = configSnap.exists() ? configSnap.val() : {};
  const jobsCatalog = config.jobs || {};
  const rolesCatalog = config.roles || {};
  const defaultCredits = getDefaultLeaveCredits(config);
  const credits = Number.isInteger(member.leaveCreditsRemaining)
    ? member.leaveCreditsRemaining
    : defaultCredits;

  const embed = new EmbedBuilder().setTitle(PANEL_TITLE).setColor(EMBED_COLOR).setTimestamp();

  if (!event) {
    embed.setDescription(attendanceEmptyDescription(missing));
    return { content: null, embeds: [embed], components: [] };
  }

  const [commitSnap, allCommitSnap, membersSnap] = await Promise.all([
    db.ref(`attendance/commitments/${event.key}/${snowflakeId}`).once('value'),
    db.ref(`attendance/commitments/${event.key}`).once('value'),
    db.ref('auction/members').once('value'),
  ]);
  const status = commitSnap.exists() ? commitSnap.val().status : 'Unanswered';
  const pastDeadline = Number.isFinite(deadlineMs) && Date.now() > deadlineMs;
  const leaveDisabled = pastDeadline || (credits <= 0 && status !== 'Leave');
  const confirmDisabled = pastDeadline;
  const jobName = catalogName(jobsCatalog, member.jobCode);
  const roleName = catalogName(rolesCatalog, member.roleCode);
  const classSummary = tallyConfirmedClasses(
    allCommitSnap.exists() ? allCommitSnap.val() : {},
    membersSnap.exists() ? membersSnap.val() : {},
    jobsCatalog
  );

  embed.setDescription(
    `${AVAILABILITY_COPY}\n\n` +
      `Response Deadline: **${formatDeadline(deadlineMs, timezone)}**\n` +
      `Your Current Role: ${withJobIcon(jobsCatalog[member.jobCode]?.iconFile, `**${jobName}** ${roleName}`)}`
  );
  embed.addFields({ name: 'Confirmed Class', value: classSummary });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`attcard:set:${event.key}:confirm`)
      .setLabel('Available')
      .setStyle(status === 'Confirmed' ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(confirmDisabled),
    new ButtonBuilder()
      .setCustomId(`attcard:set:${event.key}:leave`)
      .setLabel('Unavailable')
      .setStyle(status === 'Leave' ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(leaveDisabled),
    new ButtonBuilder()
      .setCustomId('attcard:jobchange')
      .setLabel('Change class')
      .setStyle(ButtonStyle.Secondary)
  );

  if (credits <= 0 && status !== 'Leave') {
    embed.setFooter({ text: 'No leave credits remaining — Available, or you will receive a No Confirm after the deadline.' });
  }

  return { content: null, embeds: [embed], components: [row] };
}

async function replyIfLocked(db, interaction) {
  const configSnap = await db.ref('settings/configuration').once('value');
  if (configSnap.exists() && configSnap.val().isForceLocked === true) {
    await interaction.editReply(lockedReply());
    return true;
  }
  return false;
}

export async function handleAttendanceCardInteraction(interaction) {
  const snowflakeId = interaction.user.id;
  const customId = interaction.customId || '';
  const db = admin.database();

  if (customId === 'attcard:open') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    if (await replyIfLocked(db, interaction)) return;
    const payload = await buildPersonalPanel(snowflakeId);
    return await interaction.editReply(payload);
  }

  if (customId === 'attcard:back') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    if (await replyIfLocked(db, interaction)) return;
    const payload = await buildPersonalPanel(snowflakeId);
    return await interaction.editReply(payload);
  }

  if (customId === 'attcard:jobchange') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    if (await replyIfLocked(db, interaction)) return;
    const jobsSnap = await db.ref('settings/configuration/jobs').once('value');
    return await interaction.editReply(buildJobChangeView(jobsSnap.exists() ? jobsSnap.val() : {}));
  }

  if (customId === 'attcard:job:select') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    if (await replyIfLocked(db, interaction)) return;
    const selectedJobCode = interaction.values?.[0];
    if (!selectedJobCode) {
      const payload = await buildPersonalPanel(snowflakeId);
      return await interaction.editReply(payload);
    }
    await db.ref(`auction/members/${snowflakeId}`).update({ jobCode: selectedJobCode });
    const rolesSnap = await db.ref('settings/configuration/roles').once('value');
    const roleView = buildRoleChangeView(rolesSnap.exists() ? rolesSnap.val() : {});
    if (roleView) return await interaction.editReply(roleView);
    const payload = await buildPersonalPanel(snowflakeId);
    return await interaction.editReply(payload);
  }

  if (customId === 'attcard:role:select') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    if (await replyIfLocked(db, interaction)) return;
    const selectedRoleCode = interaction.values?.[0];
    if (selectedRoleCode) {
      await db.ref(`auction/members/${snowflakeId}`).update({ roleCode: selectedRoleCode });
    }
    const payload = await buildPersonalPanel(snowflakeId);
    return await interaction.editReply(payload);
  }

  if (customId.startsWith('attcard:set:')) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    const parts = customId.split(':');
    const compositeKey = parts.slice(2, -1).join(':');
    const action = parts[parts.length - 1];
    const lockKey = `${snowflakeId}:${compositeKey}`;

    return await withUserEventLock(lockKey, async () => {
      if (await replyIfLocked(db, interaction)) return;

      const memberSnap = await db.ref(`auction/members/${snowflakeId}`).once('value');
      const member = memberSnap.exists() ? memberSnap.val() : {};
      const displayName = member.displayName || member.name || interaction.user.username;
      const nextStatus = action === 'leave' ? 'Leave' : 'Confirmed';

      const existingSnap = await db.ref(`attendance/commitments/${compositeKey}/${snowflakeId}`).once('value');
      const current = existingSnap.exists() ? existingSnap.val().status : null;
      if (current === nextStatus) {
        const payload = await buildPersonalPanel(snowflakeId);
        return await interaction.editReply(payload);
      }

      try {
        await applyAttendanceDecision({
          userId: snowflakeId,
          displayName,
          compositeKey,
          status: nextStatus,
        });
      } catch (err) {
        const msg = err instanceof AttendanceDecisionError ? err.message : err.message;
        return await interaction.followUp({ content: `❌ ${msg}`, ephemeral: true }).catch(() => {});
      }

      const payload = await buildPersonalPanel(snowflakeId);
      await interaction.editReply(payload);

      if (nextStatus === 'Confirmed' || nextStatus === 'Leave') {
        if (consumeAnnounceCooldown(lockKey)) {
          (async () => {
            const instSnap = await db.ref(`scheduler/instances/${compositeKey}`).once('value');
            const inst = instSnap.exists() ? instSnap.val() : {};
            await announceAttendanceToGenRoom({
              displayName,
              action: nextStatus,
              eventTitle: inst.title || inst.eventId || compositeKey,
              whenLabel: formatEventWhen(inst.date, inst.timeStart),
            });
          })().catch((err) => {
            console.error('⚠️ Attendance gen-room announce skipped:', err.message);
          });
        }
      }
    });
  }
}
