import { ActivityType, Client, Events, GatewayIntentBits, Options, Partials } from 'discord.js';
import { config, features, validateConfig } from './config.js';
import { openDb } from './db.js';
import { handleInteraction } from './handlers/router.js';
import { startBackupLoop } from './services/backup.js';
import { logError, sendLog, setClient } from './services/logger.js';
import { startPaymentLoop } from './services/payments.js';
import { startVipLoop } from './services/vip.js';
import { startWebServer } from './web/server.js';
import { startCommunityLoop } from './handlers/community.js';
import { commandsJson } from './commands/definitions.js';

validateConfig();
openDb();

const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers];
// Necessário só para gerar a transcrição dos tickets ao fechar
if (config.transcripts) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);

// Caches enxutos para caber em hospedagem grátis (100 MB de RAM)
const client = new Client({
  intents,
  partials: [Partials.Channel],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 20,
    PresenceManager: 0,
    ReactionManager: 0,
    GuildEmojiManager: 0,
    GuildStickerManager: 0,
    VoiceStateManager: 0,
    GuildMemberManager: { maxSize: 200, keepOverLimit: (m) => m.id === m.client.user.id },
    UserManager: { maxSize: 200, keepOverLimit: (u) => u.id === u.client.user.id },
  }),
  sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 600, lifetime: 900 } },
});
setClient(client);

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] ${c.user.tag} online • Pix automático: ${features.mercadoPago ? 'sim' : 'não'} • Pix manual: ${features.pixManual ? 'sim' : 'não'}`);
  c.user.setPresence({ activities: [{ name: `${config.storeName} Store • /loja`, type: ActivityType.Watching }], status: 'online' });
  // Registra os comandos sozinho ao ligar (não precisa rodar npm run deploy)
  try {
    const body = commandsJson();
    const guild = await c.guilds.fetch(config.guildId);
    await guild.commands.set(body);
    console.log(`[bot] ${body.length} comandos registrados no servidor ${guild.name}.`);
  } catch (e) {
    console.error('[bot] Falha ao registrar comandos:', e.message);
    if (e.code === 10004) console.error('→ O bot não está no servidor DISCORD_GUILD_ID. Convide o bot com o escopo applications.commands.');
    if (e.code === 50001) console.error('→ Falta permissão: convide o bot de novo marcando "bot" e "applications.commands".');
  }
  startPaymentLoop();
  startVipLoop();
  startBackupLoop();
  startCommunityLoop();
  await sendLog('admin', { title: `${config.botName} iniciou`, description: 'Bot online e verificando pagamentos.' });
});

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.Error, (e) => logError('cliente Discord', e));

process.on('unhandledRejection', (e) => logError('promessa não tratada', e));
process.on('uncaughtException', (e) => { console.error(e); logError('exceção não tratada', e); });

// Servidor web só quando há endereço público (painel/webhook). No plano grátis economiza memória.
if (config.publicUrl) startWebServer();
client.login(config.token).catch((e) => {
  console.error('[bot] Falha no login:', e.message);
  if (/disallowed intents/i.test(e.message)) {
    console.error('→ Ative "Server Members Intent" e "Message Content Intent" no Developer Portal (aba Bot), ou use ENABLE_TRANSCRIPTS=false.');
  }
  process.exit(1);
});
