import { REST, Routes } from 'discord.js';
import commandsManifest from './commands/manifest.js';
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
    if (process.env.DATABASE_URL) {
      await migrate();
      const tenants = await listOnboardedTenants();
      const ids = tenants.map((t) => t.id);
      if (process.env.DISCORD_GUILD_ID && !ids.includes(process.env.DISCORD_GUILD_ID)) {
        ids.push(process.env.DISCORD_GUILD_ID);
      }
      for (const guildId of ids) {
        const data = await rest.put(
          Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
          { body: commandsManifest },
        );
        console.log(`✅ Registered ${data.length} commands on ${guildId}`);
      }
      if (!ids.length) console.log('No onboarded tenants found. Set DISCORD_GUILD_ID or onboard a guild first.');
      return;
    }

    console.log(`⏳ Initializing refresh for ${commandsManifest.length} slash commands...`);
    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commandsManifest },
    );
    console.log(`✅ Success! Registered ${data.length} commands to the test server.`);
  } catch (error) {
    console.error('❌ Failed to register slash commands:', error);
  }
})();
