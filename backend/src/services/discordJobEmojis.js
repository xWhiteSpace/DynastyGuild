/**
 * Guild custom emojis for job-class icons (Discord cannot inline website SVGs).
 * Uploads PNG copies of Settings iconFile artwork once, then embeds <:name:id>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits } from 'discord.js';
import { enqueueDiscordCall } from '../utils/discordRateLimit.js';
import { getCurrentTenantId } from '../db/tenantContext.js';

const ICONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets/job-icons');
const EMOJI_PREFIX = 'dgjob_';

/** @type {Map<string, { id: string, name: string }>} */
const emojiByStem = new Map();

function iconStem(iconFile) {
  return String(iconFile || '')
    .replace(/\.(svg|png)$/i, '')
    .trim()
    .toLowerCase();
}

export function jobIconEmoji(iconFile) {
  const stem = iconStem(iconFile);
  if (!stem) return null;
  return emojiByStem.get(stem) || null;
}

export function jobIconMarkup(iconFile) {
  const emoji = jobIconEmoji(iconFile);
  if (!emoji) return '';
  return `<:${emoji.name}:${emoji.id}>`;
}

export function withJobIcon(iconFile, text) {
  const mark = jobIconMarkup(iconFile);
  return mark ? `${mark} ${text}` : text;
}

function canManageEmojis(member) {
  if (!member?.permissions) return false;
  const flags = PermissionFlagsBits;
  if (flags.ManageGuildExpressions && member.permissions.has(flags.ManageGuildExpressions)) return true;
  if (flags.ManageEmojisAndStickers && member.permissions.has(flags.ManageEmojisAndStickers)) return true;
  return false;
}

export async function syncJobIconEmojis(client) {
  if (!client?.isReady()) return { synced: 0 };
  const guilds = [...client.guilds.cache.values()];
  if (!guilds.length && process.env.DISCORD_GUILD_ID) {
    const fetched = await enqueueDiscordCall(() => client.guilds.fetch(process.env.DISCORD_GUILD_ID)).catch(() => null);
    if (fetched) guilds.push(fetched);
  }
  let synced = 0;
  for (const guild of guilds) {
    synced += await syncJobIconsForGuild(guild);
  }
  return { synced };
}

async function syncJobIconsForGuild(guild) {

  await enqueueDiscordCall(() => guild.emojis.fetch()).catch(() => {});
  const existingByName = new Map();
  guild.emojis.cache.forEach((emoji) => existingByName.set(emoji.name, emoji));

  let files = [];
  try {
    files = fs.readdirSync(ICONS_DIR).filter((name) => name.toLowerCase().endsWith('.png'));
  } catch {
    console.warn('[JOB ICONS] Icon directory missing:', ICONS_DIR);
    return 0;
  }

  const me = guild.members.me || await enqueueDiscordCall(() => guild.members.fetchMe()).catch(() => null);
  const canCreate = canManageEmojis(me);
  if (!canCreate) {
    console.warn('[JOB ICONS] Missing Manage Emojis permission — using any existing dgjob_* emojis only.');
  }

  let synced = 0;
  for (const file of files) {
    const stem = iconStem(file);
    const name = `${EMOJI_PREFIX}${stem}`.slice(0, 32);
    let emoji = existingByName.get(name);
    if (!emoji && canCreate) {
      try {
        const attachment = fs.readFileSync(path.join(ICONS_DIR, file));
        emoji = await enqueueDiscordCall(() =>
          guild.emojis.create({
            attachment,
            name,
            reason: 'DynastyGuild job icon for GVG Readiness Check',
          })
        );
        existingByName.set(name, emoji);
        console.log(`[JOB ICONS] Created :${name}:`);
      } catch (err) {
        console.warn(`[JOB ICONS] Failed to create :${name}:`, err.message);
      }
    }
    if (emoji) {
      emojiByStem.set(stem, { id: emoji.id, name: emoji.name });
      synced += 1;
    }
  }

  return synced;
}
