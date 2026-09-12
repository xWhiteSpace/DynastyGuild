/**
 * One-time import of auctionrooc-default-rtdb-export-2.json into tenant 1.
 *
 * Usage (from repo root, with DATABASE_URL + DISCORD_GUILD_ID in backend/.env):
 *   npm --prefix backend run import-rtdb
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { migrate } from './migrate.js';
import { query } from './pool.js';
import { createTenant } from './tenants.js';
import { DEFAULT_CONFIGURATION } from '../config/defaultConfiguration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function findExportFile() {
  const override = process.env.RTDB_EXPORT_PATH;
  if (override && fs.existsSync(override)) return override;
  const candidates = [
    path.resolve(__dirname, '../../../auctionrooc-default-rtdb-export-2.json'),
    path.resolve(process.cwd(), 'auctionrooc-default-rtdb-export-2.json'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function envChannels() {
  return {
    guildId: process.env.DISCORD_GUILD_ID || '',
    auctionChannelId: process.env.DISCORD_AUCTION_CHANNEL_ID || '',
    aucreqChannelId: process.env.DISCORD_AUCREQ_CHANNEL_ID || '',
    genroomId: process.env.DISCORD_GENROOM_ID_1 || '',
    attendanceId: process.env.DISCORD_ATTENDANCE_ID || '',
    warAnnounceChannelId: process.env.DISCORD_WARANNOUNCE_CHANNEL_ID || '',
    warRooms: {
      DISCORD_WARROOM_ID_1: process.env.DISCORD_WARROOM_ID_1 || '',
      DISCORD_WARROOM_ID_2: process.env.DISCORD_WARROOM_ID_2 || '',
      DISCORD_WARROOM_ID_3: process.env.DISCORD_WARROOM_ID_3 || '',
      DISCORD_WARROOM_ID_4: process.env.DISCORD_WARROOM_ID_4 || '',
      DISCORD_WARROOM_ID_5: process.env.DISCORD_WARROOM_ID_5 || '',
    },
  };
}

async function bulkInsert(table, idCol, tenantId, obj) {
  if (!obj || typeof obj !== 'object') return 0;
  let n = 0;
  for (const [id, data] of Object.entries(obj)) {
    if (data == null) continue;
    await query(
      `INSERT INTO ${table} (tenant_id, ${idCol}, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (tenant_id, ${idCol}) DO UPDATE SET data = EXCLUDED.data`,
      [tenantId, String(id), JSON.stringify(data)]
    );
    n += 1;
  }
  return n;
}

async function insertDocs(tenantId, pathKey, data) {
  if (data === undefined) return 0;
  await query(
    `INSERT INTO json_docs (tenant_id, path, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, path) DO UPDATE SET data = EXCLUDED.data`,
    [tenantId, pathKey, JSON.stringify(data)]
  );
  return 1;
}

async function main() {
  const tenantId = process.env.DISCORD_GUILD_ID;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!tenantId) throw new Error('DISCORD_GUILD_ID is required for the first-tenant import');

  const exportPath = findExportFile();
  if (!exportPath) throw new Error('Could not find auctionrooc-default-rtdb-export-2.json');

  await migrate();

  const dump = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  const configuration = dump.settings?.configuration
    ? { ...DEFAULT_CONFIGURATION, ...dump.settings.configuration }
    : { ...DEFAULT_CONFIGURATION };
  const displayName = configuration.guildDisplayName || 'ASCENDANTS';

  await createTenant({
    id: tenantId,
    displayName,
    ownerDiscordId: process.env.PLATFORM_OWNER_DISCORD_ID || null,
    plan: 'free',
    isPlatformOwner: true,
    onboarded: true,
    configuration,
    discordChannels: envChannels(),
  });

  const members = await bulkInsert('members', 'discord_id', tenantId, dump.auction?.members);
  const requests = await bulkInsert('auction_requests', 'id', tenantId, dump.auction?.web_requests);
  const past = await bulkInsert('past_auction_awards', 'id', tenantId, dump.auction?.past_auctions);
  const loot = await bulkInsert('loot_history', 'id', tenantId, dump.auction?.loot_history);
  const instances = await bulkInsert('schedule_instances', 'id', tenantId, dump.scheduler?.instances);
  const specials = await bulkInsert('special_events', 'id', tenantId, dump.scheduler?.special_events);

  let commitments = 0;
  const commitmentTree = dump.attendance?.commitments || {};
  for (const [eventKey, membersMap] of Object.entries(commitmentTree)) {
    if (!membersMap || typeof membersMap !== 'object') continue;
    for (const [memberId, data] of Object.entries(membersMap)) {
      if (data == null) continue;
      await query(
        `INSERT INTO attendance_commitments (tenant_id, event_key, member_id, data)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (tenant_id, event_key, member_id) DO UPDATE SET data = EXCLUDED.data`,
        [tenantId, eventKey, memberId, JSON.stringify(data)]
      );
      commitments += 1;
    }
  }

  const auctionSkip = new Set(['members', 'web_requests', 'past_auctions', 'loot_history']);
  let docs = 0;
  for (const [key, val] of Object.entries(dump.auction || {})) {
    if (auctionSkip.has(key) || val == null) continue;
    docs += await insertDocs(tenantId, `auction/${key}`, val);
  }

  const attendanceSkip = new Set(['commitments']);
  for (const [key, val] of Object.entries(dump.attendance || {})) {
    if (attendanceSkip.has(key) || val == null) continue;
    docs += await insertDocs(tenantId, `attendance/${key}`, val);
  }

  const schedulerSkip = new Set(['instances', 'special_events', 'discord_circuit']);
  for (const [key, val] of Object.entries(dump.scheduler || {})) {
    if (schedulerSkip.has(key) || val == null) continue;
    docs += await insertDocs(tenantId, `scheduler/${key}`, val);
  }

  if (dump.chat) {
    docs += await insertDocs(tenantId, 'chat/messages', dump.chat.messages ?? dump.chat);
  }

  if (dump.scheduler?.discord_circuit) {
    await query(
      `INSERT INTO platform_state (key, data, updated_at)
       VALUES ('discord_circuit', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify(dump.scheduler.discord_circuit)]
    );
  }

  console.log(`Imported ASCENDANTS into tenant ${tenantId} (${displayName})`);
  console.log({ members, requests, past, loot, instances, specials, commitments, docs });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
