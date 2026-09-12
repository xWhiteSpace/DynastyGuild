// backend/src/services/discordSnapshot.js
import { getDatabase } from '../db/database.js';
import { discordClient } from '../discord-bot/client.js';
import { getGateStatusDetails } from '../config/timeWindow.js';
import { isDiscordCircuitOpen, enqueueDiscordCall, logDiscordRateLimit, noteDiscordBurst } from '../utils/discordRateLimit.js';
import { discordChannel } from '../db/channels.js';

/**
 * 📣 REQ024 & REQ025: Live Automated Snapshots Controller
 * Reconciles the connection link with index.js. Builds the leaderboard
 * data matrix and posts it directly to your Discord guild channel.
 */
export async function processAndPostDiscordSnapshot(isFinalThreshold = false, existingChannel = null) {
  if (isDiscordCircuitOpen()) {
    console.warn('⏭️ [SNAPSHOT]: Discord circuit open — skipping broadcast.');
    return;
  }

  // Pause Sign-in before the first Discord REST call so /oauth2/token cannot
  // ride the same Render IP immediately after (or during) this burst.
  noteDiscordBurst();

  try {
    // Access database instance securely from the firebase-admin module scope
    const db = getDatabase();
    
    // Fetch dynamic item templates and live web requests to compile the matrix dynamically
    const configSnap = await db.ref('settings/configuration').once('value');
    const dynamicConfig = configSnap.exists() ? configSnap.val() : {};
    const itemsList = dynamicConfig.items || [];

    const requestsSnap = await db.ref('auction/web_requests').once('value');
    const membersSnap = await db.ref('auction/members').once('value');
    const membersData = membersSnap.exists() ? membersSnap.val() : {};

    console.log(`📊 [SNAPSHOT ENGINE]: Compiling active scoreboard layouts for target event.`);
    const firebaseRequests = requestsSnap.exists() ? Object.values(requestsSnap.val()) : [];
    const userCalculationsMap = {};
    itemsList.forEach(item => { userCalculationsMap[item.id] = {}; });

    const { compileLeaderboard } = await import('../utils/sortingEngine.js');
    const globalStandings = compileLeaderboard(firebaseRequests, itemsList, membersData);

    // Establish the text template header layout
    const gateDetails = getGateStatusDetails() || {};
    const activeEventObj = dynamicConfig.events?.[gateDetails.activeEventId];
    const resolvedEventTitle = gateDetails.activeEventTitle || "Raid Session";
    const targetTimezone = dynamicConfig.timezone || "Asia/Manila";

    const timestampString = new Date().toLocaleString("en-US", { 
      timeZone: targetTimezone,
      dateStyle: "short",
      timeStyle: "short"
    });

    const embedsPayload = [];

    // 🎨 CHROMATIC CONSOLE SYNC: Converts hex strings or theme keywords into Discord decimal integers
    const resolveColorThemeToInteger = (colorTheme) => {
      if (colorTheme && colorTheme.startsWith('#')) {
        return parseInt(colorTheme.replace('#', ''), 16);
      }
      const PRESET_MAP = {
        purple: 0x8b5cf6,
        yellow: 0xeab308,
        slate: 0x64748b,
        red: 0xef4444,
        orange: 0xf97316,
        emerald: 0x10b981,
        blue: 0x3b82f6
      };
      return PRESET_MAP[colorTheme] || 0x64748b;
    };

    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    // ✨ RE-VALUED TYPOGRAPHY: Stripped out debug symbols to form clean, high-contrast dashboard notification status headers
    let broadcastHeadlineText = isFinalThreshold
      ? `🔒 **LOCKED • ${resolvedEventTitle.toUpperCase()} FINALIZED ALLOCATION SHEET**\n`
      : `📊 **CURRENT LIST • ${resolvedEventTitle.toUpperCase()} ONGOING BID REGISTER**\n`;
    
    // 🕒 TIMELINE STREAMLINING: Dropped the custom relative timestamp row to clean up the card header space
    broadcastHeadlineText += `🕒 **Time:** \`${timestampString}\` (${targetTimezone})`;
    // Process aggregated data into separate stylized embed blocks
    itemsList.forEach(item => {
      // 🔇 NOISE SUPPRESSION: Completely skip item cards that are not declared in tonight's auction drop pool
      if (activeEventObj?.loots?.[item.id] === undefined) return;

      const embedColorInteger = resolveColorThemeToInteger(item.colorTheme);
      let contentSummaryString = '';
      const targetUserIds = globalStandings.rankingsByItem[item.id] || [];

      if (targetUserIds.length > 0) {
        // 📊 MONOSPACED TABLE ARCHITECTURE: Open an integrated block to align layout pillars perfectly
        contentSummaryString += "```wl\n";
        
        targetUserIds.forEach((userId, index) => {
          const linePositionLabel = `#${String(index + 1).padStart(2, '0')}`;
          const entry = globalStandings.requestsByItemDetails[item.id][userId];
          
          // Resolve name dynamically via the pure numerical user account ID
          const resolvedDisplayName = (/^\d+$/.test(userId))
            ? (membersData[userId]?.displayName || entry?.name || userId)
            : (entry?.name || userId);

          // Pad names out to 25 fixed columns to absorb variable string lengths smoothly
          const paddedName = resolvedDisplayName.padEnd(27, ' ');
          const paddedQty = `Qty: ${entry?.quantity || 0}`.padEnd(6, ' ');
          const paddedTime = `[T: ${entry?.time || '—:—'}]`;
          
          contentSummaryString += `${linePositionLabel}  ${paddedName}  ${paddedQty}  [P: ${entry?.priority ?? 0}]  ${paddedTime}\n`;
        });
        
        contentSummaryString += "```";
      } else {
        // Clearer aesthetic representation of empty drop buckets
        contentSummaryString = `🍃 *Request List Clear • Standing by for next session...*`;
      }

      embedsPayload.push({
        title: `🏷️ ${item.name.toUpperCase()}`,
        description: contentSummaryString,
        color: embedColorInteger,
        footer: { 
          text: `⏱️ Timestamp: ${timestampString} | Item ID: ${item.id}` 
        }
      });
    });
    // Locate the target Discord channel profile securely from environment
    const auctionChannelId = discordChannel('DISCORD_AUCTION_CHANNEL_ID');
    if (!auctionChannelId) {
      console.error("❌ [SNAPSHOT ERROR]: DISCORD_AUCTION_CHANNEL_ID is missing from environment layout.");
      return;
    }

    const targetChannel = existingChannel
      || await enqueueDiscordCall(() => discordClient.channels.fetch(auctionChannelId));
    if (targetChannel && typeof targetChannel.send === 'function') {
      // Pause Sign-in for 3 minutes around this burst so /oauth2/token is not
      // stacked on the same Render IP immediately after the list posts.
      noteDiscordBurst();

      // Handle fallback case where zero items are dropping tonight
      if (embedsPayload.length === 0) {
        await enqueueDiscordCall(() => targetChannel.send({
          content: `${broadcastHeadlineText}\n\n⚠️ *No active items or active bid registrations are mapped for tonight's auction pool cycle.*`
        }));
        noteDiscordBurst();
        console.log(`✅ [SNAPSHOT BROADCAST]: Empty state posted to Discord channel.`);
        return;
      }

      const EMBED_CHUNK_SIZE = 8; // 🛡️ Safe size buffer (Discord max absolute limit is 10 embeds per single text post)

      for (let i = 0; i < embedsPayload.length; i += EMBED_CHUNK_SIZE) {
        if (isDiscordCircuitOpen()) {
          console.error("⏳ [BROADCAST]: Circuit opened mid-send — aborting remaining chunks.");
          return;
        }
        const structuralChunk = embedsPayload.slice(i, i + EMBED_CHUNK_SIZE);

        try {
          if (i === 0) {
            await enqueueDiscordCall(() => targetChannel.send({
              content: broadcastHeadlineText,
              embeds: structuralChunk,
            }));
          } else {
            await enqueueDiscordCall(() => targetChannel.send({
              embeds: structuralChunk,
            }));
          }
        } catch (sendErr) {
          const status = sendErr?.status ?? sendErr?.httpStatus ?? sendErr?.code;
          if (status === 429 || /rate limit|too many requests|being blocked/i.test(sendErr?.message || '')) {
            logDiscordRateLimit('snapshot broadcast', sendErr);
            console.error("⏳ [BROADCAST]: Rate-limited mid-send — aborting remaining chunks to avoid deepening the soft-ban.");
            return;
          }
          throw sendErr;
        }
      }
      
      noteDiscordBurst();
      console.log(`✅ [BROADCAST]: List is successfully sent to Discord.`);
    } else {
      console.error("❌ [BROADCAST ERROR]: Target destination is not a valid text guild channel context.");
    }
  } catch (error) {
    console.error("❌ [BROADCAST EXCEPTION]: Internal routine failure:", error.message);
  }
}