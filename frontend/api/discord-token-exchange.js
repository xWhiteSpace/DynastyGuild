/**
 * Runs on Vercel so POST /oauth2/token does not use Render's Singapore IP.
 *
 * Credentials come from Render's request (Render already has them in .env).
 * This function does not require DISCORD_CLIENT_SECRET on Vercel.
 */
export const config = { runtime: 'nodejs' };

function trimEnv(value) {
  return String(value || '').trim();
}

function headerValue(headers, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  const raw = headers[lower] ?? headers[name];
  if (Array.isArray(raw)) return trimEnv(raw[0]);
  return trimEnv(raw);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-oauth-bridge');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    let body = req.body;
    try {
      if (typeof body === 'string') body = JSON.parse(body || '{}');
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
    body = body || {};

    const authHeader = headerValue(req.headers, 'authorization');
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? trimEnv(authHeader.slice(7))
      : '';
    const secret = headerValue(req.headers, 'x-oauth-bridge') || bearer;
    const clientId = trimEnv(body.client_id);
    const code = trimEnv(body.code);
    const redirectUri = trimEnv(body.redirect_uri);
    const guildId = trimEnv(body.guild_id);

    if (!secret) {
      return res.status(401).json({ error: 'missing_bridge_auth' });
    }
    if (!clientId) {
      return res.status(400).json({ error: 'missing_discord_client_id' });
    }
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'missing_code_or_redirect_uri' });
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: secret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      console.error('[oauth-bridge] token exchange failed', tokenResponse.status, tokenPayload);
      return res.status(tokenResponse.status).json({
        error: tokenPayload.error_description || tokenPayload.error || tokenPayload.message || 'token_exchange_failed',
      });
    }

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const user = await userResponse.json().catch(() => ({}));
    if (!userResponse.ok || !user.id) {
      console.error('[oauth-bridge] users/@me failed', userResponse.status, user);
      return res.status(userResponse.status || 502).json({
        error: user.message || 'user_fetch_failed',
      });
    }

    let member = null;
    let memberStatus = guildId ? 'not_fetched' : 'no_guild_id';
    if (guildId) {
      const memberResponse = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
        headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      });
      memberStatus = memberResponse.status;
      if (memberResponse.ok) {
        const rawMember = await memberResponse.json().catch(() => null);
        if (rawMember && Array.isArray(rawMember.roles)) {
          member = { nick: rawMember.nick || null, roles: rawMember.roles };
        } else {
          memberStatus = `ok_but_no_roles`;
        }
      }
    }

    const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const guilds = guildsResponse.ok ? await guildsResponse.json().catch(() => []) : [];

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
        global_name: user.global_name,
      },
      member,
      memberStatus,
      guilds: Array.isArray(guilds) ? guilds : [],
    });
  } catch (err) {
    console.error('[oauth-bridge] exception', err);
    return res.status(500).json({ error: 'oauth_bridge_exception' });
  }
}
