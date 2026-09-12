/**
 * Resolves Settings war room identifiers to Discord voice channel snowflakes.
 * SSOT: settings/configuration/warRooms (relational ID + envKey) → Render process.env
 */

import { currentDiscordChannels, discordChannel } from '../db/channels.js';

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export function resolveWarRoomChannelId(identifier, warRooms = {}) {
  if (!identifier) return null;
  const token = String(identifier).trim();

  if (DISCORD_SNOWFLAKE_PATTERN.test(token)) {
    return token;
  }

  const catalogEntry = warRooms[token];
  if (catalogEntry?.channelId && DISCORD_SNOWFLAKE_PATTERN.test(String(catalogEntry.channelId))) {
    return String(catalogEntry.channelId);
  }

  const tenantChannels = currentDiscordChannels();
  if (catalogEntry?.envKey && tenantChannels.warRooms?.[catalogEntry.envKey]) {
    return tenantChannels.warRooms[catalogEntry.envKey];
  }
  if (tenantChannels.warRooms?.[token]) {
    return tenantChannels.warRooms[token];
  }

  if (catalogEntry?.envKey) {
    const mapped = discordChannel(catalogEntry.envKey);
    if (mapped) return mapped;
  }

  const direct = discordChannel(token);
  if (direct) return direct;

  for (const room of Object.values(warRooms)) {
    if (room?.envKey === token) {
      const fromTenant = discordChannel(room.envKey);
      if (fromTenant) return fromTenant;
    }
  }

  return null;
}

export function resolveWarRoomChannelIds(identifiers = [], warRooms = {}) {
  const resolved = [];
  const seen = new Set();

  for (const identifier of identifiers) {
    const channelId = resolveWarRoomChannelId(identifier, warRooms);
    if (channelId && !seen.has(channelId)) {
      seen.add(channelId);
      resolved.push(channelId);
    }
  }

  return resolved;
}

export function inferWarRoomRelationalIds(identifiers = [], warRooms = {}) {
  const relationalIds = [];
  const seen = new Set();

  for (const identifier of identifiers) {
    if (warRooms[identifier] && !seen.has(identifier)) {
      seen.add(identifier);
      relationalIds.push(identifier);
      continue;
    }

    for (const [roomId, room] of Object.entries(warRooms)) {
      if (room?.envKey === identifier && !seen.has(roomId)) {
        seen.add(roomId);
        relationalIds.push(roomId);
      }
    }
  }

  return relationalIds;
}

export async function fetchVoiceChannelPresentUids(discordClient, channelIds = []) {
  const presentUserIds = [];
  const seen = new Set();

  if (!discordClient?.isReady() || channelIds.length === 0) {
    return presentUserIds;
  }

  const { isDiscordCircuitOpen, enqueueDiscordCall } = await import('./discordRateLimit.js');

  for (const channelId of channelIds) {
    if (isDiscordCircuitOpen()) break;
    let channel = discordClient.channels.cache.get(channelId);
    if (!channel) {
      try {
        channel = await enqueueDiscordCall(() => discordClient.channels.fetch(channelId));
      } catch (err) {
        if (err?.name === 'DiscordCircuitOpenError') break;
        channel = null;
      }
    }
    if (!channel?.isVoiceBased()) continue;

    channel.members.forEach((member) => {
      const uid = member.user?.id;
      if (uid && !member.user.bot && !seen.has(uid)) {
        seen.add(uid);
        presentUserIds.push(uid);
      }
    });
  }

  return presentUserIds;
}
