import { resolveUserIdentity, canManageGuild } from './identity.js';
import { claimTenantOwner, getTenant, loadTenantSettings } from '../db/tenants.js';
import { getCurrentTenantId } from '../db/tenantContext.js';

function normalizeRoleToken(value) {
  return String(value || '').trim().toLowerCase();
}

function isEveryoneRole(value) {
  return normalizeRoleToken(value) === '@everyone';
}

/** Match Discord role names or snowflake IDs, case-insensitive. */
export function rolesGrantOfficer(userRoles, adminRoles) {
  const allowed = new Set(
    (Array.isArray(adminRoles) ? adminRoles : [])
      .map(normalizeRoleToken)
      .filter((token) => token && !isEveryoneRole(token))
  );
  if (!allowed.size) return false;
  return (Array.isArray(userRoles) ? userRoles : []).some((role) => {
    const token = normalizeRoleToken(role);
    return Boolean(token) && !isEveryoneRole(token) && allowed.has(token);
  });
}

export function roleTokensFromMember(member) {
  if (!member?.roles?.cache) return [];
  const tokens = [];
  for (const role of member.roles.cache.values()) {
    if (!role || isEveryoneRole(role.name)) continue;
    tokens.push(role.name, String(role.id));
  }
  return tokens;
}

export function roleNamesFromMember(member) {
  if (!member?.roles?.cache) return [];
  return [...member.roles.cache.values()]
    .filter((role) => role && !isEveryoneRole(role.name))
    .map((role) => role.name);
}

/**
 * Officer of THIS tenant: the Discord user who onboarded it (`owner_discord_id`),
 * or a Discord role name/id listed in this tenant's Settings adminRoles.
 * Empty adminRoles → only the onboarder. Manage Server is onboard-only.
 */
export function isTenantOfficer(user, { ownerDiscordId, adminRoles, tenantId } = {}) {
  if (!user?.id) return false;
  if (ownerDiscordId && String(ownerDiscordId) === String(user.id)) return true;
  const resolvedTenantId = tenantId || getCurrentTenantId() || user.currentTenantId;
  if (
    user.isOfficer === true
    && resolvedTenantId
    && user.currentTenantId
    && String(user.currentTenantId) === String(resolvedTenantId)
  ) {
    return true;
  }
  return rolesGrantOfficer(user.roles, adminRoles);
}

async function fetchLiveMember(tenantId, userId) {
  try {
    const { discordClient } = await import('../discord-bot/client.js');
    if (!discordClient?.isReady()) return { guild: null, member: null };
    const guild = discordClient.guilds.cache.get(String(tenantId)) || null;
    if (!guild) return { guild: null, member: null };
    const cached = guild.members.cache.get(String(userId));
    if (cached) return { guild, member: cached };
    const member = await guild.members.fetch(String(userId)).catch(() => null);
    return { guild, member };
  } catch {
    return { guild: null, member: null };
  }
}

function sessionGuildFlags(req, tenantId) {
  const listed = (req.session?.discordGuilds || []).find((g) => String(g.id) === String(tenantId));
  if (!listed) return { isGuildOwner: false, canManage: false };
  return {
    isGuildOwner: Boolean(listed.owner),
    canManage: canManageGuild(listed.permissions),
  };
}

export async function checkOfficer(req, config = {}) {
  const user = resolveUserIdentity(req);
  if (!user?.id) return { user: null, ok: false, tenant: null };

  const tenantId = req.tenantId || getCurrentTenantId() || user.currentTenantId;
  const tenant = tenantId ? await getTenant(tenantId) : null;
  const stored = tenantId ? await loadTenantSettings(tenantId) : { configuration: {} };
  const adminRoles = [
    ...(Array.isArray(stored.configuration?.adminRoles) ? stored.configuration.adminRoles : []),
    ...(Array.isArray(config?.adminRoles) ? config.adminRoles : []),
  ];

  const { guild, member } = tenantId
    ? await fetchLiveMember(tenantId, user.id)
    : { guild: null, member: null };
  const liveTokens = roleTokensFromMember(member);
  const liveNames = roleNamesFromMember(member);
  const mergedRoles = [...new Set([...(Array.isArray(user.roles) ? user.roles : []), ...liveTokens])];
  const flags = sessionGuildFlags(req, tenantId);
  const isDiscordOwner = String(guild?.ownerId || '') === String(user.id) || flags.isGuildOwner;
  const canManage = (member ? canManageGuild(member.permissions?.bitfield) : false) || flags.canManage;

  let ownerDiscordId = tenant?.owner_discord_id || null;
  if (tenantId && !ownerDiscordId && (isDiscordOwner || canManage)) {
    await claimTenantOwner(tenantId, user.id);
    ownerDiscordId = String(user.id);
  }

  const userForCheck = { ...user, roles: mergedRoles };
  const ok = isTenantOfficer(userForCheck, {
    ownerDiscordId,
    adminRoles,
    tenantId,
  });

  const nextUser = {
    ...user,
    roles: liveNames.length ? liveNames : user.roles,
    isOfficer: ok,
    currentTenantId: tenantId ? String(tenantId) : user.currentTenantId,
  };
  if (req.session?.user) {
    req.session.user = {
      ...req.session.user,
      ...nextUser,
    };
  }

  return { user: nextUser, ok, tenant };
}

/** True when this request's Discord user is an officer of the current tenant. */
export async function isRequestOfficer(req, config = {}) {
  const { user, ok } = await checkOfficer(req, config);
  return Boolean(user && ok);
}

export function helpSettingsView(config = {}) {
  return {
    helpEmbedUrl: config.helpEmbedUrl || '',
    raidHelpEmbedUrl: config.raidHelpEmbedUrl || '',
    timezone: config.timezone || 'Asia/Manila',
    guildDisplayName: config.guildDisplayName || '',
  };
}

export function publicSettingsView(config = {}) {
  const warRooms = {};
  if (config.warRooms && typeof config.warRooms === 'object') {
    for (const [id, room] of Object.entries(config.warRooms)) {
      warRooms[id] = { name: room?.name || id };
    }
  }
  return {
    helpEmbedUrl: config.helpEmbedUrl || '',
    raidHelpEmbedUrl: config.raidHelpEmbedUrl || '',
    timezone: config.timezone || 'Asia/Manila',
    guildDisplayName: config.guildDisplayName || '',
    events: config.events || {},
    items: Array.isArray(config.items) ? config.items : [],
    jobs: config.jobs || {},
    roles: config.roles || {},
    specialEventCategories: config.specialEventCategories || [],
    defaultLeaveCredits: config.defaultLeaveCredits,
    expectedAttendanceRate: config.expectedAttendanceRate,
    liveRaidMaxConfigs: config.liveRaidMaxConfigs,
    liveRaidMaxWarRooms: config.liveRaidMaxWarRooms,
    warRooms,
    isForceLocked: Boolean(config.isForceLocked),
  };
}

export function configNeedsSetup(config = {}) {
  const events = config.events && typeof config.events === 'object' ? config.events : {};
  const items = Array.isArray(config.items) ? config.items : [];
  return Object.keys(events).length === 0 && items.length === 0;
}
