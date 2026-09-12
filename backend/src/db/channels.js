import { getCachedChannels, getCurrentTenantId } from './tenantContext.js';
import { envFallbackChannels, mergeChannelFallback } from './tenants.js';

const ENV_TO_FIELD = {
  DISCORD_GUILD_ID: 'guildId',
  DISCORD_AUCTION_CHANNEL_ID: 'auctionChannelId',
  DISCORD_AUCREQ_CHANNEL_ID: 'aucreqChannelId',
  DISCORD_GENROOM_ID_1: 'genroomId',
  DISCORD_ATTENDANCE_ID: 'attendanceId',
  DISCORD_WARANNOUNCE_CHANNEL_ID: 'warAnnounceChannelId',
};

/**
 * Resolve a Discord channel/guild id for the current tenant.
 * Prefers tenant_settings.discord_channels; falls back to process.env for the platform guild.
 */
export function discordChannel(envKey) {
  const channels = mergeChannelFallback(getCachedChannels(getCurrentTenantId()) || {});
  if (ENV_TO_FIELD[envKey]) {
    return channels[ENV_TO_FIELD[envKey]] || process.env[envKey] || '';
  }
  if (envKey?.startsWith('DISCORD_WARROOM_ID_')) {
    return channels.warRooms?.[envKey] || process.env[envKey] || '';
  }
  return process.env[envKey] || '';
}

export function currentDiscordChannels() {
  const cached = getCachedChannels(getCurrentTenantId());
  if (cached && Object.keys(cached).length) return mergeChannelFallback(cached);
  return envFallbackChannels();
}
