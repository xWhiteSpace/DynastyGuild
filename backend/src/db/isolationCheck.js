/**
 * Tenant isolation check: Guild A data must never appear when reading as Guild B.
 *
 *   npm --prefix backend run test:isolation
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { migrate } from './migrate.js';
import { query } from './pool.js';
import { createTenant } from './tenants.js';
import { runWithTenant } from './tenantContext.js';
import { getDatabase } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TENANT_A = 'isolation-guild-a';
const TENANT_B = 'isolation-guild-b';

async function cleanup() {
  await query('DELETE FROM tenants WHERE id = ANY($1::text[])', [[TENANT_A, TENANT_B]]);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('SKIP: DATABASE_URL is not set');
    return;
  }

  await migrate();
  await cleanup();

  await createTenant({ id: TENANT_A, displayName: 'Guild A', onboarded: true, plan: 'free' });
  await createTenant({ id: TENANT_B, displayName: 'Guild B', onboarded: true, plan: 'free' });

  await runWithTenant(TENANT_A, async () => {
    const db = getDatabase();
    await db.ref('auction/members/user-a').set({ displayName: 'SecretA', status: 'Active' });
    await db.ref('auction/web_requests/req-a').set({ userId: 'user-a', item: 'Puppet' });
  });

  const leaked = await runWithTenant(TENANT_B, async () => {
    const db = getDatabase();
    const members = (await db.ref('auction/members').once('value')).val() || {};
    const requests = (await db.ref('auction/web_requests').once('value')).val() || {};
    return { members, requests };
  });

  const memberLeak = Boolean(leaked.members['user-a']);
  const requestLeak = Boolean(leaked.requests['req-a']);

  await cleanup();

  if (memberLeak || requestLeak) {
    throw new Error(`ISOLATION FAILED memberLeak=${memberLeak} requestLeak=${requestLeak}`);
  }
  console.log('PASS: Guild B cannot read Guild A members or auction requests.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
