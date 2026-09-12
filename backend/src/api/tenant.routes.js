import { Router } from 'express';
import { canManageGuild, resolveUserIdentity, signUserProfile } from '../auth/identity.js';
import { createTenant, getTenant, getTenantsByIds, markTenantOnboarded, loadTenantSettings } from '../db/tenants.js';
import { DEFAULT_CONFIGURATION } from '../config/defaultConfiguration.js';
import { botInviteUrl, deployGuildCommands } from '../discord-bot/deployGuild.js';
import { discordClient } from '../discord-bot/client.js';
import { runWithTenant } from '../db/tenantContext.js';
import { getDatabase } from '../db/database.js';

const router = Router();

function mapRoleIdsToNames(guild, roleIds) {
  if (!guild || !Array.isArray(roleIds) || roleIds.length === 0) return [];
  return roleIds.map((id) => guild.roles.cache.get(String(id))?.name).filter(Boolean);
}

async function buildSessionUser(req, tenantId, baseUser) {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error('Unknown tenant');
  const { configuration } = await loadTenantSettings(tenantId);
  const guild = discordClient?.isReady() ? discordClient.guilds.cache.get(String(tenantId)) : null;
  const member = guild?.members?.cache.get(baseUser.id) || null;
  let roles = Array.isArray(baseUser.roles) ? baseUser.roles : [];
  let displayName = baseUser.displayName || baseUser.username;
  if (member) {
    displayName = (member.nickname || member.displayName || displayName).replace(/\//g, '_');
    roles = member.roles.cache.map((role) => role.name);
  }
  const adminRoles = configuration.adminRoles || DEFAULT_CONFIGURATION.adminRoles;
  const isOfficer = tenant.owner_discord_id === baseUser.id
    || roles.some((name) => adminRoles.includes(name));

  const user = {
    id: baseUser.id,
    username: baseUser.username,
    discriminator: baseUser.discriminator,
    avatar: baseUser.avatar,
    displayName,
    isOfficer,
    roles,
    currentTenantId: String(tenantId),
    tenantName: tenant.display_name || configuration.guildDisplayName || 'Guild',
    tenantOnboarded: Boolean(tenant.onboarded),
    isPlatformOwner: Boolean(tenant.is_platform_owner),
  };

  await runWithTenant(tenantId, async () => {
    const db = getDatabase();
    await db.ref(`auction/members/${user.id}`).update({
      displayName: user.displayName,
      ...(roles.length ? { roles } : {}),
      syncedAt: new Date().toLocaleDateString('en-US', { timeZone: configuration.timezone || 'Asia/Manila' }),
    });
  });

  req.session.user = user;
  req.session.currentTenantId = String(tenantId);
  return user;
}

router.get('/invite-url', (req, res) => {
  const guildId = req.query.guildId;
  return res.json({ success: true, url: botInviteUrl(guildId) });
});

router.post('/select', async (req, res) => {
  const identity = resolveUserIdentity(req);
  if (!identity?.id) return res.status(401).json({ success: false, error: 'Login required' });
  const tenantId = String(req.body?.tenantId || '');
  if (!tenantId) return res.status(400).json({ success: false, error: 'tenantId required' });
  const tenant = await getTenant(tenantId);
  if (!tenant) return res.status(404).json({ success: false, error: 'Guild is not on this app yet' });

  const user = await buildSessionUser(req, tenantId, identity);
  const signed = signUserProfile(user);
  return req.session.save(() => {
    res.json({ success: true, user: signed, onboarded: Boolean(tenant.onboarded) });
  });
});

router.post('/onboard', async (req, res) => {
  const identity = resolveUserIdentity(req);
  if (!identity?.id) return res.status(401).json({ success: false, error: 'Login required' });

  const {
    guildId,
    guildName,
    timezone,
    auctionChannelId,
    aucreqChannelId,
    genroomId,
    attendanceId,
    warAnnounceChannelId,
    warRooms = {},
  } = req.body || {};

  if (!guildId) return res.status(400).json({ success: false, error: 'guildId required' });

  const existing = await getTenant(guildId);
  if (existing?.onboarded) {
    return res.status(409).json({ success: false, error: 'This Discord server is already set up' });
  }

  const cachedGuilds = req.session?.discordGuilds || [];
  const listed = cachedGuilds.find((g) => String(g.id) === String(guildId));
  if (listed && !listed.owner && !canManageGuild(listed.permissions) && listed.owner_discord_id !== identity.id) {
    if (!canManageGuild(listed.permissions)) {
      return res.status(403).json({ success: false, error: 'You must have Manage Server on that Discord server' });
    }
  }

  const botInGuild = discordClient?.guilds?.cache?.has(String(guildId));
  if (!botInGuild) {
    return res.status(409).json({
      success: false,
      code: 'bot_not_in_guild',
      error: 'Invite the bot into this Discord server first',
      inviteUrl: botInviteUrl(guildId),
    });
  }

  const discordChannels = {
    guildId: String(guildId),
    auctionChannelId: auctionChannelId || '',
    aucreqChannelId: aucreqChannelId || '',
    genroomId: genroomId || '',
    attendanceId: attendanceId || '',
    warAnnounceChannelId: warAnnounceChannelId || '',
    warRooms: {
      DISCORD_WARROOM_ID_1: warRooms.DISCORD_WARROOM_ID_1 || warRooms.room_001 || '',
      DISCORD_WARROOM_ID_2: warRooms.DISCORD_WARROOM_ID_2 || warRooms.room_002 || '',
      DISCORD_WARROOM_ID_3: warRooms.DISCORD_WARROOM_ID_3 || warRooms.room_003 || '',
      DISCORD_WARROOM_ID_4: warRooms.DISCORD_WARROOM_ID_4 || warRooms.room_004 || '',
      DISCORD_WARROOM_ID_5: warRooms.DISCORD_WARROOM_ID_5 || warRooms.room_005 || '',
    },
  };

  const configuration = {
    ...DEFAULT_CONFIGURATION,
    guildDisplayName: guildName || listed?.name || DEFAULT_CONFIGURATION.guildDisplayName,
    timezone: timezone || DEFAULT_CONFIGURATION.timezone,
  };

  await createTenant({
    id: String(guildId),
    displayName: configuration.guildDisplayName || listed?.name || 'Guild',
    ownerDiscordId: identity.id,
    plan: 'free',
    isPlatformOwner: false,
    onboarded: true,
    configuration,
    discordChannels,
  });

  await markTenantOnboarded(guildId, {
    displayName: configuration.guildDisplayName,
    discordChannels,
    configuration,
  });

  try {
    await deployGuildCommands(guildId);
  } catch (err) {
    console.warn('Slash command deploy failed:', err.message);
  }

  const user = await buildSessionUser(req, guildId, identity);
  const signed = signUserProfile(user);
  return req.session.save(() => {
    res.json({ success: true, user: signed });
  });
});

router.get('/mine', async (req, res) => {
  const identity = resolveUserIdentity(req);
  if (!identity?.id) return res.status(401).json({ success: false, error: 'Login required' });
  const discordGuilds = req.session?.discordGuilds || [];
  const ids = discordGuilds.map((g) => g.id);
  const tenants = await getTenantsByIds(ids);
  const onboardable = discordGuilds.filter((g) => {
    const already = tenants.some((t) => t.id === g.id && t.onboarded);
    return !already && (g.owner || canManageGuild(g.permissions));
  });
  return res.json({
    success: true,
    tenants: tenants.map((t) => ({
      id: t.id,
      displayName: t.display_name,
      onboarded: t.onboarded,
      plan: t.plan,
      isPlatformOwner: t.is_platform_owner,
    })),
    onboardable,
    currentTenantId: req.session?.currentTenantId || identity.currentTenantId || null,
    inviteUrl: botInviteUrl(),
  });
});

export { buildSessionUser, mapRoleIdsToNames };
export default router;
