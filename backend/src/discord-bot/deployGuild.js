import { REST, Routes } from 'discord.js';
import commandsManifest from '../discord-bot/commands/manifest.js';

export const BOT_INVITE_PERMISSIONS = '311520775232';

export function botInviteUrl(guildId) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: BOT_INVITE_PERMISSIONS,
    scope: 'bot applications.commands',
  });
  if (guildId) {
    params.set('guild_id', guildId);
    params.set('disable_guild_select', 'true');
  }
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function deployGuildCommands(guildId) {
  if (!guildId || !process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CLIENT_ID) {
    throw new Error('Missing Discord credentials for slash command deploy');
  }
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  const data = await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
    { body: commandsManifest }
  );
  return data;
}
