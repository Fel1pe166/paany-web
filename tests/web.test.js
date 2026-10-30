// Testes do painel web: login, permissões, CSRF e rotas da API (sem Discord real).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = `data-test-${PORT}`;
Object.assign(process.env, {
  DB_PATH: `${TMP}/paany.db`,
  PORT: String(PORT),
  PUBLIC_URL: BASE,
  DISCORD_CLIENT_ID: '999',
  DISCORD_CLIENT_SECRET: 'segredo-do-cliente',
  PANEL_SECRET: 'x'.repeat(40),
  ADMIN_IDS: '111',
  PIX_KEY: 'loja@cutify.com',
  PIX_NAME: 'Cutify',
  PIX_CITY: 'Sao Paulo',
});

const { openDb } = await import('../src/db.js');
openDb(process.env.DB_PATH);
const { createSession, readSession } = await import('../src/web/auth.js');
const { startWebServer } = await import('../src/web/server.js');
const orders = await import('../src/services/orders.js');

let server;
const cookieFor = (id) => createSession({ id, username: `u${id}` }).split(';')[0];
const ADMIN = cookieFor('111');
const CSRF = readSession({ headers: { cookie: ADMIN } }).csrf;

const call = (path, { method = 'GET', body, cookie = ADMIN, csrf = CSRF, origin } = {}) => fetch(BASE + path, {
  method,
  redirect: 'manual',
  headers: {
    cookie,
    ...(body !== undefined ? { 'content-type': 'application/json', 'x-csrf-token': csrf } : {}),
    ...(origin ? { origin } : {}),
  },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

before(async () => {
  server = startWebServer();
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
});
after(() => {
  server.close();
  rmSync(TMP, { recursive: true, force: true });
});

test('sem login: painel redireciona e API responde 401', async () => {
  const p = await call('/painel', { cookie: '' });
  assert.equal(p.status, 302);
  assert.equal(p.headers.get('location'), '/login');
  assert.equal((await call('/api/me', { cookie: '' })).status, 401);
});

test('login redireciona para o Discord com state', async () => {
  const r = await call('/login', { cookie: '' });
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('location'));
  assert.equal(to.hostname, 'discord.com');
  assert.equal(to.searchParams.get('redirect_uri'), `${BASE}/auth/callback`);
  assert.ok(to.searchParams.get('state'));
  assert.match(r.headers.get('set-cookie'), /paany_st=/);
});

test('callback com state errado é recusado', async () => {
  const r = await call('/auth/callback?code=abc&state=errado', { cookie: 'paany_st=outro' });
  assert.equal(r.status, 400);
});

test('sessão de quem não é admin não vale', async () => {
  assert.equal((await call('/api/me', { cookie: cookieFor('222') })).status, 401);
});

test('cookie adulterado não vale', async () => {
  const forged = ADMIN.replace(/\.[^.]+$/, '.assinaturafalsa');
  assert.equal((await call('/api/me', { cookie: forged })).status, 401);
});

test('admin entra no painel e na API', async () => {
  const p = await call('/painel');
  assert.equal(p.status, 200);
  assert.match(p.headers.get('content-security-policy'), /default-src 'self'/);
  const me = await (await call('/api/me')).json();
  assert.equal(me.id, '111');
  assert.equal(me.csrf, CSRF);
});

test('escrita sem token CSRF ou de outra origem é bloqueada', async () => {
  const body = { name: 'X', price: '5,00', category: 'ae', deliveryType: 'link', deliveryContent: 'https://x' };
  assert.equal((await call('/api/products', { method: 'POST', body, csrf: 'errado' })).status, 403);
  assert.equal((await call('/api/products', { method: 'POST', body, origin: 'https://site-malicioso.com' })).status, 403);
});

test('cria, lista e edita produto; conteúdo privado só no detalhe', async () => {
  const bad = await call('/api/products', { method: 'POST', body: { name: 'Sem preço', price: 'abc', category: 'ae', deliveryType: 'link' } });
  assert.equal(bad.status, 400);

  const r = await call('/api/products', { method: 'POST', body: {
    name: 'Pack CC', price: '12,90', category: 'ae', deliveryType: 'link', deliveryContent: 'https://drive/segredo', stock: '5', description: 'CCs',
  } });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.price, 1290);

  const list = await (await call('/api/products')).json();
  const item = list.find((x) => x.id === p.id);
  assert.equal(item.deliveryContent, undefined);
  assert.equal(item.hasContent, true);

  const up = await (await call(`/api/products/${p.id}`, { method: 'PUT', body: { price: '9,90', active: false } })).json();
  assert.equal(up.price, 990);
  assert.equal(up.active, false);
});

test('pedido de Pix manual: aprovação exige digitar o ID e entrega uma vez só', async () => {
  const prod = orders.createProduct({ name: 'Preset', category: 'alight', price_cents: 500, delivery_type: 'texto', delivery_content: 'instruções' }, '111');
  const { order } = orders.createOrder({ userId: '333', productId: prod.id, method: 'pix_manual' });

  const wrong = await (await call(`/api/orders/${order.id}/approve`, { method: 'POST', body: { confirm: 'CUT-ERRADO' } })).json();
  assert.equal(wrong.ok, false);
  assert.equal(orders.getOrder(order.id).status, 'aguardando_pagamento');

  const ok = await (await call(`/api/orders/${order.id}/approve`, { method: 'POST', body: { confirm: order.id.toLowerCase() } })).json();
  assert.equal(ok.ok, true, ok.message);
  assert.equal(orders.getOrder(order.id).status, 'entregue');
  assert.equal(orders.getOrder(order.id).reviewed_by, '111');

  const again = await (await call(`/api/orders/${order.id}/approve`, { method: 'POST', body: { confirm: order.id } })).json();
  assert.equal(again.ok, false);

  const detail = await (await call(`/api/orders/${order.id}`)).json();
  assert.equal(detail.events.length, 1);

  const list = await (await call('/api/orders?status=pagos&q=333')).json();
  assert.ok(list.items.some((o) => o.id === order.id));
});

test('pedido do Mercado Pago não pode ser aprovado à mão', async () => {
  const prod = orders.createProduct({ name: 'VIP', category: 'vip', price_cents: 800, delivery_type: 'texto', delivery_content: 'oi' }, '111');
  const { order } = orders.createOrder({ userId: '444', productId: prod.id, method: 'mercadopago' });
  const r = await (await call(`/api/orders/${order.id}/approve`, { method: 'POST', body: { confirm: order.id } })).json();
  assert.equal(r.ok, false);
  assert.equal(orders.getOrder(order.id).status, 'aguardando_pagamento');
});

test('dashboard, cupons, VIPs, avaliações e histórico respondem', async () => {
  const d = await (await call('/api/dashboard?days=7')).json();
  assert.equal(d.series.length, 7);
  assert.ok(d.total.vendas >= 1);

  const coupons = await (await call('/api/coupons', { method: 'POST', body: { code: 'cutify10', type: 'percent', value: '10' } })).json();
  assert.equal(coupons[0].code, 'CUTIFY10');
  const toggled = await (await call('/api/coupons/CUTIFY10/toggle', { method: 'POST', body: {} })).json();
  assert.equal(toggled[0].active, false);

  for (const path of ['vips', 'reviews', 'audit']) assert.equal((await call(`/api/${path}`)).status, 200);
  assert.equal((await call('/api/reviews/99999/toggle', { method: 'POST', body: {} })).status, 404);
});

test('exportação CSV protege contra fórmulas do Excel', async () => {
  orders.createProduct({ name: '=HYPERLINK("x")', category: 'ae', price_cents: 300, delivery_type: 'texto', delivery_content: 'a' }, '111');
  const prod = orders.listProducts().find((p) => p.name.startsWith('='));
  orders.createOrder({ userId: '555', productId: prod.id, method: 'pix_manual' });
  const r = await call('/api/export.csv?days=30');
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(text.includes("'=HYPERLINK"));
  assert.ok(text.split('\n')[0].includes('pedido;cliente_id;produto'));
});

test('upload aceita só imagem de verdade e a serve depois', async () => {
  const fake = await call('/api/upload', { method: 'POST', body: { data: Buffer.from('<script>').toString('base64') } });
  assert.equal(fake.status, 400);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const { url } = await (await call('/api/upload', { method: 'POST', body: { data: `data:image/png;base64,${png.toString('base64')}` } })).json();
  const img = await fetch(url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
});

test('webhook do Mercado Pago sem assinatura é recusado', async () => {
  const r = await fetch(`${BASE}/webhook/mercadopago?type=payment&data.id=1`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 401);
});

test('mensagens do servidor mudam de idioma', async () => {
  const en = await call('/api/products', { method: 'POST', body: { name: '', price: '1', category: 'ae', deliveryType: 'link' }, cookie: `${ADMIN}; paany_lang=en` });
  assert.equal((await en.json()).error, 'Enter a name.');
  const es = await fetch(`${BASE}/api/me`, { headers: { cookie: 'x=1', 'x-lang': 'es' } });
  assert.equal((await es.json()).error, 'Sesión expirada. Inicia sesión de nuevo.');
});

test('arquivos do painel vêm comprimidos e com ETag', async () => {
  const r = await fetch(`${BASE}/painel/app.js`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  const etag = r.headers.get('etag');
  assert.ok(etag);
  const again = await fetch(`${BASE}/painel/app.js`, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal((await fetch(`${BASE}/painel/i18n.js`)).status, 200);
});

test('pausar a loja pelo painel bloqueia compras no bot', async () => {
  const { storePaused } = await import('../src/handlers/client.js').catch(() => ({}));
  const r = await (await call('/api/settings', { method: 'PUT', body: { paused: true, pausedMessage: 'Volto já' } })).json();
  assert.equal(r.ok, true);
  assert.equal(r.settings.store.paused, true);
  if (storePaused) assert.equal(storePaused(), 'Volto já');
  const d = await (await call('/api/dashboard?days=7')).json();
  assert.equal(d.paused, true);
  await call('/api/settings', { method: 'PUT', body: { paused: false } });
  if (storePaused) assert.equal(storePaused(), null);
});

test('configurações salvam termos e mostram o sistema', async () => {
  const r = await (await call('/api/settings', { method: 'PUT', body: { terms: 'Termos novos da loja' } })).json();
  assert.equal(r.settings.store.terms, 'Termos novos da loja');
  assert.equal(r.settings.store.termsCustom, true);
  assert.ok(r.settings.system.memoryMb > 0);
  assert.equal(typeof r.settings.payments.pixManual, 'boolean');
});

test('clientes, ficha do cliente, tickets e busca rápida', async () => {
  const list = await (await call('/api/customers?sort=spent')).json();
  assert.ok(list.items.length >= 1);
  assert.ok(list.items[0].spent >= list.items[list.items.length - 1].spent);
  const one = await (await call('/api/customers/333')).json();
  assert.equal(one.paidCount, 1);
  assert.equal((await call('/api/customers/000000')).status, 404);
  const tk = await (await call('/api/tickets?status=aberto')).json();
  assert.ok(Array.isArray(tk.items));
  const s = await (await call('/api/search?q=Preset')).json();
  assert.ok(s.products.some((p) => p.name === 'Preset'));
  const byId = await (await call('/api/search?q=333')).json();
  assert.ok(byId.customers.some((c) => c.userId === '333'));
});

test('duplicar produto cria cópia oculta com o mesmo conteúdo', async () => {
  const p = orders.listProducts().find((x) => x.name === 'Preset');
  const r = await (await call(`/api/products/${p.id}/duplicate`, { method: 'POST', body: {} })).json();
  assert.equal(r.ok, true);
  assert.equal(r.product.name, 'Preset (cópia)');
  assert.equal(r.product.active, false);
  assert.equal(r.product.deliveryContent, 'instruções');
});

test('backup baixa um banco SQLite válido', async () => {
  const r = await call('/api/backup');
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
});

test('comunidade: lista torneios e votações e encerra pelo painel', async () => {
  const T = await import('../src/services/tournaments.js');
  const P = await import('../src/services/polls.js');
  const t = T.createTournament({ name: 'Copa Painel', createdBy: '111' });
  T.join(t.id, 'a'); T.join(t.id, 'b');
  const { poll } = P.createPoll({ question: 'Pack?', options: ['A', 'B'], createdBy: '111' });
  P.vote(poll.id, 'a', 1);
  const d = await (await call('/api/community')).json();
  assert.ok(d.tournaments.some((x) => x.name === 'Copa Painel' && x.players === 2));
  assert.ok(d.polls.some((x) => x.question === 'Pack?' && x.counts[1] === 1));
  assert.equal(typeof d.media.video, 'boolean');
  const c = await (await call(`/api/community/polls/${poll.id}/close`, { method: 'POST', body: {} })).json();
  assert.equal(c.ok, true);
  assert.equal((await call(`/api/community/polls/${poll.id}/close`, { method: 'POST', body: {} })).status, 400);
  const x = await (await call(`/api/community/tournaments/${t.id}/cancel`, { method: 'POST', body: {} })).json();
  assert.equal(x.ok, true);
  assert.equal(T.getTournament(t.id).status, 'cancelado');
});
