/**
 * Weekly Attendance Announcement (Discord)
 *
 * Every Sunday (guild-TZ morning) the bot creates a per-week thread under
 * DISCORD_ATTENDANCE_ID and posts the upcoming Mon-Sun raids with buttons INSIDE
 * the thread. Members respond with one click (Confirm All Week) or manage each
 * event via a private ephemeral panel. All writes go through the SSOT
 * `writeCommitment`; the public message shows live Confirmed/Leave/Pending counts.
 */
import { getDatabase } from '../db/database.js';
import { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ensureWeekInstances, writeCommitment, resolveGuildTimezone } from '../services/scheduleService.js';
import { getWeekMonday, getGuildNowParts, parseCompositeKey } from '../utils/guildTime.js';
import { discordClient } from './client.js';
import { isDiscordCircuitOpen } from '../utils/discordRateLimit.js';
import { discordChannel } from '../db/channels.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EMBED_COLOR = '#9333ea';
const MAX_PANEL_EVENTS = 5; // Discord: max 5 action rows per message

function getPostHour() {
  const parsed = parseInt(process.env.ATTENDANCE_POST_HOUR, 10);
  if (!Number.isInteger(parsed)) return 10;
  return Math.max(0, Math.min(23, parsed));
}

const pad = (n) => String(n).padStart(2, '0');

function markerRef(weekMonday) {
  return getDatabase().ref(`scheduler/attendance_announcements/${weekMonday}`);
}

function weekdayName(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return WEEKDAYS[d.getUTCDay()] || '';
}

/**
 * SSOT-consistent "next week's Monday": advance the current week's Monday by 7
 * days using the app's canonical noon-UTC pattern (never raw ms arithmetic).
 */
function computeNextWeekMonday(timezone) {
  const monday = getWeekMonday(timezone);
  const base = new Date(`${monday}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + 7);
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
}

/**
 * Materialize + load non-cancelled events for a week, sorted chronologically.
 */
async function getWeekEvents(weekMonday) {
  const { instances } = await ensureWeekInstances({ weekMonday });
  return Object.entries(instances || {})
    .map(([key, inst]) => ({ key, ...inst }))
    .filter((ev) => ev.isCancelled !== true)
    .sort(
      (a, b) =>
        (a.date || '').localeCompare(b.date || '') ||
        (a.timeStart || '').localeCompare(b.timeStart || '')
    );
}

/**
 * Roster size + per-event Confirmed/Leave/Pending tallies.
 */
async function computeCounts(db, weekEvents) {
  const membersSnap = await db.ref('auction/members').once('value');
  const members = membersSnap.exists() ? membersSnap.val() : {};
  const rosterCount = Object.values(members).filter(
    (m) => m?.isRaidRoster === true && m?.status !== 'Ghost'
  ).length;

  const counts = {};
  for (const ev of weekEvents) {
    const snap = await db.ref(`attendance/commitments/${ev.key}`).once('value');
    const data = snap.exists() ? snap.val() : {};
    let confirmed = 0;
    let leave = 0;
    Object.values(data).forEach((c) => {
      if (c?.status === 'Confirmed') confirmed++;
      else if (c?.status === 'Leave') leave++;
    });
    counts[ev.key] = {
      confirmed,
      leave,
      pending: Math.max(0, rosterCount - confirmed - leave),
    };
  }
  return { counts, rosterCount };
}

/**
 * Public announcement embed + Confirm All / Manage buttons.
 */
function buildAnnouncement(weekMonday, weekEvents, counts) {
  const embed = new EmbedBuilder()
    .setTitle(`🗓️ Weekly Attendance — Week of ${weekMonday}`)
    .setColor(EMBED_COLOR)
    .setTimestamp();

  if (weekEvents.length === 0) {
    embed.setDescription('No raids are scheduled for the upcoming week. Enjoy the break! 🎉');
    return { embeds: [embed], components: [] };
  }

  embed.setDescription(
    'Set your availability for the upcoming week.\n' +
      '• **Confirm All Week** — one click confirms every raid below.\n' +
      '• **Manage Per-Event** — private panel to Confirm/Leave each raid individually.'
  );

  for (const ev of weekEvents) {
    const c = counts[ev.key] || { confirmed: 0, leave: 0, pending: 0 };
    const title = ev.title || ev.eventId;
    const icon = ev.isSpecial ? '⚔️' : '📅';
    embed.addFields([
      {
        name: `${icon} ${title} — ${weekdayName(ev.date)} ${ev.date}`,
        value: `🕒 \`${ev.timeStart || '--:--'}\`  •  ✅ Confirmed **${c.confirmed}**  •  🚫 Leave **${c.leave}**  •  ⏳ Pending **${c.pending}**`,
        inline: false,
      },
    ]);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`att:confirmall:${weekMonday}`)
      .setLabel('Confirm All Week')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`att:manage:${weekMonday}`)
      .setLabel('Manage Per-Event')
      .setEmoji('🗓️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Private per-event panel (ephemeral) with each member's current status.
 */
async function buildManagePanel(db, snowflakeId, weekMonday) {
  const weekEvents = await getWeekEvents(weekMonday);

  const embed = new EmbedBuilder()
    .setTitle(`🗓️ Manage Attendance — Week of ${weekMonday}`)
    .setColor(EMBED_COLOR)
    .setTimestamp();

  if (weekEvents.length === 0) {
    embed.setDescription('No raids are scheduled for this week.');
    return { embeds: [embed], components: [] };
  }

  embed.setDescription('Toggle your status per raid. Clicking your current status again clears it.');

  const rows = [];
  const shown = weekEvents.slice(0, MAX_PANEL_EVENTS);
  for (const ev of shown) {
    const snap = await db.ref(`attendance/commitments/${ev.key}/${snowflakeId}`).once('value');
    const status = snap.exists() ? snap.val().status : 'Unanswered';
    const title = ev.title || ev.eventId;
    embed.addFields([
      {
        name: `${ev.isSpecial ? '⚔️' : '📅'} ${title} — ${weekdayName(ev.date)} ${ev.date}`,
        value: `Your status: **${status}**`,
        inline: false,
      },
    ]);
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`att:set:${ev.key}:confirm`)
          .setLabel(status === 'Confirmed' ? '✅ Confirmed' : 'Confirm')
          .setStyle(status === 'Confirmed' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`att:set:${ev.key}:leave`)
          .setLabel(status === 'Leave' ? '❌ Leave' : 'Leave')
          .setStyle(status === 'Leave' ? ButtonStyle.Danger : ButtonStyle.Secondary)
      )
    );
  }

  if (weekEvents.length > MAX_PANEL_EVENTS) {
    embed.setFooter({ text: `Showing first ${MAX_PANEL_EVENTS} of ${weekEvents.length} events.` });
  }

  return { embeds: [embed], components: rows };
}

/**
 * Edit the stored thread announcement message (unarchiving the thread if needed).
 */
async function editAnnouncementMessage(marker, payload) {
  if (!marker?.threadId || !marker?.messageId) return false;
  const thread = await discordClient.channels.fetch(marker.threadId).catch(() => null);
  if (!thread) return false;
  if (thread.archived && typeof thread.setArchived === 'function') {
    await thread.setArchived(false).catch(() => {});
  }
  const message = await thread.messages.fetch(marker.messageId).catch(() => null);
  if (!message) return false;
  await message.edit(payload);
  return true;
}

/**
 * Recompute counts and refresh the live announcement message.
 */
export async function refreshAnnouncement(weekMonday) {
  const db = getDatabase();
  const markerSnap = await markerRef(weekMonday).once('value');
  if (!markerSnap.exists()) return;

  const weekEvents = await getWeekEvents(weekMonday);
  const { counts } = await computeCounts(db, weekEvents);
  const payload = buildAnnouncement(weekMonday, weekEvents, counts);
  await editAnnouncementMessage(markerSnap.val(), payload).catch((e) =>
    console.error('[attendance] refresh failed:', e.message)
  );
}

/**
 * Create the per-week thread and post the announcement (idempotent via marker).
 * force=true re-posts: refresh the existing thread message, or recreate if gone.
 */
export async function postWeeklyAttendance({ force = false } = {}) {
  const db = getDatabase();
  const timezone = await resolveGuildTimezone(db);
  const weekMonday = computeNextWeekMonday(timezone);

  const markerSnap = await markerRef(weekMonday).once('value');
  if (markerSnap.exists() && !force) {
    return { skipped: true, reason: 'already-posted', weekMonday };
  }

  const weekEvents = await getWeekEvents(weekMonday);
  const { counts } = await computeCounts(db, weekEvents);
  const payload = buildAnnouncement(weekMonday, weekEvents, counts);

  // Re-post: reuse the existing thread/message instead of duplicating the thread.
  if (markerSnap.exists() && force) {
    const ok = await editAnnouncementMessage(markerSnap.val(), payload).catch(() => false);
    if (ok) return { reposted: true, weekMonday, threadId: markerSnap.val().threadId };
    // otherwise fall through and create a fresh thread
  }

  const parentChannelId = discordChannel('DISCORD_ATTENDANCE_ID');
  const parent = await discordClient.channels.fetch(parentChannelId).catch(() => null);
  if (!parent || typeof parent.threads?.create !== 'function') {
    throw new Error('DISCORD_ATTENDANCE_ID channel not found or does not support threads');
  }

  const thread = await parent.threads.create({
    name: `Week of ${weekMonday}`.slice(0, 100),
    autoArchiveDuration: 10080, // 7-day max, keeps thread active for the RSVP window
    type: ChannelType.PublicThread,
    reason: 'Weekly attendance announcement',
  });

  const message = await thread.send(payload);

  await markerRef(weekMonday).set({
    threadId: thread.id,
    messageId: message.id,
    channelId: parentChannelId,
    weekMonday,
    postedAt: Date.now(),
  });

  console.log(`[attendance] Posted weekly attendance thread for ${weekMonday} (thread=${thread.id})`);
  return { posted: true, weekMonday, threadId: thread.id, messageId: message.id };
}

/**
 * Sunday self-gated auto-post: dayOfWeek===0 AND hour>=postHour AND marker missing.
 * The >= plus marker makes a late Sunday boot self-heal while posting exactly once.
 */
export async function maybeAnnounceWeekly() {
  if (isDiscordCircuitOpen()) return;

  const db = getDatabase();

  const configSnap = await db.ref('settings/configuration').once('value');
  if (configSnap.exists() && configSnap.val().isForceLocked === true) return;

  const timezone = await resolveGuildTimezone(db);
  const now = new Date();
  const parts = getGuildNowParts(timezone, now);
  if (parts.dayOfWeek !== 0) return; // Sunday only

  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
  }).format(now);
  const hour = parseInt(hourStr, 10) % 24;
  if (hour < getPostHour()) return;

  const weekMonday = computeNextWeekMonday(timezone);
  const markerSnap = await markerRef(weekMonday).once('value');
  if (markerSnap.exists()) return;

  console.log(`[attendance] Sunday auto-post trigger for week ${weekMonday} (hour=${hour}, postHour=${getPostHour()})`);
  await postWeeklyAttendance({ force: false });
}

/**
 * Route att:* button interactions (fired inside the weekly thread).
 */
export async function handleAttendanceInteraction(interaction) {
  const db = getDatabase();
  const snowflakeId = interaction.user.id;

  const parts = interaction.customId.split(':');
  const action = parts[1];

  // ⏱️ ACK-FIRST: acknowledge based on the action (parsed from customId — no I/O)
  // BEFORE any Firebase read, so slow/cold reads can never expire the interaction
  // token and surface as "Unknown interaction" (10062). `set` toggles in place
  // (deferUpdate); confirmall/manage return an ephemeral panel (deferReply).
  if (action === 'set') {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ ephemeral: true });
  }

  const configSnap = await db.ref('settings/configuration').once('value');
  if (configSnap.exists() && configSnap.val().isForceLocked === true) {
    return await interaction
      .editReply({ content: '🔒 Interaction Rejected: System under administrative lockdown freeze.' })
      .catch(() => {});
  }

  const memberSnap = await db.ref(`auction/members/${snowflakeId}`).once('value');
  const member = memberSnap.exists() ? memberSnap.val() : {};
  const displayName = member.displayName || member.name || interaction.user.username;

  // att:confirmall:{weekMonday}
  if (action === 'confirmall') {
    const weekMonday = parts.slice(2).join(':');

    const weekEvents = await getWeekEvents(weekMonday);
    if (weekEvents.length === 0) {
      return await interaction.editReply({ content: 'ℹ️ There are no raids scheduled for this week to confirm.' });
    }

    let confirmed = 0;
    for (const ev of weekEvents) {
      const parsed = parseCompositeKey(ev.key);
      await writeCommitment({
        userId: snowflakeId,
        displayName,
        dateStr: parsed?.dateStr,
        eventId: parsed?.eventId,
        status: 'Confirmed',
        compositeKey: ev.key,
      });
      confirmed++;
    }

    await refreshAnnouncement(weekMonday);
    return await interaction.editReply({
      content: `✅ You are confirmed for all **${confirmed}** raid(s) this week (Week of ${weekMonday}).`,
    });
  }

  // att:manage:{weekMonday}
  if (action === 'manage') {
    const weekMonday = parts.slice(2).join(':');
    const payload = await buildManagePanel(db, snowflakeId, weekMonday);
    return await interaction.editReply(payload);
  }

  // att:set:{compositeKey}:{confirm|leave}
  if (action === 'set') {
    const target = parts[parts.length - 1];
    const compositeKey = parts.slice(2, parts.length - 1).join(':');

    const instSnap = await db.ref(`scheduler/instances/${compositeKey}`).once('value');
    if (instSnap.exists() && instSnap.val().isCancelled === true) return;

    const desired = target === 'confirm' ? 'Confirmed' : 'Leave';
    const curSnap = await db.ref(`attendance/commitments/${compositeKey}/${snowflakeId}`).once('value');
    const current = curSnap.exists() ? curSnap.val().status : 'None';
    const newStatus = current === desired ? 'None' : desired; // toggle, mirrors the web

    const parsed = parseCompositeKey(compositeKey);
    await writeCommitment({
      userId: snowflakeId,
      displayName,
      dateStr: parsed?.dateStr,
      eventId: parsed?.eventId,
      status: newStatus,
      compositeKey,
    });

    const timezone = await resolveGuildTimezone(db);
    const weekMonday = getWeekMonday(timezone, parsed?.dateStr);
    await refreshAnnouncement(weekMonday);

    const payload = await buildManagePanel(db, snowflakeId, weekMonday);
    return await interaction.editReply(payload);
  }
}
