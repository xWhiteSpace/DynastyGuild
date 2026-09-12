// backend/src/auth/discordOAuth.js
import { Router } from 'express';
import { getDatabase } from '../db/database.js';
import { discordClient } from '../discord-bot/client.js';
import { getCurrentTenantId } from '../db/tenantContext.js';
import { resolveUserIdentity, signUserProfile } from './identity.js';
import { attachTenantLogo, buildSessionUser, listVisibleTenants } from '../api/tenant.routes.js';

import { logDiscordHttpFailure, isDiscordCircuitOpen, getDiscordRateLimitStatus, beginOAuthAttempt, endOAuthAttempt, markOAuthLoginClick, hydrateDiscordCircuit, resolveOAuthExchangeUrl, isLocalOAuthRedirect } from '../utils/discordRateLimit.js';

const router = Router();
const discordApi = 'https://discord.com/api';

const memberCacheByGuild = new Map();
const CACHE_DURATION = 2 * 60 * 1000;

let activeFetchPromise = null;

const getFrontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';

function circuitRedirect(targetFrontend) {
  const status = getDiscordRateLimitStatus();
  const until = encodeURIComponent(status.untilHuman || status.remainingHuman || 'later');
  return `${targetFrontend}/landing?error=discord_rate_limited&until=${until}`;
}

/**
 * POST /oauth2/token must not run on Render's Singapore IP — Cloudflare treats
 * that as a global block and each retry extends it. Production sends the code
 * to the Vercel function (user's FRONTEND_URL). Localhost may still talk to
 * Discord directly because that is not a shared datacenter IP.
 */
function mapRoleIdsToNames(guild, roleIds) {
  if (!guild || !Array.isArray(roleIds) || roleIds.length === 0) return [];
  const names = roleIds
    .map((id) => guild.roles.cache.get(String(id))?.name)
    .filter(Boolean);
  const everyone = guild.roles.everyone?.name;
  if (everyone && !names.includes(everyone)) names.unshift(everyone);
  return names;
}

async function fetchGuildMemberWithUserToken(accessToken, guildId) {
  if (!accessToken || !guildId) return null;
  const memberResponse = await fetch(`${discordApi}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!memberResponse.ok) return null;
  const member = await memberResponse.json().catch(() => null);
  if (!member || !Array.isArray(member.roles)) return null;
  return { nick: member.nick || null, roles: member.roles };
}

async function exchangeCodeForDiscordUser(code) {
  const redirectUri = process.env.OAUTH_REDIRECT_URI;
  const exchangeUrl = resolveOAuthExchangeUrl();

  if (exchangeUrl) {
    const secret = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
    const headers = {
      'Content-Type': 'application/json',
      'x-oauth-bridge': secret,
      Authorization: `Bearer ${secret}`,
    };
    const bypass = String(process.env.VERCEL_PROTECTION_BYPASS || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
    if (bypass) {
      headers['x-vercel-protection-bypass'] = bypass;
    }

    const bridgeRes = await fetch(exchangeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        code,
        redirect_uri: redirectUri,
        client_id: process.env.DISCORD_CLIENT_ID,
        guild_id: getCurrentTenantId() || undefined,
      }),
    });
    const payload = await bridgeRes.json().catch(() => ({}));
    if (!bridgeRes.ok) {
      const detail = payload.error || payload.message || `http_${bridgeRes.status}`;
      console.error(`🛑 [OAUTH BRIDGE] ${bridgeRes.status} from ${exchangeUrl}: ${detail}`);
      const err = new Error(detail);
      err.bridgeStatus = bridgeRes.status;
      err.bridgeDetail = detail;
      throw err;
    }
    if (!payload.user?.id) {
      const err = new Error('OAuth bridge returned no Discord user');
      err.bridgeStatus = bridgeRes.status || 502;
      throw err;
    }
    return {
      user: payload.user,
      guildMember: payload.member || null,
      memberStatus: payload.memberStatus ?? null,
      usedBridge: true,
      guilds: Array.isArray(payload.guilds) ? payload.guilds : [],
    };
  }

  if (!isLocalOAuthRedirect()) {
    const err = new Error('oauth_offload_required');
    err.code = 'oauth_offload_required';
    throw err;
  }

  const tokenResponse = await fetch(`${discordApi}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!tokenResponse.ok) {
    const errorPayload = await tokenResponse.json().catch(() => ({}));
    console.error('🛑 [DISCORD OAUTH EXCEPTION DETAILS]:', JSON.stringify({
      httpStatus: tokenResponse.status,
      statusText: tokenResponse.statusText,
      ...errorPayload,
    }, null, 2));
    logDiscordHttpFailure('oauth token exchange', tokenResponse, errorPayload);
    throw new Error(`Token exchange failed: ${errorPayload.error_description || errorPayload.error || errorPayload.message || tokenResponse.statusText}`);
  }

  const tokenData = await tokenResponse.json();
  const userResponse = await fetch(`${discordApi}/users/@me`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userResponse.ok) {
    const userErrBody = await userResponse.json().catch(() => ({}));
    logDiscordHttpFailure('oauth users/@me', userResponse, userErrBody);
    throw new Error('Failed to fetch user profiles');
  }

  const guildsResponse = await fetch(`${discordApi}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const guilds = guildsResponse.ok ? await guildsResponse.json().catch(() => []) : [];

  return {
    user: await userResponse.json(),
    guildMember: await fetchGuildMemberWithUserToken(tokenData.access_token, getCurrentTenantId()),
    memberStatus: 'local-direct',
    usedBridge: false,
    guilds: Array.isArray(guilds) ? guilds : [],
  };
}

// 🛡️ REPAIRED ROSTER ENDPOINT
router.get('/discord-members', async (req, res) => {
  const guildId = getCurrentTenantId();
  if (!guildId) {
    return res.status(409).json({ error: 'Select a Discord server first.' });
  }

  const now = Date.now();
  const cached = memberCacheByGuild.get(guildId);
  if (cached && (now - cached.at < CACHE_DURATION)) {
    return res.json({ success: true, members: cached.members });
  }

  if (activeFetchPromise) {
    try {
      const members = await activeFetchPromise;
      return res.json({ success: true, members });
    } catch (err) {}
  }

  activeFetchPromise = (async () => {
    const guild = discordClient?.guilds?.cache.get(guildId);
    const membersMap = guild?.members?.cache;
    if (membersMap && membersMap.size > 0) {
      return membersMap.map(m => ({
        id: m.user.id,
        username: m.user.username,
        globalName: m.user.globalName || m.user.username,
        nickname: m.nickname || m.displayName || m.user.username,
        avatarURL: m.user.displayAvatarURL({ dynamic: true, size: 128 }),
        joinedAt: m.joinedAt
      })).sort((a, b) => a.nickname.localeCompare(b.nickname));
    }

    // Never REST-fetch 1000 members from the Render IP. Fall back to Postgres roster.
    const fbSnap = await getDatabase().ref('auction/members').once('value');
    const rows = fbSnap.exists() ? fbSnap.val() : {};
    return Object.entries(rows)
      .filter(([, m]) => m?.displayName)
      .map(([id, m]) => ({
        id,
        username: m.displayName,
        globalName: m.displayName,
        nickname: m.displayName,
        avatarURL: null,
        joinedAt: null,
      }))
      .sort((a, b) => a.nickname.localeCompare(b.nickname));
  })();

  try {
    const freshMembers = await activeFetchPromise;
    memberCacheByGuild.set(guildId, { members: freshMembers, at: Date.now() });
    return res.json({ success: true, members: freshMembers });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to extract active member matrix from Discord gateway.' });
  } finally {
    activeFetchPromise = null;
  }
});

function normalizeAuthIntent(raw) {
  return String(raw || '').toLowerCase() === 'signup' ? 'signup' : 'signin';
}

router.get('/login', async (req, res) => {
  const targetFrontend = getFrontendUrl();
  await hydrateDiscordCircuit();
  const gate = markOAuthLoginClick();
  if (!gate.allowed) {
    if (gate.reason === 'oauth-offload-required') {
      return res.redirect(`${targetFrontend}/landing?error=oauth_offload_required`);
    }
    if (gate.reason === 'circuit' || gate.reason === 'oauth-lock') {
      return res.redirect(circuitRedirect(targetFrontend));
    }
    return res.redirect(`${targetFrontend}/landing?error=login_busy`);
  }
  const intent = normalizeAuthIntent(req.query.intent);
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.OAUTH_REDIRECT_URI);
  const scope = encodeURIComponent('identify guilds guilds.members.read');
  res.redirect(`${discordApi}/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${encodeURIComponent(intent)}`);
});

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const intent = normalizeAuthIntent(state);
  const targetFrontend = getFrontendUrl();

  if (!code) {
    return res.redirect(`${targetFrontend}/landing?error=missing_code`);
  }

  await hydrateDiscordCircuit();
  const gate = beginOAuthAttempt();
  if (!gate.allowed) {
    if (gate.reason === 'circuit' || gate.reason === 'oauth-lock') {
      return res.redirect(circuitRedirect(targetFrontend));
    }
    return res.redirect(`${targetFrontend}/landing?error=login_busy`);
  }

  try {
    const { user, guilds: rawGuilds } = await exchangeCodeForDiscordUser(code);
    const discordGuilds = (Array.isArray(rawGuilds) ? rawGuilds : []).map((g) => ({
      id: String(g.id),
      name: g.name,
      icon: g.icon || null,
      owner: Boolean(g.owner),
      permissions: String(g.permissions || '0'),
    }));
    req.session.discordGuilds = discordGuilds;

    const tenantRows = await listVisibleTenants(user.id, discordGuilds);
    const onboarded = tenantRows.filter((t) => t.onboarded);
    const baseUser = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
      displayName: user.global_name || user.username,
      isOfficer: false,
      roles: [],
    };
    req.session.user = baseUser;

    if (onboarded.length === 1 && intent !== 'signup') {
      const sessionUser = await buildSessionUser(req, onboarded[0].id, baseUser);
      const signed = signUserProfile(sessionUser);
      return req.session.save(() => {
        const encodedUser = encodeURIComponent(JSON.stringify(signed));
        const dest = sessionUser.tenantOnboarded ? '/' : '/onboard';
        res.redirect(`${targetFrontend}${dest}?auth_user=${encodedUser}`);
      });
    }

    const signed = signUserProfile(baseUser);
    return req.session.save(() => {
      const encodedUser = encodeURIComponent(JSON.stringify(signed));
      res.redirect(`${targetFrontend}/select-guild?auth_user=${encodedUser}&intent=${intent}`);
    });
  } catch (error) {
    console.error("❌ OAuth callback processing failed:", error);
    if (error?.code === 'oauth_offload_required') {
      return res.redirect(`${targetFrontend}/landing?error=oauth_offload_required`);
    }
    if (error?.bridgeStatus) {
      const detail = encodeURIComponent(error.bridgeDetail || error.message || 'unknown');
      return res.redirect(`${targetFrontend}/landing?error=oauth_bridge_failed&detail=${detail}`);
    }
    if (isDiscordCircuitOpen()) {
      return res.redirect(circuitRedirect(targetFrontend));
    }
    return res.redirect(`${targetFrontend}/landing?error=discord_oauth_failed`);
  } finally {
    endOAuthAttempt();
  }
});

router.get('/me', async (req, res) => {
  let user = resolveUserIdentity(req);

  if (!user) {
    return res.status(200).json({ authenticated: false, user: null });
  }

  if (req.session?.currentTenantId) {
    user = { ...user, currentTenantId: req.session.currentTenantId };
  }

  try {
    user = await attachTenantLogo(req, user);
  } catch {
    // keep the session user if logo lookup fails
  }

  return res.json({ authenticated: true, user });
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ success: false, error: 'Could not destroy running session.' });
    res.clearCookie('connect.sid'); 
    return res.json({ success: true });
  });
});

export default router;