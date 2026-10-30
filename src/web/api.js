// API JSON do painel web. Toda rota aqui já passou por login + isAdmin + CSRF (ver server.js).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config, features } from '../config.js';
import { all, audit, getSetting, one, run, setSetting } from '../db.js';
import { CATEGORIES, STATUS_LABEL } from '../theme.js';
import { isHttpUrl, parsePrice } from '../util.js';
import {
  approveManualOrder, cancelOrderAdmin, redeliverOrder, refundOrder, rejectManualOrder,
} from '../services/actions.js';
import { getClient, sendLog } from '../services/logger.js';
import {
  createCoupon, createProduct, getOrder, getProduct, listProducts, normalizeCode, salesStats, updateProduct,
} from '../services/orders.js';
import { latestReviews } from '../services/reviews.js';
import { reasonLabel, ticketRatingStats } from '../services/tickets.js';
import {
  DEFAULT_TICKET_CONFIG, getTicketConfig, resetTicketConfig, saveTicketConfig,
} from '../services/ticketConfig.js';
import * as EMB from '../services/embeds.js';
import { publishSupportPanel, refreshSupportPanel } from '../ui/support.js';
import { DEFAULT_TERMS } from '../ui/store.js';
import * as TRN from '../services/tournaments.js';
import * as POLL from '../services/polls.js';
import { mediaFeatures } from '../services/media.js';
import { finishPoll, refreshTournamentMessage } from '../handlers/community.js';

const PAID = `('pago','processando','entregue','falha_entrega','reembolso_solicitado')`;
const DAY = 86400000;
export const UPLOAD_DIR = () => join(dirname(config.dbPath), 'uploads');

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };

/* ------------------------------ Nomes ------------------------------ */

// Cache simples de nomes de usuários do Discord para mostrar na tabela
const names = new Map();
async function userNames(ids) {
  const client = getClient();
  const out = {};
  for (const id of [...new Set(ids)].slice(0, 120)) {
    if (!names.has(id) && client?.isReady()) {
      const u = await client.users.fetch(id).catch(() => null);
      names.set(id, u ? (u.globalName || u.username) : null);
    }
    out[id] = names.get(id) ?? null;
  }
  return out;
}

/* ---------------------------- Visão geral ---------------------------- */

function dailySeries(days) {
  const since = new Date(Date.now() - (days - 1) * DAY);
  const rows = all(
    `SELECT date((paid_at / 1000) - 10800, 'unixepoch') d, COUNT(*) n, SUM(total_cents) t
     FROM orders WHERE status IN ${PAID} AND paid_at >= ? GROUP BY d`,
    since.getTime() - DAY,
  );
  const byDay = Object.fromEntries(rows.map((r) => [r.d, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY - 3 * 3600_000).toISOString().slice(0, 10); // dia em Brasília
    out.push({ day: d, orders: byDay[d]?.n || 0, total: byDay[d]?.t || 0 });
  }
  return out;
}

async function dashboard(query) {
  const days = Math.min(Math.max(Number(query.get('days')) || 30, 7), 365);
  const startToday = new Date(new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10) + 'T03:00:00Z').getTime();
  const recent = all(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 8`);
  const nm = await userNames(recent.map((o) => o.user_id));
  const since = Date.now() - days * DAY;
  const prevSince = since - days * DAY;
  const prev = one(`SELECT COUNT(*) vendas, COALESCE(SUM(total_cents),0) bruto FROM orders WHERE status IN ${PAID} AND paid_at >= ? AND paid_at < ?`, prevSince, since);
  const created = one('SELECT COUNT(*) n FROM orders WHERE created_at >= ?', since).n;
  const paidOfCreated = one(`SELECT COUNT(*) n FROM orders WHERE created_at >= ? AND status IN ${PAID}`, since).n;
  const byMethod = all(`SELECT method, COUNT(*) n, SUM(total_cents) t FROM orders WHERE status IN ${PAID} AND paid_at >= ? GROUP BY method`, since);
  const byCategory = all(`SELECT p.category, COUNT(*) n, SUM(o.total_cents) t FROM orders o JOIN products p ON p.id = o.product_id
                          WHERE o.status IN ${PAID} AND o.paid_at >= ? GROUP BY p.category ORDER BY t DESC`, since);
  const customers = one(`SELECT COUNT(DISTINCT user_id) n FROM orders WHERE status IN ${PAID} AND paid_at >= ?`, since).n;
  const lowStock = all('SELECT id, name, stock FROM products WHERE active = 1 AND stock IS NOT NULL AND stock <= 3 ORDER BY stock LIMIT 5');
  return {
    today: salesStats(startToday),
    period: salesStats(since),
    previous: prev,
    conversion: created ? paidOfCreated / created : null,
    created,
    customers,
    byMethod,
    byCategory: byCategory.map((c) => ({ ...c, label: CATEGORIES[c.category] || c.category })),
    lowStock,
    paused: getSetting('store_paused') === '1',
    total: salesStats(0),
    days,
    series: dailySeries(days),
    vipsActive: one('SELECT COUNT(*) n FROM vips WHERE active = 1').n,
    ticketsOpen: one(`SELECT COUNT(*) n FROM tickets WHERE status = 'aberto'`).n,
    rating: one('SELECT COUNT(*) n, AVG(rating) avg FROM reviews WHERE hidden = 0'),
    recent: recent.map((o) => publicOrder(o, nm)),
  };
}

/* ------------------------------ Pedidos ------------------------------ */

function publicOrder(o, nm = {}) {
  return {
    id: o.id, userId: o.user_id, userName: nm[o.user_id] ?? null, product: o.product_name, productId: o.product_id,
    unit: o.unit_price_cents, discount: o.discount_cents, total: o.total_cents, coupon: o.coupon_code,
    method: o.method, status: o.status, statusLabel: STATUS_LABEL[o.status] || o.status,
    mpPaymentId: o.mp_payment_id, ticketChannelId: o.ticket_channel_id, createdAt: o.created_at, paidAt: o.paid_at,
    deliveredAt: o.delivered_at, attempts: o.delivery_attempts, lastError: o.last_error, reviewedBy: o.reviewed_by,
    note: o.note, expiresAt: o.expires_at,
  };
}

async function listOrders(query) {
  const where = [];
  const params = [];
  const status = query.get('status');
  if (status === 'abertos') where.push(`status IN ('aguardando_pagamento','em_analise')`);
  else if (status === 'pagos') where.push(`status IN ${PAID}`);
  else if (status && STATUS_LABEL[status]) { where.push('status = ?'); params.push(status); }
  const q = (query.get('q') || '').trim();
  if (q) {
    where.push('(id LIKE ? OR user_id = ? OR product_name LIKE ? OR mp_payment_id = ?)');
    params.push(`%${q.toUpperCase()}%`, q, `%${q}%`, q);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Number(query.get('limit')) || 30, 100);
  const offset = Math.max(Number(query.get('offset')) || 0, 0);
  const items = all(`SELECT * FROM orders ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  const total = one(`SELECT COUNT(*) n FROM orders ${w}`, ...params).n;
  const nm = await userNames(items.map((o) => o.user_id));
  return { items: items.map((o) => publicOrder(o, nm)), total, limit, offset };
}

async function orderDetail(id) {
  const o = getOrder(id);
  if (!o) throw new HttpError(404, 'Pedido não encontrado.');
  const history = all(`SELECT actor_id, action, details, created_at FROM audit_log WHERE details LIKE ? ORDER BY id`, `%${o.id}%`);
  const nm = await userNames([o.user_id, o.reviewed_by, ...history.map((h) => h.actor_id)].filter(Boolean));
  return {
    order: publicOrder(o, nm),
    reviewerName: o.reviewed_by ? nm[o.reviewed_by] : null,
    names: nm,
    events: all('SELECT provider, provider_id, status, amount_cents, actor_id, created_at FROM payment_events WHERE order_id = ? ORDER BY id', o.id),
    history,
    review: one('SELECT rating, comment, created_at FROM reviews WHERE order_id = ?', o.id) || null,
    guildId: config.guildId,
  };
}

async function orderAction(id, action, body, actor) {
  let r;
  if (action === 'approve') r = await approveManualOrder(id, actor, body.confirm, 'web');
  else if (action === 'reject') r = await rejectManualOrder(id, actor, body.reason, 'web');
  else if (action === 'redeliver') r = await redeliverOrder(id, actor);
  else if (action === 'cancel') r = await cancelOrderAdmin(id, actor, body.reason, 'web');
  else if (action === 'refund') r = await refundOrder(id, actor, { removeRole: body.removeRole !== false, reason: body.reason || '', via: 'web' });
  else throw new HttpError(404, 'Ação desconhecida.');
  return r;
}

/* ------------------------------ Produtos ------------------------------ */

async function rolesList() {
  const client = getClient();
  if (!client?.isReady()) return [];
  const guild = await client.guilds.fetch(config.guildId);
  const roles = await guild.roles.fetch();
  const top = guild.members.me?.roles.highest;
  return [...roles.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, assignable: top ? top.comparePositionTo(r) > 0 : false }));
}

async function validateRole(roleId) {
  if (!roleId) return;
  const roles = await rolesList();
  const r = roles.find((x) => x.id === roleId);
  if (!r) bad('Cargo não encontrado no servidor.');
  if (!r.assignable) bad(`O cargo "${r.name}" está acima do cargo da ${config.botName}. Arraste o cargo do bot para cima em Configurações do servidor → Cargos.`);
}

/** Valida o formulário de produto. partial=true permite campos ausentes (edição). */
async function productInput(b, partial = false) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!partial || has('name')) {
    out.name = String(b.name || '').trim().slice(0, 80);
    if (!out.name) bad('Informe o nome.');
  }
  if (!partial || has('price')) {
    out.price_cents = parsePrice(b.price);
    if (!out.price_cents) bad('Preço inválido. Ex.: 8,00');
  }
  if (!partial || has('category')) {
    if (!CATEGORIES[b.category]) bad('Categoria inválida.');
    out.category = b.category;
  }
  if (!partial || has('deliveryType')) {
    if (!['cargo', 'link', 'arquivo', 'texto'].includes(b.deliveryType)) bad('Tipo de entrega inválido.');
    out.delivery_type = b.deliveryType;
  }
  if (has('description')) out.description = String(b.description || '').slice(0, 2000);
  if (has('rules')) out.rules = String(b.rules || '').slice(0, 1000);
  if (has('deliveryContent')) out.delivery_content = String(b.deliveryContent || '').trim().slice(0, 1000) || null;
  if (has('imageUrl')) {
    const u = String(b.imageUrl || '').trim();
    if (u && !isHttpUrl(u)) bad('A imagem precisa ser um link https://.');
    out.image_url = u || null;
  }
  if (has('roleId')) {
    out.role_id = b.roleId ? String(b.roleId) : null;
    await validateRole(out.role_id);
  }
  if (has('vipDays')) {
    const d = b.vipDays === '' || b.vipDays == null ? null : Number(b.vipDays);
    if (d != null && (!Number.isInteger(d) || d < 0 || d > 3650)) bad('Dias de VIP inválidos.');
    out.vip_days = d || null;
  }
  if (has('stock')) {
    const s = b.stock === '' || b.stock == null ? null : Number(b.stock);
    if (s != null && (!Number.isInteger(s) || s < 0)) bad('Estoque inválido.');
    out.stock = s;
  }
  if (has('active')) out.active = b.active ? 1 : 0;
  return out;
}

const productOut = (p, withContent = false) => ({
  id: p.id, name: p.name, description: p.description, category: p.category, categoryLabel: CATEGORIES[p.category] || p.category,
  price: p.price_cents, imageUrl: p.image_url, stock: p.stock, deliveryType: p.delivery_type, roleId: p.role_id,
  vipDays: p.vip_days, rules: p.rules, active: Boolean(p.active),
  sold: one(`SELECT COUNT(*) n FROM orders WHERE product_id = ? AND status IN ${PAID}`, p.id).n,
  ...(withContent ? { deliveryContent: p.delivery_content } : { hasContent: Boolean(p.delivery_content) }),
});

async function saveProduct(id, body, actor) {
  if (id) {
    const current = getProduct(id);
    if (!current) throw new HttpError(404, 'Produto não encontrado.');
    const changes = await productInput(body, true);
    const type = changes.delivery_type ?? current.delivery_type;
    const role = 'role_id' in changes ? changes.role_id : current.role_id;
    if (type === 'cargo' && !role) bad('Entrega do tipo "Cargo" precisa de um cargo.');
    const p = updateProduct(id, changes, actor);
    await sendLog('admin', { title: 'Produto editado (painel web)', description: `**${p.name}** (#${p.id}) por <@${actor}>` });
    return productOut(p, true);
  }
  const data = await productInput(body, false);
  if (data.delivery_type === 'cargo' && !data.role_id) bad('Entrega do tipo "Cargo" precisa de um cargo.');
  if (data.delivery_type !== 'cargo' && !data.delivery_content) bad('Informe o conteúdo da entrega (link ou instruções).');
  const p = createProduct(data, actor);
  await sendLog('admin', { title: 'Produto criado (painel web)', description: `**${p.name}** (#${p.id}) por <@${actor}>` });
  return productOut(p, true);
}

/* ------------------------------ Upload ------------------------------ */

const MAGIC = [
  { ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  { ext: 'webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

function upload(body, actor) {
  const data = String(body.data || '').replace(/^data:[^,]+,/, '');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) bad('Arquivo vazio.');
  if (buf.length > 3 * 1024 * 1024) bad('Imagem maior que 3 MB.');
  const kind = MAGIC.find((m) => m.test(buf));
  if (!kind) bad('Envie PNG, JPG, GIF ou WEBP.');
  mkdirSync(UPLOAD_DIR(), { recursive: true });
  const file = `${randomBytes(12).toString('hex')}.${kind.ext}`;
  writeFileSync(join(UPLOAD_DIR(), file), buf);
  audit(actor, 'painel.upload', file);
  return { url: `${config.publicUrl}/img/${file}` };
}

/* ------------------------------ Cupons ------------------------------ */

function couponsList() {
  return all('SELECT * FROM coupons ORDER BY active DESC, created_at DESC LIMIT 200').map((c) => ({
    code: c.code, type: c.type, value: c.value, maxUses: c.max_uses, uses: c.uses, startsAt: c.starts_at, expiresAt: c.expires_at,
    minCents: c.min_cents, productId: c.product_id, onePerUser: Boolean(c.one_per_user), active: Boolean(c.active),
  }));
}

function couponCreate(b, actor) {
  const type = b.type === 'fixed' ? 'fixed' : 'percent';
  const value = type === 'percent' ? Math.round(Number(String(b.value).replace(',', '.'))) : parsePrice(b.value);
  if (!value || value <= 0) bad('Valor do desconto inválido.');
  const starts = b.startsAt ? Date.parse(b.startsAt) : null;
  const expires = b.expiresAt ? Date.parse(b.expiresAt) : null;
  if ((b.startsAt && Number.isNaN(starts)) || (b.expiresAt && Number.isNaN(expires))) bad('Data inválida.');
  if (starts && expires && expires <= starts) bad('A validade precisa ser depois do início.');
  const productId = b.productId ? Number(b.productId) : null;
  if (productId && !getProduct(productId)) bad('Produto não encontrado.');
  try {
    createCoupon({
      code: b.code, type, value, max_uses: b.maxUses ? Number(b.maxUses) : null, starts_at: starts, expires_at: expires,
      min_cents: b.minimum ? parsePrice(b.minimum) || 0 : 0, product_id: productId, one_per_user: b.onePerUser !== false,
    }, actor);
  } catch (e) { bad(e.message); }
  return couponsList();
}

function couponToggle(code, actor) {
  const c = normalizeCode(code);
  const r = run('UPDATE coupons SET active = 1 - active WHERE code = ?', c);
  if (!r.changes) throw new HttpError(404, 'Cupom não encontrado.');
  audit(actor, 'cupom.alternar', `${c} (painel web)`);
  return couponsList();
}

/* -------------------------- VIPs, avaliações, logs -------------------------- */

async function vipsList() {
  const rows = all(`SELECT v.*, p.name product_name FROM vips v LEFT JOIN products p ON p.id = v.product_id
                    WHERE v.active = 1 ORDER BY v.expires_at IS NULL, v.expires_at LIMIT 300`);
  const nm = await userNames(rows.map((v) => v.user_id));
  return rows.map((v) => ({ userId: v.user_id, userName: nm[v.user_id], product: v.product_name, roleId: v.role_id, expiresAt: v.expires_at, orderId: v.order_id }));
}

async function reviewsList() {
  const rows = latestReviews(100);
  const nm = await userNames(rows.map((r) => r.user_id));
  return rows.map((r) => ({
    id: r.id, orderId: r.order_id, userId: r.user_id, userName: nm[r.user_id], product: r.product_name,
    rating: r.rating, comment: r.comment, hidden: Boolean(r.hidden), createdAt: r.created_at,
  }));
}

async function auditList(query) {
  const q = (query?.get('q') || '').trim();
  const rows = q
    ? all('SELECT * FROM audit_log WHERE action LIKE ? OR details LIKE ? OR actor_id = ? ORDER BY id DESC LIMIT 300', `%${q}%`, `%${q}%`, q)
    : all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300');
  const nm = await userNames(rows.map((a) => a.actor_id).filter(Boolean));
  return rows.map((a) => ({ actorId: a.actor_id, actorName: a.actor_id ? nm[a.actor_id] : null, action: a.action, details: a.details, createdAt: a.created_at }));
}

/* ------------------------------ Clientes ------------------------------ */

async function customersList(query) {
  const q = (query.get('q') || '').trim();
  const sort = { spent: 'spent DESC', orders: 'orders DESC', recent: 'last DESC' }[query.get('sort')] || 'last DESC';
  const limit = Math.min(Number(query.get('limit')) || 30, 100);
  const offset = Math.max(Number(query.get('offset')) || 0, 0);
  // Busca por ID ou por nome já conhecido do Discord
  let ids = null;
  if (q) {
    ids = [...names.entries()].filter(([, n]) => n && n.toLowerCase().includes(q.toLowerCase())).map(([id]) => id);
    if (/^\d{3,25}$/.test(q)) ids.push(q);
    if (!ids.length) return { items: [], total: 0, limit, offset };
  }
  const where = ids ? `WHERE user_id IN (${ids.map(() => '?').join(',')})` : '';
  const base = `SELECT user_id, COUNT(*) orders,
      SUM(CASE WHEN status IN ${PAID} THEN 1 ELSE 0 END) paid,
      SUM(CASE WHEN status IN ${PAID} THEN total_cents ELSE 0 END) spent,
      MAX(created_at) last
    FROM orders ${where} GROUP BY user_id`;
  const rows = all(`${base} ORDER BY ${sort} LIMIT ? OFFSET ?`, ...(ids || []), limit, offset);
  const total = one(`SELECT COUNT(*) n FROM (${base})`, ...(ids || [])).n;
  const nm = await userNames(rows.map((r) => r.user_id));
  const vipSet = new Set(all('SELECT DISTINCT user_id FROM vips WHERE active = 1').map((v) => v.user_id));
  return {
    items: rows.map((r) => ({ userId: r.user_id, userName: nm[r.user_id], orders: r.orders, paid: r.paid, spent: r.spent, lastAt: r.last, vip: vipSet.has(r.user_id) })),
    total, limit, offset,
  };
}

async function customerDetail(userId) {
  const orders = all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', userId);
  if (!orders.length) throw new HttpError(404, 'Cliente não encontrado.');
  const nm = await userNames([userId]);
  const paid = orders.filter((o) => PAID.includes(`'${o.status}'`));
  let avatar = null;
  const u = getClient()?.users.cache.get(userId);
  if (u) avatar = u.displayAvatarURL({ size: 128 });
  return {
    userId, userName: nm[userId], avatar,
    spent: paid.reduce((t, o) => t + o.total_cents, 0), paidCount: paid.length, firstAt: orders[orders.length - 1].created_at,
    orders: orders.map((o) => publicOrder(o, nm)),
    vips: all(`SELECT v.*, p.name product_name FROM vips v LEFT JOIN products p ON p.id = v.product_id WHERE v.user_id = ? ORDER BY v.active DESC, v.id DESC`, userId)
      .map((v) => ({ product: v.product_name, roleId: v.role_id, expiresAt: v.expires_at, active: Boolean(v.active) })),
    reviews: all('SELECT r.rating, r.comment, r.created_at, r.order_id, p.name product FROM reviews r LEFT JOIN products p ON p.id = r.product_id WHERE r.user_id = ? ORDER BY r.id DESC', userId),
    tickets: all('SELECT id, reason, status, created_at, channel_id FROM tickets WHERE user_id = ? ORDER BY id DESC LIMIT 20', userId),
    guildId: config.guildId,
  };
}

/* ------------------------------ Tickets ------------------------------ */

async function ticketsList(query) {
  const status = query.get('status') === 'fechado' ? 'fechado' : 'aberto';
  const rows = all(`SELECT * FROM tickets WHERE status = ? ORDER BY ${status === 'aberto' ? 'created_at' : 'closed_at DESC'} LIMIT 100`, status);
  const nm = await userNames(rows.flatMap((t) => [t.user_id, t.closed_by]).filter(Boolean));
  return {
    guildId: config.guildId,
    counts: Object.fromEntries(all('SELECT status, COUNT(*) n FROM tickets GROUP BY status').map((r) => [r.status, r.n])),
    items: rows.map((t) => ({
      id: t.id, channelId: t.channel_id, userId: t.user_id, userName: nm[t.user_id], reason: t.reason, reasonLabel: reasonLabel(t.reason),
      orderId: t.order_id, status: t.status, createdAt: t.created_at, closedAt: t.closed_at, closedBy: t.closed_by, closedByName: nm[t.closed_by] ?? null,
    })),
  };
}

/* --------------------------- Configurações e sistema --------------------------- */

function channelInfo(key) {
  const id = getSetting(key);
  if (!id) return null;
  const ch = getClient()?.channels.cache.get(id);
  return { id, name: ch?.name ?? null };
}

function lastBackup() {
  const dir = join(dirname(config.dbPath), 'backups');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  if (!files.length) return null;
  const f = files[files.length - 1];
  return { file: f, at: statSync(join(dir, f)).mtimeMs, count: files.length };
}

function settingsGet() {
  const client = getClient();
  const mem = process.memoryUsage();
  let dbSize = null;
  try { dbSize = statSync(config.dbPath).size; } catch { /* banco em memória */ }
  return {
    store: {
      paused: getSetting('store_paused') === '1',
      pausedMessage: getSetting('store_paused_msg') || '',
      terms: getSetting('terms_text') || DEFAULT_TERMS,
      termsCustom: Boolean(getSetting('terms_text')),
    },
    channels: {
      vendas: channelInfo('channel_logs_vendas'), admin: channelInfo('channel_logs_admin'), erros: channelInfo('channel_logs_erros'),
      aprovacoes: channelInfo('channel_approvals'), avaliacoes: channelInfo('channel_reviews'), tickets: channelInfo('ticket_category'),
    },
    payments: {
      mercadoPago: features.mercadoPago, mpTest: Boolean(config.mpAccessToken?.startsWith('TEST-')), webhook: features.webhook,
      pixManual: features.pixManual, pollSeconds: config.pollSeconds, orderMinutes: config.orderExpiresMinutes,
    },
    system: {
      botOnline: Boolean(client?.isReady()), botTag: client?.user?.tag ?? null, ping: client?.isReady() ? client.ws.ping : null,
      uptime: Math.round(process.uptime()), memoryMb: Math.round(mem.rss / 1048576), node: process.version,
      dbSize, backup: lastBackup(), admins: config.adminIds.length,
    },
    guildId: config.guildId,
  };
}

function settingsSave(b, actor) {
  const changed = [];
  if (b.paused !== undefined) {
    setSetting('store_paused', b.paused ? '1' : '0');
    changed.push(b.paused ? 'loja pausada' : 'loja reaberta');
    sendLog('admin', { title: b.paused ? 'Loja pausada (painel web)' : 'Loja reaberta (painel web)', description: `por <@${actor}>` });
  }
  if (b.pausedMessage !== undefined) {
    setSetting('store_paused_msg', String(b.pausedMessage).trim().slice(0, 300) || null);
    changed.push('mensagem de pausa');
  }
  if (b.terms !== undefined) {
    const t = String(b.terms).trim().slice(0, 3000);
    setSetting('terms_text', t && t !== DEFAULT_TERMS ? t : null);
    changed.push('termos');
  }
  if (changed.length) audit(actor, 'config.painel', changed.join(', '));
  return { ok: true, message: 'Configurações salvas.', settings: settingsGet() };
}

/* ------------------------------ Busca rápida ------------------------------ */

async function quickSearch(query) {
  const q = (query.get('q') || '').trim();
  if (q.length < 2) return { orders: [], products: [], customers: [] };
  const like = `%${q}%`;
  const orders = all('SELECT * FROM orders WHERE id LIKE ? OR user_id = ? OR mp_payment_id = ? ORDER BY created_at DESC LIMIT 6', `%${q.toUpperCase()}%`, q, q);
  const products = all('SELECT * FROM products WHERE name LIKE ? ORDER BY active DESC, name LIMIT 6', like);
  const nameHits = [...names.entries()].filter(([, n]) => n && n.toLowerCase().includes(q.toLowerCase())).slice(0, 6).map(([id]) => id);
  if (/^\d{3,25}$/.test(q)) nameHits.unshift(q);
  const custIds = [...new Set(nameHits)].filter((id) => one('SELECT 1 FROM orders WHERE user_id = ? LIMIT 1', id)).slice(0, 6);
  const nm = await userNames([...orders.map((o) => o.user_id), ...custIds]);
  return {
    orders: orders.map((o) => publicOrder(o, nm)),
    products: products.map((p) => ({ id: p.id, name: p.name, price: p.price_cents, active: Boolean(p.active) })),
    customers: custIds.map((id) => ({ userId: id, userName: nm[id] })),
  };
}

/* ------------------------------ Duplicar produto ------------------------------ */

async function duplicateProduct(id, actor) {
  const p = getProduct(id);
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  const copy = createProduct({
    name: `${p.name} (cópia)`.slice(0, 80), description: p.description, category: p.category, price_cents: p.price_cents,
    image_url: p.image_url, stock: p.stock, delivery_type: p.delivery_type, delivery_content: p.delivery_content,
    role_id: p.role_id, vip_days: p.vip_days, rules: p.rules,
  }, actor);
  updateProduct(copy.id, { active: 0 }, actor); // cópia nasce fora da loja, para revisar antes
  return { ok: true, message: 'Produto duplicado.', product: productOut(getProduct(copy.id), true) };
}


/* ------------------------------ Comunidade ------------------------------ */

async function communityData() {
  const ts = TRN.listTournaments(30);
  const ps = POLL.listPolls(30);
  const ids = [...ts.map((t) => t.winner_id), ...ts.map((t) => t.created_by), ...ps.map((p) => p.created_by)].filter(Boolean);
  const nm = await userNames(ids);
  return {
    guildId: config.guildId,
    media: mediaFeatures(),
    tournaments: ts.map((t) => {
      const ms = TRN.matches(t.id);
      return {
        id: t.id, name: t.name, prize: t.prize, status: t.status, maxPlayers: t.max_players, players: TRN.players(t.id).length,
        matchesDone: ms.filter((m) => m.status === 'concluida' && m.p2).length, matchesTotal: ms.filter((m) => !(m.round === 1 && !m.p2)).length,
        winnerId: t.winner_id, winnerName: nm[t.winner_id] ?? null, channelId: t.channel_id, messageId: t.message_id,
        createdAt: t.created_at, finishedAt: t.finished_at,
      };
    }),
    polls: ps.map((p) => {
      const r = POLL.results(p.id);
      return {
        id: p.id, question: p.question, options: p.options, counts: r.counts, total: r.total, winners: r.winners, status: p.status,
        endsAt: p.ends_at, hidden: p.hide_results, roleId: p.role_id, channelId: p.channel_id, messageId: p.message_id, createdAt: p.created_at,
      };
    }),
  };
}

async function communityAction(kind, id, action, actor) {
  if (kind === 'tournaments' && action === 'cancel') {
    const r = TRN.cancel(id, actor);
    if (r.error) bad(r.error);
    await refreshTournamentMessage(TRN.getTournament(id));
    sendLog('admin', { title: 'Torneio cancelado (painel web)', description: `#${id} por <@${actor}>` });
    return { ok: true, message: 'Torneio cancelado.', data: await communityData() };
  }
  if (kind === 'polls' && action === 'close') {
    if (!POLL.getPoll(id)) throw new HttpError(404, 'Votação não encontrada.');
    if (!await finishPoll(Number(id), actor)) bad('Essa votação já foi encerrada.');
    return { ok: true, message: 'Votação encerrada.', data: await communityData() };
  }
  throw new HttpError(404, 'Ação desconhecida.');
}


/* ------------------------------ Canais do servidor ------------------------------ */

async function guildOrNull() {
  const client = getClient();
  if (!client?.isReady()) return null;
  return client.guilds.fetch(config.guildId).catch(() => null);
}

async function channelsList() {
  const guild = await guildOrNull();
  if (!guild) return [];
  const chans = await guild.channels.fetch();
  const me = guild.members.me;
  return [...chans.values()].filter(Boolean)
    .filter((c) => c.type === 0 || c.type === 5 || c.type === 4) // texto, anúncios, categoria
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map((c) => ({
      id: c.id, name: c.name, type: c.type === 4 ? 'category' : 'text', parent: c.parent?.name ?? null,
      canSend: c.type === 4 ? null : Boolean(me && c.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])),
    }));
}

/* ------------------------------ Tickets: aparência e notas ------------------------------ */

async function ticketConfigGet() {
  const stats = ticketRatingStats(30);
  const nm = await userNames([...stats.recent.flatMap((r) => [r.user_id, r.staff_id]), ...stats.byStaff.map((x) => x.staff_id)].filter(Boolean));
  return {
    config: getTicketConfig(),
    defaults: DEFAULT_TICKET_CONFIG,
    published: { channelId: getSetting('ticket_panel_channel'), messageId: getSetting('ticket_panel_message') },
    ratingChannelId: getSetting('channel_ticket_reviews') || null,
    reviewsChannelId: getSetting('channel_reviews') || null,
    guildId: config.guildId,
    ratings: {
      count: stats.count, avg: stats.avg,
      byStaff: stats.byStaff.map((x) => ({ staffId: x.staff_id, staffName: nm[x.staff_id] ?? null, n: x.n, avg: x.avg })),
      recent: stats.recent.map((r) => ({
        ticketId: r.ticket_id, userId: r.user_id, userName: nm[r.user_id] ?? null, staffId: r.staff_id, staffName: nm[r.staff_id] ?? null,
        rating: r.rating, comment: r.comment, reason: reasonLabel(r.reason), createdAt: r.created_at,
      })),
    },
  };
}

async function ticketConfigSave(body, actor) {
  try {
    saveTicketConfig(body, actor);
  } catch (e) { bad(e.message); }
  if (body.ratingChannelId !== undefined) setSetting('channel_ticket_reviews', body.ratingChannelId || null);
  const refreshed = await refreshSupportPanel(getClient());
  sendLog('admin', { title: 'Painel de tickets personalizado (painel web)', description: `por <@${actor}>` });
  return { ok: true, message: refreshed ? 'Salvo! O painel publicado no Discord já foi atualizado.' : 'Configurações salvas.', data: await ticketConfigGet() };
}

async function ticketConfigPublish(body, actor) {
  if (!body.channelId) bad('Escolha o canal.');
  try {
    await publishSupportPanel(getClient(), String(body.channelId));
  } catch (e) { bad(e.message); }
  audit(actor, 'tickets.publicar', `${body.channelId} (painel web)`);
  return { ok: true, message: 'Painel publicado no Discord.', data: await ticketConfigGet() };
}

/* ------------------------------ Embeds ------------------------------ */

const embedOut = (r) => ({ id: r.id, name: r.name, data: r.data, channelId: r.channel_id, messageId: r.message_id, createdAt: r.created_at, updatedAt: r.updated_at });

async function embedValidate(body) {
  let data;
  try { data = EMB.normalizeEmbed(body.data || {}); } catch (e) { bad(e.message); }
  if (data.buttons.some((b) => b.action === 'role')) {
    const guild = await guildOrNull();
    if (!guild) bad('O bot precisa estar online para validar os cargos.');
    await guild.roles.fetch();
    for (const b of data.buttons.filter((x) => x.action === 'role')) {
      const p = EMB.roleProblem(guild, b.value);
      if (p) bad(p);
    }
  }
  return data;
}

async function embedSave(id, body, actor) {
  const prev = id ? EMB.getEmbed(id) : null;
  if (id && !prev) throw new HttpError(404, 'Embed não encontrado.');
  const data = await embedValidate(body);
  if (body.publish !== false && !(body.channelId || prev?.channel_id)) bad('Escolha o canal para publicar.');
  const rec = EMB.saveEmbed({ id, name: body.name, data }, actor);
  let message = 'Embed salvo.';
  if (body.publish !== false) {
    const target = body.channelId || rec.channel_id;
    try {
      const r = await EMB.publishEmbed(getClient(), rec, String(target));
      message = r.edited ? 'Embed atualizado no Discord.' : 'Embed publicado no Discord.';
    } catch (e) { bad(e.message); }
  }
  sendLog('admin', { title: `Embed ${prev ? 'editado' : 'criado'} (painel web)`, description: `**${rec.name}** por <@${actor}>` });
  return { ok: true, message, embed: embedOut(EMB.getEmbed(rec.id)), list: EMB.listEmbeds().map(embedOut) };
}

async function embedDelete(id, actor) {
  const rec = EMB.getEmbed(id);
  if (!rec) throw new HttpError(404, 'Embed não encontrado.');
  if (rec.channel_id && rec.message_id) {
    const ch = await getClient()?.channels.fetch(rec.channel_id).catch(() => null);
    await ch?.messages.fetch(rec.message_id).then((m) => m.delete()).catch(() => {});
  }
  EMB.deleteEmbedRecord(id, actor);
  return { ok: true, message: 'Embed apagado.', list: EMB.listEmbeds().map(embedOut) };
}

/* ------------------------------ Exportação ------------------------------ */

export function exportCsv(query) {
  const days = Math.min(Number(query.get('days')) || 30, 3650);
  const rows = all('SELECT * FROM orders WHERE created_at >= ? ORDER BY created_at', Date.now() - days * DAY);
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita fórmulas maliciosas no Excel
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmtDate = (ms) => (ms ? new Date(ms - 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 19) : '');
  const money = (c) => (c / 100).toFixed(2).replace('.', ',');
  const head = ['pedido', 'cliente_id', 'produto', 'valor', 'desconto', 'cupom', 'metodo', 'situacao', 'criado', 'pago', 'entregue', 'id_mercado_pago'];
  const lines = rows.map((o) => [o.id, o.user_id, o.product_name, money(o.total_cents), money(o.discount_cents), o.coupon_code, o.method,
    STATUS_LABEL[o.status] || o.status, fmtDate(o.created_at), fmtDate(o.paid_at), fmtDate(o.delivered_at), o.mp_payment_id].map(esc).join(';'));
  // BOM + ";" para abrir certinho no Excel em português
  return `﻿${head.join(';')}\n${lines.join('\n')}`;
}

/* ------------------------------ Roteador ------------------------------ */

/**
 * @returns {Promise<any>} objeto que vira JSON
 */
export async function routeApi(method, path, query, body, session) {
  const actor = session.id;
  const seg = path.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = seg;

  if (method === 'GET' && a === 'me') {
    return {
      id: session.id, name: session.name, avatar: session.avatar, csrf: session.csrf,
      store: { name: config.storeName, bot: config.botName },
      features: { mercadoPago: features.mercadoPago, pixManual: features.pixManual, webhook: features.webhook },
      categories: CATEGORIES, statuses: STATUS_LABEL, guildId: config.guildId,
      approvalsChannel: getSetting('channel_approvals'),
      paused: getSetting('store_paused') === '1',
    };
  }
  if (method === 'GET' && a === 'dashboard') return dashboard(query);

  if (a === 'orders') {
    if (method === 'GET' && !b) return listOrders(query);
    if (method === 'GET' && b) return orderDetail(b);
    if (method === 'POST' && b && c) return orderAction(b.toUpperCase(), c, body, actor);
  }

  if (a === 'products') {
    if (method === 'GET' && !b) return listProducts({ includeInactive: true }).map((p) => productOut(p));
    if (method === 'GET' && b) {
      const p = getProduct(b);
      if (!p) throw new HttpError(404, 'Produto não encontrado.');
      return productOut(p, true);
    }
    if (method === 'POST' && !b) return saveProduct(null, body, actor);
    if (method === 'PUT' && b) return saveProduct(Number(b), body, actor);
    if (method === 'POST' && b && c === 'duplicate') return duplicateProduct(Number(b), actor);
  }
  if (method === 'GET' && a === 'roles') return rolesList();
  if (method === 'POST' && a === 'upload') return upload(body, actor);

  if (a === 'coupons') {
    if (method === 'GET') return couponsList();
    if (method === 'POST' && !b) return couponCreate(body, actor);
    if (method === 'POST' && b && c === 'toggle') return couponToggle(b, actor);
  }
  if (method === 'GET' && a === 'vips') return vipsList();
  if (a === 'reviews') {
    if (method === 'GET') return reviewsList();
    if (method === 'POST' && b && c === 'toggle') {
      const r = run('UPDATE reviews SET hidden = 1 - hidden WHERE id = ?', Number(b));
      if (!r.changes) throw new HttpError(404, 'Avaliação não encontrada.');
      audit(actor, 'avaliacao.ocultar', `#${b} (painel web)`);
      return reviewsList();
    }
  }
  if (method === 'GET' && a === 'audit') return auditList(query);
  if (a === 'customers') {
    if (method === 'GET' && !b) return customersList(query);
    if (method === 'GET' && b) return customerDetail(b);
  }
  if (method === 'GET' && a === 'tickets') return ticketsList(query);
  if (a === 'settings') {
    if (method === 'GET') return settingsGet();
    if (method === 'PUT') return settingsSave(body, actor);
  }
  if (method === 'GET' && a === 'search') return quickSearch(query);
  if (method === 'GET' && a === 'channels') return channelsList();
  if (a === 'ticket-config') {
    if (method === 'GET' && !b) return ticketConfigGet();
    if (method === 'PUT' && !b) return ticketConfigSave(body, actor);
    if (method === 'POST' && b === 'publish') return ticketConfigPublish(body, actor);
    if (method === 'POST' && b === 'reset') {
      resetTicketConfig(actor);
      await refreshSupportPanel(getClient());
      return { ok: true, message: 'Configurações salvas.', data: await ticketConfigGet() };
    }
  }
  if (a === 'embeds') {
    if (method === 'GET' && !b) return EMB.listEmbeds().map(embedOut);
    if (method === 'POST' && !b) return embedSave(null, body, actor);
    if (method === 'PUT' && b) return embedSave(Number(b), body, actor);
    if (method === 'POST' && b && c === 'delete') return embedDelete(Number(b), actor);
  }
  if (a === 'community') {
    if (method === 'GET' && !b) return communityData();
    if (method === 'POST' && b && c && seg[3]) return communityAction(b, c, seg[3], actor);
  }

  throw new HttpError(404, 'Rota não encontrada.');
}
