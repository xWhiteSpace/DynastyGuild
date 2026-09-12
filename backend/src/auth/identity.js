import crypto from 'crypto';

function signingSecret() {
  return process.env.DISCORD_CLIENT_SECRET || 'backup_fallback_secret_key';
}

function hmacHex(payload) {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return JSON.stringify(sorted);
}

function parseProfileHeader(raw) {
  if (!raw) return null;
  const text = String(raw);
  try {
    return JSON.parse(decodeURIComponent(text));
  } catch {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

function profileMatchesSignature(profile, signature) {
  const { _sig, ...rest } = profile;
  const candidates = [JSON.stringify(rest), stableStringify(rest)];
  if (rest.displayName !== undefined) {
    const unsigned = { ...rest };
    candidates.push(JSON.stringify(unsigned));
  }
  return candidates.some((payload) => hmacHex(payload) === signature);
}

export function resolveUserIdentity(req) {
  if (req.session?.user) return req.session.user;
  const decodedPayload = parseProfileHeader(req.headers['x-user-profile']);
  if (!decodedPayload?._sig) return null;

  if (!profileMatchesSignature(decodedPayload, decodedPayload._sig)) {
    console.error('🛑 [API ROUTE INTERCEPT]: x-user-profile signature did not match DISCORD_CLIENT_SECRET.');
    return null;
  }

  const profile = { ...decodedPayload };
  delete profile._sig;
  return profile;
}

export function signUserProfile(user) {
  const { _sig, ...rest } = user || {};
  return { ...rest, _sig: hmacHex(stableStringify(rest)) };
}

export function canManageGuild(permissions) {
  try {
    const bits = BigInt(permissions || 0);
    const ADMINISTRATOR = 8n;
    const MANAGE_GUILD = 32n;
    return (bits & ADMINISTRATOR) === ADMINISTRATOR || (bits & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}
