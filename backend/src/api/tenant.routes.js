import { Router } from 'express';
import multer from 'multer';
import { canManageGuild, resolveUserIdentity, signUserProfile } from '../auth/identity.js';
import { checkOfficer, rolesGrantOfficer } from '../auth/officer.js';
import { claimTenantOwner, createTenant, getTenant, getTenantsByIds, getTenantsForMember, markTenantOnboarded, loadTenantSettings, setTenantLogoUrl } from '../db/tenants.js';
import { DEFAULT_CONFIGURATION } from '../config/defaultConfiguration.js';
import { botInviteUrl, clearGuildCommands } from '../discord-bot/deployGuild.js';
import { discordClient } from '../discord-bot/client.js';
import { runWithTenant } from '../db/tenantContext.js';
import { getDatabase } from '../db/database.js';
import { deleteGuildLogo, LOGO_MAX_BYTES, resolveGuildLogoUrl, uploadGuildLogo } from '../services/guildLogo.js';

const router = Router();

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES, files: 1 },
});

function handleLogoUpload(req, res, next) {
  logoUpload.single('logo')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'Logo must be 512 KB or smaller.' });
    }
    return res.status(400).json({ success: false, error: err.message || 'Upload failed.' });
  });
}

function iconHashForGuild(req, tenantId) {
  const listed = (req.session?.discordGuilds || []).find((g) => String(g.id) === String(tenantId));
  const live = discordClient?.guilds?.cache?.get(String(tenantId));
  return listed?.icon || live?.icon || null;
}

function effectiveLogoUrl(req, tenant, configuration) {
  return resolveGuildLogoUrl({
    logoUrl: tenant?.logo_url || configuration?.guildLogoUrl,
    guildId: tenant?.id,
    iconHash: iconHashForGuild(req, tenant?.id),
  });
}

function mapRoleIdsToNames(guild, roleIds) {
  if (!guild || !Array.isArray(roleIds) || roleIds.length === 0) return [];
  return roleIds.map((id) => guild.roles.cache.get(String(id))?.name).filter(Boolean);
}

async function buildSessionUser(req, tenantId, baseUser) {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error('Unknown tenant');
  const { configuration } = await loadTenantSettings(tenantId);
  const guild = discordClient?.isReady() ? discordClient.guilds.cache.get(String(tenantId)) : null;
  let member = guild?.members?.cache.get(String(baseUser.id)) || null;
  if (guild && !member) {
    member = await guild.members.fetch(String(baseUser.id)).catch(() => null);
  }

  const fallbackRoles = Array.isArray(baseUser.roles) ? baseUser.roles : [];
  const mappedNames = mapRoleIdsToNames(guild, fallbackRoles);
  const liveNames = member
    ? [...member.roles.cache.values()]
      .filter((role) => role && role.name !== '@everyone')
      .map((role) => role.name)
    : mappedNames;
  const liveIds = member
    ? [...member.roles.cache.values()]
      .filter((role) => role && role.name !== '@everyone')
      .map((role) => String(role.id))
    : fallbackRoles.map(String);
  const matchTokens = [...new Set([...liveNames, ...liveIds, ...fallbackRoles.map(String)])];
  const roleNames = liveNames.length ? liveNames : mappedNames;

  let displayName = baseUser.displayName || baseUser.username;
  if (member) {
    displayName = (member.nickname || member.displayName || displayName).replace(/\//g, '_');
  }

  const listed = (req.session?.discordGuilds || []).find((g) => String(g.id) === String(tenantId));
  const isDiscordOwner = String(guild?.ownerId || '') === String(baseUser.id) || Boolean(listed?.owner);
  const canManage = (member ? canManageGuild(member.permissions?.bitfield) : false)
    || (listed ? canManageGuild(listed.permissions) : false);

  let ownerDiscordId = tenant.owner_discord_id || null;
  if (!ownerDiscordId && (isDiscordOwner || canManage)) {
    await claimTenantOwner(tenantId, baseUser.id);
    ownerDiscordId = String(baseUser.id);
  }

  const adminRoles = Array.isArray(configuration.adminRoles) ? configuration.adminRoles : [];
  const isOfficer = String(ownerDiscordId || '') === String(baseUser.id)
    || rolesGrantOfficer(matchTokens, adminRoles);

  const user = {
    id: baseUser.id,
    username: baseUser.username,
    discriminator: baseUser.discriminator,
    avatar: baseUser.avatar,
    displayName,
    isOfficer,
    roles: roleNames,
    currentTenantId: String(tenantId),
    tenantName: tenant.display_name || configuration.guildDisplayName || 'Guild',
    tenantLogoUrl: effectiveLogoUrl(req, tenant, configuration),
    tenantOnboarded: Boolean(tenant.onboarded),
    isPlatformOwner: Boolean(tenant.is_platform_owner),
  };

  await runWithTenant(tenantId, async () => {
    const db = getDatabase();
    await db.ref(`auction/members/${user.id}`).update({
      displayName: user.displayName,
      ...(roleNames.length ? { roles: roleNames } : {}),
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

  const visible = await listVisibleTenants(identity.id, req.session?.discordGuilds || []);
  if (!visible.some((t) => String(t.id) === tenantId)) {
    return res.status(403).json({ success: false, error: 'You are not a member of that Discord server' });
  }

  const user = await buildSessionUser(req, tenantId, identity);
  const signed = signUserProfile(user);
  return req.session.save(() => {
    res.json({ success: true, user: signed, onboarded: Boolean(tenant.onboarded) });
  });
});

router.get('/discord-roles', async (req, res) => {
  const identity = resolveUserIdentity(req);
  if (!identity?.id) return res.status(401).json({ success: false, error: 'Login required' });
  const guildId = String(req.query.guildId || '');
  if (!guildId) return res.status(400).json({ success: false, error: 'guildId required' });
  const guild = discordClient?.guilds?.cache?.get(guildId);
  if (!guild) {
    return res.status(409).json({ success: false, error: 'Invite the bot into this Discord server first', inviteUrl: botInviteUrl(guildId) });
  }
  await guild.roles.fetch().catch(() => {});
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.name !== '@everyone')
    .sort((a, b) => b.position - a.position)
    .map((role) => ({ id: role.id, name: role.name }));
  return res.json({ success: true, roles });
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
    adminRoles = [],
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

  const officerRoleNames = (Array.isArray(adminRoles) ? adminRoles : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  if (officerRoleNames.length === 0) {
    return res.status(400).json({ success: false, error: 'Pick at least one Discord role that should be officers' });
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
    guildDisplayName: guildName || listed?.name || '',
    timezone: timezone || DEFAULT_CONFIGURATION.timezone,
    adminRoles: officerRoleNames,
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
    await clearGuildCommands(guildId);
  } catch (err) {
    console.warn('Slash command clear failed:', err.message);
  }

  const user = await buildSessionUser(req, guildId, identity);
  const signed = signUserProfile(user);
  return req.session.save(() => {
    res.json({ success: true, user: signed });
  });
});

async function requireOfficerTenant(req, res) {
  const identity = resolveUserIdentity(req);
  if (!identity?.id) {
    res.status(401).json({ success: false, error: 'Login required' });
    return null;
  }
  const tenantId = req.tenantId || identity.currentTenantId || req.session?.currentTenantId;
  if (!tenantId) {
    res.status(409).json({ success: false, error: 'Select a Discord server first.', code: 'tenant_required' });
    return null;
  }
  const { ok, tenant } = await checkOfficer(req);
  if (!ok) {
    res.status(403).json({ success: false, error: 'Officer access required to change the guild logo.' });
    return null;
  }
  return { tenantId: String(tenant?.id || tenantId) };
}

router.post('/logo', handleLogoUpload, async (req, res) => {
  try {
    const ctx = await requireOfficerTenant(req, res);
    if (!ctx) return;
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'Choose a png or jpg file.' });
    }
    const result = await uploadGuildLogo(ctx.tenantId, req.file.buffer);
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
    await setTenantLogoUrl(ctx.tenantId, result.url);
    const identity = resolveUserIdentity(req);
    const sessionUser = await buildSessionUser(req, ctx.tenantId, identity);
    const signed = signUserProfile(sessionUser);
    return req.session.save(() => {
      res.json({ success: true, guildLogoUrl: result.url, user: signed });
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/logo', async (req, res) => {
  try {
    const ctx = await requireOfficerTenant(req, res);
    if (!ctx) return;
    const result = await deleteGuildLogo(ctx.tenantId);
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
    await setTenantLogoUrl(ctx.tenantId, '');
    const identity = resolveUserIdentity(req);
    const sessionUser = await buildSessionUser(req, ctx.tenantId, identity);
    const signed = signUserProfile(sessionUser);
    return req.session.save(() => {
      res.json({ success: true, guildLogoUrl: '', user: signed });
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export async function attachTenantLogo(req, user) {
  const tenantId = req.session?.currentTenantId || user?.currentTenantId;
  if (!user || !tenantId) return user;
  const tenant = await getTenant(tenantId);
  if (!tenant) return { ...user, currentTenantId: String(tenantId) };
  const { configuration } = await loadTenantSettings(tenantId);
  return {
    ...user,
    currentTenantId: String(tenantId),
    tenantName: user.tenantName || tenant.display_name || configuration.guildDisplayName || 'Guild',
    tenantLogoUrl: effectiveLogoUrl(req, tenant, configuration),
  };
}

export async function listVisibleTenants(discordUserId, sessionGuilds = []) {
  const ids = new Set((sessionGuilds || []).map((g) => String(g.id)).filter(Boolean));
  const fromRoster = await getTenantsForMember(discordUserId);
  for (const row of fromRoster) ids.add(String(row.id));
  if (discordClient?.isReady()) {
    for (const guild of discordClient.guilds.cache.values()) {
      if (ids.has(guild.id)) continue;
      const cached = guild.members.cache.get(String(discordUserId));
      const member = cached || await guild.members.fetch(String(discordUserId)).catch(() => null);
      if (member) ids.add(guild.id);
    }
  }
  return getTenantsByIds([...ids]);
}

router.get('/mine', async (req, res) => {
  const identity = resolveUserIdentity(req);
  if (!identity?.id) return res.status(401).json({ success: false, error: 'Login required' });
  const discordGuilds = req.session?.discordGuilds || [];
  const tenants = await listVisibleTenants(identity.id, discordGuilds);
  const onboardable = discordGuilds.filter((g) => {
    const already = tenants.some((t) => t.id === g.id && t.onboarded);
    return !already && (g.owner || canManageGuild(g.permissions));
  });
  return res.json({
    success: true,
    tenants: tenants.map((t) => {
      const listed = discordGuilds.find((g) => String(g.id) === String(t.id));
      const live = discordClient?.guilds?.cache?.get(String(t.id));
      return {
        id: t.id,
        displayName: t.display_name,
        onboarded: t.onboarded,
        plan: t.plan,
        isPlatformOwner: t.is_platform_owner,
        logoUrl: t.logo_url || '',
        icon: listed?.icon || live?.icon || null,
      };
    }),
    onboardable,
    currentTenantId: req.session?.currentTenantId || identity.currentTenantId || null,
    inviteUrl: botInviteUrl(),
  });
});

export { buildSessionUser, mapRoleIdsToNames };
export default router;
