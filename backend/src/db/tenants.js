import { query } from './pool.js';
import { getCurrentTenantId, runWithTenant, setCachedConfig, setCachedChannels } from './tenantContext.js';
import { DEFAULT_CONFIGURATION } from '../config/defaultConfiguration.js';

export async function listTenants() {
  const { rows } = await query(
    'SELECT id, display_name, owner_discord_id, plan, is_platform_owner, onboarded, created_at FROM tenants ORDER BY created_at ASC'
  );
  return rows;
}

export async function listOnboardedTenants() {
  const { rows } = await query(
    'SELECT id, display_name, owner_discord_id, plan, is_platform_owner, onboarded FROM tenants WHERE onboarded = TRUE'
  );
  return rows;
}

export async function getTenant(id) {
  if (!id) return null;
  const { rows } = await query(
    'SELECT id, display_name, owner_discord_id, plan, is_platform_owner, onboarded, created_at FROM tenants WHERE id = $1',
    [String(id)]
  );
  return rows[0] || null;
}

export async function getTenantsByIds(ids) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return [];
  const { rows } = await query(
    'SELECT id, display_name, owner_discord_id, plan, is_platform_owner, onboarded FROM tenants WHERE id = ANY($1::text[])',
    [list]
  );
  return rows;
}

export async function createTenant({
  id,
  displayName = '',
  ownerDiscordId = null,
  plan = 'free',
  isPlatformOwner = false,
  onboarded = false,
  configuration = DEFAULT_CONFIGURATION,
  discordChannels = {},
}) {
  const tenantId = String(id);
  await query(
    `INSERT INTO tenants (id, display_name, owner_discord_id, plan, is_platform_owner, onboarded)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       owner_discord_id = COALESCE(EXCLUDED.owner_discord_id, tenants.owner_discord_id),
       onboarded = tenants.onboarded OR EXCLUDED.onboarded`,
    [tenantId, displayName, ownerDiscordId, plan, isPlatformOwner, onboarded]
  );
  await query(
    `INSERT INTO tenant_settings (tenant_id, configuration, discord_channels)
     VALUES ($1, $2::jsonb, $3::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE SET
       configuration = COALESCE(tenant_settings.configuration, EXCLUDED.configuration),
       discord_channels = CASE
         WHEN tenant_settings.discord_channels = '{}'::jsonb THEN EXCLUDED.discord_channels
         ELSE tenant_settings.discord_channels
       END,
       updated_at = NOW()`,
    [tenantId, JSON.stringify(configuration || DEFAULT_CONFIGURATION), JSON.stringify(discordChannels || {})]
  );
  setCachedConfig(tenantId, configuration || DEFAULT_CONFIGURATION);
  setCachedChannels(tenantId, discordChannels || {});
  return getTenant(tenantId);
}

export async function markTenantOnboarded(id, { displayName, discordChannels, configuration } = {}) {
  const tenantId = String(id);
  if (displayName) {
    await query('UPDATE tenants SET display_name = $2, onboarded = TRUE WHERE id = $1', [tenantId, displayName]);
  } else {
    await query('UPDATE tenants SET onboarded = TRUE WHERE id = $1', [tenantId]);
  }
  const sets = [];
  const params = [tenantId];
  if (discordChannels) {
    params.push(JSON.stringify(discordChannels));
    sets.push(`discord_channels = $${params.length}::jsonb`);
  }
  if (configuration) {
    params.push(JSON.stringify(configuration));
    sets.push(`configuration = $${params.length}::jsonb`);
  }
  if (sets.length) {
    sets.push('updated_at = NOW()');
    await query(
      `INSERT INTO tenant_settings (tenant_id, configuration, discord_channels)
       VALUES ($1, '{}'::jsonb, '{}'::jsonb)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId]
    );
    await query(`UPDATE tenant_settings SET ${sets.join(', ')} WHERE tenant_id = $1`, params);
  }
  if (configuration) setCachedConfig(tenantId, configuration);
  if (discordChannels) setCachedChannels(tenantId, discordChannels);
}

export async function loadTenantSettings(tenantId) {
  if (!tenantId) return { configuration: { ...DEFAULT_CONFIGURATION }, discordChannels: {} };
  const { rows } = await query(
    'SELECT configuration, discord_channels FROM tenant_settings WHERE tenant_id = $1',
    [String(tenantId)]
  );
  const configuration = rows[0]?.configuration
    ? { ...DEFAULT_CONFIGURATION, ...rows[0].configuration }
    : { ...DEFAULT_CONFIGURATION };
  const discordChannels = rows[0]?.discord_channels || {};
  setCachedConfig(tenantId, configuration);
  setCachedChannels(tenantId, discordChannels);
  return { configuration, discordChannels };
}

export function envFallbackChannels() {
  return {
    guildId: process.env.DISCORD_GUILD_ID || '',
    auctionChannelId: process.env.DISCORD_AUCTION_CHANNEL_ID || '',
    aucreqChannelId: process.env.DISCORD_AUCREQ_CHANNEL_ID || '',
    genroomId: process.env.DISCORD_GENROOM_ID_1 || '',
    attendanceId: process.env.DISCORD_ATTENDANCE_ID || '',
    warAnnounceChannelId: process.env.DISCORD_WARANNOUNCE_CHANNEL_ID || '',
    warRooms: {
      DISCORD_WARROOM_ID_1: process.env.DISCORD_WARROOM_ID_1 || '',
      DISCORD_WARROOM_ID_2: process.env.DISCORD_WARROOM_ID_2 || '',
      DISCORD_WARROOM_ID_3: process.env.DISCORD_WARROOM_ID_3 || '',
      DISCORD_WARROOM_ID_4: process.env.DISCORD_WARROOM_ID_4 || '',
      DISCORD_WARROOM_ID_5: process.env.DISCORD_WARROOM_ID_5 || '',
    },
  };
}

export async function forEachOnboardedTenant(fn) {
  const tenants = await listOnboardedTenants();
  for (const tenant of tenants) {
    try {
      const { configuration, discordChannels } = await loadTenantSettings(tenant.id);
      setCachedConfig(tenant.id, configuration);
      setCachedChannels(tenant.id, mergeChannelFallback(discordChannels));
      await runWithTenant(tenant.id, () => fn(tenant));
    } catch (err) {
      console.error(`⚠️ Tenant job failed for ${tenant.id}:`, err.message);
    }
  }
}

export function mergeChannelFallback(fromDb) {
  const fallback = envFallbackChannels();
  const warRooms = { ...fallback.warRooms, ...(fromDb?.warRooms || {}) };
  return {
    guildId: fromDb?.guildId || fallback.guildId,
    auctionChannelId: fromDb?.auctionChannelId || fallback.auctionChannelId,
    aucreqChannelId: fromDb?.aucreqChannelId || fallback.aucreqChannelId,
    genroomId: fromDb?.genroomId || fallback.genroomId,
    attendanceId: fromDb?.attendanceId || fallback.attendanceId,
    warAnnounceChannelId: fromDb?.warAnnounceChannelId || fallback.warAnnounceChannelId,
    warRooms,
  };
}
