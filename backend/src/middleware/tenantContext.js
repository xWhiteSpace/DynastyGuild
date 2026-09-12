import { getCurrentTenantId, runWithTenant, setCachedConfig, setCachedChannels } from '../db/tenantContext.js';
import { loadTenantSettings, mergeChannelFallback } from '../db/tenants.js';
import { resolveUserIdentity } from '../auth/identity.js';

const PUBLIC_PREFIXES = [
  '/auth/login',
  '/auth/callback',
  '/auth/logout',
  '/auth/me',
  '/auth/tenants',
  '/auth/select-tenant',
  '/auth/onboard',
  '/api/debug/',
  '/api/tenants/invite-url',
];

function isPublicPath(path) {
  if (path === '/') return true;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}

export async function attachTenantContext(req, res, next) {
  try {
    const user = resolveUserIdentity(req);
    const headerTenant = req.headers['x-tenant-id'];
    let tenantId =
      req.session?.currentTenantId ||
      user?.currentTenantId ||
      (typeof headerTenant === 'string' ? headerTenant : null);

    if (headerTenant && user?.currentTenantId && String(headerTenant) !== String(user.currentTenantId)) {
      if (!req.session?.currentTenantId || String(headerTenant) !== String(req.session.currentTenantId)) {
        tenantId = req.session?.currentTenantId || user.currentTenantId;
      }
    }

    if (!tenantId) {
      if (isPublicPath(req.path)) return next();
      return next();
    }

    const { configuration, discordChannels } = await loadTenantSettings(tenantId);
    setCachedConfig(tenantId, configuration);
    setCachedChannels(tenantId, mergeChannelFallback(discordChannels));
    req.tenantId = tenantId;
    return runWithTenant(tenantId, () => next());
  } catch (err) {
    console.error('tenant middleware:', err.message);
    return next(err);
  }
}

export function requireTenant(req, res, next) {
  const tenantId = req.tenantId || getCurrentTenantId() || req.session?.currentTenantId;
  if (!tenantId) {
    return res.status(409).json({
      success: false,
      error: 'Select a Discord server first.',
      code: 'tenant_required',
    });
  }
  req.tenantId = tenantId;
  next();
}
