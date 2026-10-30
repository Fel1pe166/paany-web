// Carrega o arquivo .env (recurso nativo do Node 22, sem dependências)
try { process.loadEnvFile(); } catch { /* sem .env: usa as variáveis do ambiente da hospedagem */ }

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export const config = {
  // Discord
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  adminIds: list(process.env.ADMIN_IDS),
  staffRoleId: process.env.STAFF_ROLE_ID || null,
  transcripts: (process.env.ENABLE_TRANSCRIPTS ?? 'true') === 'true',

  // Loja
  storeName: process.env.STORE_NAME || 'Cutify',
  botName: process.env.BOT_NAME || 'Paany',
  orderExpiresMinutes: int(process.env.ORDER_EXPIRES_MINUTES, 30),
  maxPendingOrders: int(process.env.MAX_PENDING_ORDERS, 3),
  vipWarnDays: int(process.env.VIP_WARN_DAYS, 3),

  // Mercado Pago (Pix automático)
  mpAccessToken: process.env.MP_ACCESS_TOKEN || null,
  mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || null,
  payerEmail: process.env.MP_PAYER_EMAIL || null,
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, '') || null,
  port: int(process.env.PORT, 8080),
  pollSeconds: int(process.env.MP_POLL_SECONDS, 20),

  // Painel web (precisa de hospedagem com endereço público)
  clientSecret: process.env.DISCORD_CLIENT_SECRET || null,
  panelSecret: process.env.PANEL_SECRET || null,
  // Painel na Vercel: senha compartilhada com a ponte (api/paany-bridge.js)
  bridgeSecret: process.env.BRIDGE_SECRET || null,
  host: process.env.HOST || '0.0.0.0',

  // Pix manual
  pixKey: process.env.PIX_KEY || null,
  pixName: process.env.PIX_NAME || null,
  pixCity: process.env.PIX_CITY || null,

  // Mídia livre (opcional): vídeos Pexels/Pixabay e músicas Jamendo
  pexelsKey: process.env.PEXELS_API_KEY || null,
  pixabayKey: process.env.PIXABAY_API_KEY || null,
  jamendoClientId: process.env.JAMENDO_CLIENT_ID || null,

  // Banco de dados
  dbPath: process.env.DB_PATH || 'data/paany.db',
  backupKeep: int(process.env.BACKUP_KEEP, 7),
};

export const features = {
  mercadoPago: Boolean(config.mpAccessToken && config.payerEmail),
  pixManual: Boolean(config.pixKey && config.pixName && config.pixCity),
  webhook: Boolean(config.mpAccessToken && config.mpWebhookSecret),
  panel: Boolean(config.publicUrl && config.clientSecret && config.panelSecret && config.panelSecret.length >= 32),
};

export function validateConfig() {
  const missing = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'ADMIN_IDS']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[config] Variáveis obrigatórias ausentes: ${missing.join(', ')}. Veja o .env.example.`);
    process.exit(1);
  }
  if (!features.mercadoPago && !features.pixManual) {
    console.warn('[config] Nenhum meio de pagamento configurado. Configure MP_ACCESS_TOKEN/MP_PAYER_EMAIL e/ou PIX_KEY/PIX_NAME/PIX_CITY.');
  }
  if (config.panelSecret && config.panelSecret.length < 32) {
    console.warn('[config] PANEL_SECRET precisa ter pelo menos 32 caracteres. Painel web desligado.');
  }
  if (config.bridgeSecret && config.bridgeSecret.length < 24) {
    console.warn('[config] BRIDGE_SECRET muito curto: use pelo menos 24 caracteres aleatórios.');
  }
  if (config.mpAccessToken?.startsWith('TEST-')) {
    console.warn('[config] Mercado Pago em modo TESTE. Troque pelo token de produção antes de vender.');
  }
}
