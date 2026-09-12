import dns from 'node:dns';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { handleAuctionInteraction } from '../services/discordInteractiveAuction.js'; // 🕹️ Route live button boards
import { getTenant, loadTenantSettings, forEachOnboardedTenant, mergeChannelFallback } from '../db/tenants.js';
import { runWithTenant, setCachedConfig, setCachedChannels } from '../db/tenantContext.js';
import { refreshTenantConfigCache } from '../config/timeWindow.js';
import { handleAttendanceCardInteraction } from '../services/discordAttendanceCards.js';
import { syncJobIconEmojis } from '../services/discordJobEmojis.js';
import { handlePartyCardInteraction } from '../services/partyViewer.js';
import { clearGuildCommands } from './deployGuild.js';

import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';
import { logDiscordRateLimit, isDiscordCircuitOpen, hydrateDiscordCircuit, getDiscordRateLimitStatus } from '../utils/discordRateLimit.js';

// Render/Node 18+ often tries IPv6 first; Discord's v6 path can hang with no error.
dns.setDefaultResultOrder('ipv4first');

const discordDispatcher = new Agent({ connect: { timeout: 10_000, family: 4 } });

// 📡 GLOBAL NETWORK TUNNEL — honor HTTPS_PROXY, HTTP_PROXY, or PROXY_URL
const resolvedProxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.PROXY_URL;
const resolvedProxyName = process.env.HTTPS_PROXY
  ? 'HTTPS_PROXY'
  : process.env.HTTP_PROXY
    ? 'HTTP_PROXY'
    : process.env.PROXY_URL
      ? 'PROXY_URL'
      : null;
if (resolvedProxyUrl) {
  console.log(`🔒 [NETWORKING]: Routing global HTTP/HTTPS through ${resolvedProxyName} tunnel.`);
  const proxyAgent = new ProxyAgent({ uri: resolvedProxyUrl });
  setGlobalDispatcher(proxyAgent);
} else {
  console.log('[DISCORD BOT] Prefer IPv4 for Discord REST + gateway (avoids silent IPv6 hangs on Render).');
  setGlobalDispatcher(discordDispatcher);
}

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel, Partials.Message],
  // 🛑 RATE-LIMIT SHIELD: cap automatic REST retries so a single 429 can't
  // silently snowball into repeated requests that deepen a global soft-ban.
  rest: { retries: 1, timeout: 15_000, agent: resolvedProxyUrl ? undefined : discordDispatcher },
});

// 📉 Surface rate-limit hits with a human-readable wait (soft-ban Retry-After).
discordClient.rest.on('rateLimited', (info) => {
  logDiscordRateLimit('REST bucket', info);
});

export function getDiscordBotHealth() {
  return {
    botReady: Boolean(discordClient?.isReady()),
    botUser: discordClient?.user?.tag || null,
    wsStatus: discordClient?.ws?.status ?? null,
  };
}

async function preflightDiscordGateway(token) {
  const started = Date.now();
  try {
    const res = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const snippet = (await res.text().catch(() => '')).slice(0, 240).replace(/\s+/g, ' ');
    console.log(
      `[DISCORD BOT] Gateway REST preflight: HTTP ${res.status} in ${Date.now() - started}ms` +
      (res.ok ? '' : ` body=${snippet}`)
    );
    if (res.status === 401 || res.status === 403) {
      console.error('[DISCORD BOT] Token rejected by Discord REST. Re-copy DISCORD_BOT_TOKEN on Render.');
      return { blocked: false, status: res.status };
    }
    if (res.status === 429) {
      logDiscordRateLimit('gateway preflight', {
        status: 429,
        global: true,
        message: snippet,
        headers: res.headers,
        url: '/api/v10/gateway/bot',
        retryAfterMs: 6 * 60 * 60 * 1000,
      });
      console.error(
        '[DISCORD BOT] Discord is blocking this Render IP. Skipping gateway login. ' +
        'Do not redeploy or restart — each probe extends the ban. HTTP can stay up; buttons will not ACK until this clears.'
      );
      return { blocked: true, status: 429 };
    }
    return { blocked: false, status: res.status };
  } catch (err) {
    console.error(
      `[DISCORD BOT] Gateway REST preflight failed after ${Date.now() - started}ms: ${err.name}: ${err.message}. ` +
      'Discord is not answering HTTPS from this host — a new bot token will not fix that.'
    );
    return { blocked: false, status: 0 };
  }
}

export async function initializeDiscordBot() {
  const token = (process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is required to initialize Discord client');
  }

  await hydrateDiscordCircuit();
  await preflightDiscordGateway(token);

  const bootStatus = getDiscordRateLimitStatus();
  console.log(
    `[DISCORD BOT] Boot diagnostics: tokenLength=${token.length} circuitOpen=${bootStatus.circuitOpen} ` +
    `circuitUntil=${bootStatus.circuitUntilHuman || 'none'} remaining=${bootStatus.circuitRemainingHuman}`
  );
  console.log(
    '[DISCORD BOT] Render "service is live" only means HTTP port 10000 is open — wait for "successfully deployed as" before the bot can ACK buttons.'
  );

  discordClient.on('error', (err) => {
    console.error(`🛑 [DISCORD BOT] client error: ${err.message}`);
  });
  discordClient.on('warn', (msg) => {
    console.warn(`⚠️ [DISCORD BOT] warn: ${msg}`);
  });
  discordClient.on('invalidated', () => {
    console.error('🛑 [DISCORD BOT] session invalidated — token was reset or another login kicked this process.');
  });
  discordClient.on('shardError', (err, shardId) => {
    console.error(`🛑 [DISCORD BOT] shard ${shardId} error: ${err.message}`);
  });
  discordClient.on('shardDisconnect', (event, shardId) => {
    console.error(
      `🛑 [DISCORD BOT] shard ${shardId} disconnected code=${event?.code ?? 'n/a'} reason=${event?.reason || 'none'}`
    );
  });
  discordClient.on('debug', (info) => {
    if (/Provided token/i.test(info)) return;
    if (/\[WS|Heartbeat|Identif|Ready|Session|429|Rate|Invalid|Connect|Destroy|Resume|Gateway/i.test(info)) {
      console.log(`[DISCORD BOT] ${info}`);
    }
  });

  let gatewayReadyBound = false;
  const onGatewayReady = () => {
    if (gatewayReadyBound) return;
    gatewayReadyBound = true;
    console.log(`🚀 Discord bot successfully deployed as: ${discordClient.user?.tag}`);
    syncJobIconEmojis(discordClient).catch((err) => {
      console.warn('[JOB ICONS] Sync skipped:', err.message);
    });
    forEachOnboardedTenant(async (tenant) => {
      try {
        await clearGuildCommands(tenant.id);
        console.log(`[SLASH] Cleared guild commands for ${tenant.id}`);
      } catch (err) {
        console.warn(`[SLASH] Could not clear commands for ${tenant.id}:`, err.message);
      }
    }).catch((err) => console.warn('[SLASH] Command clear skipped:', err.message));

async function withGuildTenant(guildId, fn) {
  if (!guildId) return fn();
  const tenant = await getTenant(guildId).catch(() => null);
  if (tenant) {
    const settings = await loadTenantSettings(guildId);
    setCachedConfig(guildId, settings.configuration);
    setCachedChannels(guildId, mergeChannelFallback(settings.discordChannels));
  }
  return runWithTenant(guildId, fn);
}

   // Card interactions (auction, attendance, party) plus a notice if an old slash command is invoked
    discordClient.on('interactionCreate', async (interaction) => {
      await withGuildTenant(interaction.guildId, async () => {
      try {
        // Attendance card lives in the war-announce channel — route by customId
        // prefix so it bypasses the general-room gate.
        if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId?.startsWith('attcard:')) {
          // ACK within Discord's 3s window before any Firebase / panel work.
          if (interaction.customId === 'attcard:open') {
            await interaction.deferReply({ ephemeral: true });
          } else {
            await interaction.deferUpdate();
          }
          return await handleAttendanceCardInteraction(interaction);
        }

        if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId?.startsWith('partycard:')) {
          if (interaction.customId === 'partycard:open') {
            await interaction.deferReply({ ephemeral: true });
          }
          return await handlePartyCardInteraction(interaction);
        }

        // ⚔️ Live Auction panel lives in its own auction-request channel — route by
        // customId so it bypasses the general-room gate (self-service loot claiming).
        if (
          (interaction.isButton() || interaction.isStringSelectMenu()) &&
          (
            interaction.customId === 'open_auction_panel' ||
            interaction.customId === 'open_auction_panel_back' ||
            interaction.customId === 'auction_select_item_type' ||
            interaction.customId?.startsWith('claim_slot_btn_')
          )
        ) {
          return await handleAuctionInteraction(interaction);
        }

        if (interaction.isChatInputCommand()) {
          return await interaction.reply({
            content: 'Slash commands were removed. Use the auction, attendance, or party cards in your mapped Discord channels.',
            ephemeral: true,
          }).catch(() => {});
        }
      } catch (err) {
        console.error("❌ [GATEWAY INTERACTION ROUTE ERROR]: Failed to resolve command event:", err.message);

        // Discord 10062 = Unknown interaction (token already expired), 40060 =
        // interaction already acknowledged. In both cases the token is dead, so
        // a fallback reply is another doomed REST call that only burns rate-limit
        // quota — skip it. Only attempt a fallback for still-valid, un-acked ones.
        const deadInteractionCodes = [10062, 40060];
        if (deadInteractionCodes.includes(err?.code)) return;

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ 
            content: '❌ An internal processing failure occurred while verifying your tracking command.', 
            ephemeral: true 
          }).catch(() => {});
        }
      }
      });
    });

    // 📢 Automated Modular Announcement Scheduler Ticker (Evaluated every 60 seconds)
    // First tick skips Discord announcers so identify + first announce do not stack.
    // Discord-facing jobs also skip while the 429 circuit is open.
    let skipFirstDiscordTick = true;
    setInterval(() => {
      const circuitOpen = isDiscordCircuitOpen();
      forEachOnboardedTenant(async () => {
        await refreshTenantConfigCache().catch(() => {});
        if (skipFirstDiscordTick) {
          return;
        }
        if (!circuitOpen) {
          const { maybeAnnounceEvents } = await import('./eventAnnounce.js');
          await maybeAnnounceEvents();
        }
        const attendanceDecision = await import('../services/attendanceDecision.js');
        await attendanceDecision.closeExpiredDeadlines();
        await attendanceDecision.maybeRefreshMonthlyLeaveCredits();
        const liveRaid = await import('../api/liveRaid.routes.js');
        await liveRaid.maybeAutoEndLiveRaid();
        const { maybeAutoCommitAuction } = await import('./autoCommitAuction.js');
        await maybeAutoCommitAuction();
      }).catch((err) => console.error('⚠️ Tenant scheduler warning:', err.message));

      if (skipFirstDiscordTick) {
        skipFirstDiscordTick = false;
        console.log('⏭️ [SCHEDULER]: Skipping Discord announcers on the first tick after ready.');
      } else if (circuitOpen) {
        console.log('⏭️ [SCHEDULER]: Discord circuit open — skipping announcers.');
      }
    }, 60000);
  };

  discordClient.once('ready', onGatewayReady);
  discordClient.once('clientReady', onGatewayReady);

  let connectInFlight = false;
  let retryTimer = null;

  const scheduleRetry = (waitMs, reason) => {
    const delay = Math.min(Math.max(Number(waitMs) || 15 * 60 * 1000, 60_000), 6 * 60 * 60 * 1000);
    if (retryTimer) clearTimeout(retryTimer);
    console.warn(`⏭️ [DISCORD BOT]: ${reason} Next gateway attempt in ${Math.round(delay / 1000)}s.`);
    retryTimer = setTimeout(() => {
      attemptLogin().catch((err) => console.error('[DISCORD BOT] retry failed:', err.message));
    }, delay);
  };

  const attemptLogin = async () => {
    if (discordClient.isReady()) return;
    if (connectInFlight) return;

    const status = getDiscordRateLimitStatus();
    if (status.circuitOpen) {
      scheduleRetry(status.circuitRemainingMs + 5000, `Circuit open until ${status.circuitUntilHuman}.`);
      return;
    }

    const preflight = await preflightDiscordGateway(token);
    if (preflight.blocked) {
      const again = getDiscordRateLimitStatus();
      scheduleRetry((again.circuitRemainingMs || 6 * 60 * 60 * 1000) + 5000, 'Discord IP block (HTTP 429).');
      return;
    }
    if (preflight.status === 0) {
      scheduleRetry(15 * 60 * 1000, 'Gateway REST preflight timed out.');
      return;
    }

    connectInFlight = true;
    const readyWatch = setTimeout(() => {
      if (discordClient.isReady()) return;
      const wsStatus = discordClient.ws?.status;
      console.error(
        '🛑 [DISCORD BOT]: Gateway still not ready after 25s. ' +
        `isReady=false wsStatus=${wsStatus ?? 'n/a'} user=${discordClient.user?.tag || 'none'}. ` +
        'HTTP can be live while the bot is offline. Token and privileged intents are OK if boot diagnostics showed tokenLength~72. ' +
        'This hang is Discord TCP/WebSocket from this host (often Render IP blocked).'
      );
    }, 25000);

    try {
      console.log('⚡ [DISCORD BOT]: Initiating secure gateway handshake stream...');
      await discordClient.login(token);
      console.log(
        `[DISCORD BOT] login() settled. isReady=${discordClient.isReady()} user=${discordClient.user?.tag || 'none'}`
      );
      if (!discordClient.isReady()) {
        scheduleRetry(15 * 60 * 1000, 'login() settled but client is not ready.');
      }
    } catch (loginErr) {
      console.error('🛑 [DISCORD BOT GATEWAY EXCEPTION]:');
      console.error(`   Error Message: ${loginErr.message}`);
      console.error(`   Error Code: ${loginErr.code || 'N/A'}`);
      if (/429|rate limit|too many requests|being blocked/i.test(loginErr.message || '') || loginErr.code === 429) {
        logDiscordRateLimit('gateway login', loginErr);
      }
      scheduleRetry(15 * 60 * 1000, `login() failed: ${loginErr.message}`);
    } finally {
      clearTimeout(readyWatch);
      connectInFlight = false;
    }
  };

  await attemptLogin();
}