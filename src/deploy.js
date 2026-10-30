// Registra os comandos no servidor. Rode uma vez (e de novo sempre que mudar comandos):
//   npm run deploy
import { REST, Routes } from 'discord.js';
import { config, validateConfig } from './config.js';
import { commandsJson } from './commands/definitions.js';

validateConfig();
const rest = new REST().setToken(config.token);
const body = commandsJson();

try {
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  console.log(`✔ ${body.length} comandos registrados no servidor ${config.guildId}.`);
} catch (e) {
  console.error('✖ Falha ao registrar comandos:', e.message);
  process.exit(1);
}
