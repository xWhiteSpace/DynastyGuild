import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { listOnboardedTenants } from '../db/tenants.js';
import { migrate } from '../db/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    if (!process.env.DATABASE_URL) {
      console.log('DATABASE_URL is required to clear slash commands.');
      process.exit(1);
    }
    await migrate();
    const tenants = await listOnboardedTenants();
    console.log('Clearing slash commands on onboarded guilds...');
    for (const tenant of tenants) {
      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, tenant.id),
        { body: [] },
      );
      console.log(`Cleared ${tenant.id} (${data.length} remaining).`);
    }
  } catch (error) {
    console.error('Failed to clear slash commands:', error);
    process.exit(1);
  }
})();
