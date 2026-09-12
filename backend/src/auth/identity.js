import crypto from 'crypto';

export function resolveUserIdentity(req) {
  if (req.session?.user) return req.session.user;
  const mobileHeaderToken = req.headers['x-user-profile'];
  if (mobileHeaderToken) {
    try {
      const decodedPayload = JSON.parse(decodeURIComponent(mobileHeaderToken));
      if (decodedPayload && decodedPayload._sig) {
        const clientSignature = decodedPayload._sig;
        const profileToVerify = { ...decodedPayload };
        delete profileToVerify._sig;

        const tokenSigningSecret = process.env.DISCORD_CLIENT_SECRET || 'backup_fallback_secret_key';
        const expectedSignature = crypto
          .createHmac('sha256', tokenSigningSecret)
          .update(JSON.stringify(profileToVerify))
          .digest('hex');

        if (clientSignature === expectedSignature) {
          return profileToVerify;
        }
        console.error('🛑 [API ROUTE INTERCEPT]: Detected forged header signature tamper attempt!');
      }
    } catch (e) {
      console.error('Failed to parse mobile authorization header token:', e.message);
    }
  }
  return null;
}

export function signUserProfile(user) {
  const tokenSigningSecret = process.env.DISCORD_CLIENT_SECRET || 'backup_fallback_secret_key';
  const computedPayloadHash = crypto
    .createHmac('sha256', tokenSigningSecret)
    .update(JSON.stringify(user))
    .digest('hex');
  return { ...user, _sig: computedPayloadHash };
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
