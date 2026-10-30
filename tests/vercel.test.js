// Testes da integração painel na Vercel ↔ bot na Discloud (ponte api/paany-bridge.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PORT = 19000 + Math.floor(Math.random() * 900);
const PANEL = 'https://painel-cutify.vercel.app';
const TMP = `data-vercel-${PORT}`;
const SECRET = 'segredo-da-ponte-com-32-caracteres!!';
Object.assign(process.env, {
  DB_PATH: `${TMP}/paany.db`, PORT: String(PORT), HOST: '127.0.0.1', PUBLIC_URL: PANEL,
  DISCORD_CLIENT_ID: '999', DISCORD_CLIENT_SECRET: 'x', PANEL_SECRET: 'p'.repeat(40), ADMIN_IDS: '111',
  BRIDGE_SECRET: SECRET, BOT_URL: `http://127.0.0.1:${PORT}`,
});

const { openDb } = await import('../src/db.js');
openDb(process.env.DB_PATH);
const { createSession, readSession } = await import('../src/web/auth.js');
const { startWebServer } = await import('../src/web/server.js');
const bridge = await import('../api/paany-bridge.js');

let server;
const cookie = createSession({ id: '111', username: 'adm' }).split(';')[0];
const csrf = readSession({ headers: { cookie } }).csrf;
/** Simula o navegador chamando a Vercel: o vercel.json reescreve para a função com estes parâmetros. */
const viaBridge = (rewritten, { method = 'GET', body, headers = {} } = {}) => bridge.handle(new Request(`${PANEL}${rewritten}`, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { cookie, 'x-forwarded-for': '200.1.2.3', ...(body ? { 'content-type': 'application/json', 'x-csrf-token': csrf, origin: PANEL } : {}), ...headers },
}));

before(async () => {
  server = startWebServer();
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
});
after(() => { server.close(); rmSync(TMP, { recursive: true, force: true }); });

test('bot recusa acesso direto ao painel/API sem passar pela ponte', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/me`, { headers: { cookie } });
  assert.equal(r.status, 403);
  const login = await fetch(`http://127.0.0.1:${PORT}/login`, { redirect: 'manual' });
  assert.equal(login.status, 403);
  // Saúde e webhook continuam abertos
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/healthz`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/webhook/mercadopago`, { method: 'POST', body: '{}' })).status, 401);
});

test('pela ponte: sessão, leitura com filtros e JSON descomprimido', async () => {
  const me = await viaBridge('/api/paany-bridge?base=api&bridgepath=me', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('content-encoding'), null);
  assert.equal((await me.json()).id, '111');
  const orders = await viaBridge('/api/paany-bridge?base=api&bridgepath=orders&status=pagos&limit=5');
  const d = await orders.json();
  assert.equal(d.limit, 5);
});

test('pela ponte: escrita com CSRF e origem da Vercel funciona; origem estranha não', async () => {
  const body = { name: 'Pack Vercel', price: '7,00', category: 'ae', deliveryType: 'link', deliveryContent: 'https://x' };
  const ok = await viaBridge('/api/paany-bridge?base=api&bridgepath=products', { method: 'POST', body });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ok.json()).name, 'Pack Vercel');
  const evil = await viaBridge('/api/paany-bridge?base=api&bridgepath=products', { method: 'POST', body, headers: { origin: 'https://site-ruim.com' } });
  assert.equal(evil.status, 403);
});

test('login pela ponte redireciona ao Discord com o callback da Vercel e repassa o cookie', async () => {
  const r = await viaBridge('/api/paany-bridge?to=/login', { headers: { cookie: '' } });
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('location'));
  assert.equal(to.searchParams.get('redirect_uri'), `${PANEL}/auth/callback`);
  assert.match(r.headers.get('set-cookie'), /paany_st=.*Secure/);
});

test('ponte bloqueia caminhos fora da lista e mostra erro claro', async () => {
  assert.equal((await viaBridge('/api/paany-bridge?base=api&bridgepath=../../etc/passwd')).status, 404);
  assert.equal((await viaBridge('/api/paany-bridge?to=/admin')).status, 404);
  assert.equal((await viaBridge('/api/paany-bridge?base=img&bridgepath=evil.svg')).status, 404);
  assert.equal(bridge.targetPath(new URL(`${PANEL}/x?base=api&bridgepath=orders/CUT-1/approve`)), '/api/orders/CUT-1/approve');
});

test('bot offline ou BOT_URL ausente: mensagem amigável', async () => {
  const keep = process.env.BOT_URL;
  process.env.BOT_URL = 'http://127.0.0.1:1';
  const off = await viaBridge('/api/paany-bridge?base=api&bridgepath=me');
  assert.equal(off.status, 502);
  assert.match((await off.json()).error, /offline/);
  process.env.BOT_URL = '';
  const none = await viaBridge('/api/paany-bridge?to=/login');
  assert.equal(none.status, 500);
  assert.match(await none.text(), /BOT_URL/);
  process.env.BOT_URL = keep;
});

test('vercel.json e build do painel estão coerentes', () => {
  const v = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.ok(existsSync('api/paany-bridge.js'));
  assert.ok(v.rewrites.every((r) => r.destination.startsWith('/api/paany-bridge') || r.destination === '/painel/index.html'));
  execFileSync(process.execPath, ['scripts/build-vercel.mjs']);
  for (const f of ['index.html', 'app.js', 'app.css', 'i18n.js', 'logo.png', 'manifest.webmanifest']) assert.ok(existsSync(`vercel-dist/painel/${f}`), f);
  assert.ok(!existsSync('vercel-dist/painel/.env'));
  rmSync('vercel-dist', { recursive: true, force: true });
});
