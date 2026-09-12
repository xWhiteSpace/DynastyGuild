import { resolveUserIdentity } from './identity.js';
import { getTenant } from '../db/tenants.js';
import { getCurrentTenantId } from '../db/tenantContext.js';

/**
 * Officer of THIS tenant: the Discord user who onboarded it, or a role name
 * listed in that tenant's Settings adminRoles. No ASCENDANTS name fallbacks.
 */
export function isTenantOfficer(user, { ownerDiscordId, adminRoles } = {}) {
  if (!user?.id) return false;
  if (ownerDiscordId && String(ownerDiscordId) === String(user.id)) return true;
  const allowed = Array.isArray(adminRoles) ? adminRoles : [];
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return roles.some((name) => allowed.includes(name));
}

export async function checkOfficer(req, config = {}) {
  const user = resolveUserIdentity(req);
  if (!user?.id) return { user: null, ok: false };
  const tenantId = req.tenantId || getCurrentTenantId();
  const tenant = tenantId ? await getTenant(tenantId) : null;
  const adminRoles = Array.isArray(config?.adminRoles) ? config.adminRoles : [];
  const ok = isTenantOfficer(user, {
    ownerDiscordId: tenant?.owner_discord_id,
    adminRoles,
  });
  return { user, ok, tenant };
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
