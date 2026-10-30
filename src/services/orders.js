// Regras de negócio: produtos, cupons, pedidos e pagamentos.
// Não depende do Discord, então dá para testar isolado (veja tests/).
import { all, audit, one, run, tx } from '../db.js';
import { config } from '../config.js';
import { newOrderId } from '../util.js';

export const OPEN_STATUSES = ['aguardando_pagamento', 'em_analise'];
export const PAID_STATUSES = ['pago', 'processando', 'entregue', 'falha_entrega', 'reembolso_solicitado'];

/* ------------------------------ Produtos ------------------------------ */

export function listProducts({ category, search, includeInactive = false } = {}) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('active = 1');
  if (category) { where.push('category = ?'); params.push(category); }
  if (search) { where.push('(name LIKE ? OR description LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  return all(`SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY category, price_cents, name`, ...params);
}

export const getProduct = (id) => one('SELECT * FROM products WHERE id = ?', Number(id));

export function createProduct(p, actorId) {
  const t = Date.now();
  const r = run(
    `INSERT INTO products(name, description, category, price_cents, image_url, stock, delivery_type, delivery_content,
      role_id, vip_days, rules, active, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    p.name, p.description || '', p.category, p.price_cents, p.image_url || null, p.stock ?? null, p.delivery_type,
    p.delivery_content || null, p.role_id || null, p.vip_days || null, p.rules || '', t, t,
  );
  const id = Number(r.lastInsertRowid);
  audit(actorId, 'produto.criar', `#${id} ${p.name}`);
  return getProduct(id);
}

const EDITABLE = ['name', 'description', 'category', 'price_cents', 'image_url', 'stock', 'delivery_type',
  'delivery_content', 'role_id', 'vip_days', 'rules', 'active'];

export function updateProduct(id, changes, actorId) {
  const keys = Object.keys(changes).filter((k) => EDITABLE.includes(k) && changes[k] !== undefined);
  if (!keys.length) return getProduct(id);
  run(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...keys.map((k) => changes[k]), Date.now(), Number(id));
  // Nunca registra o conteúdo privado no log
  audit(actorId, 'produto.editar', `#${id} campos: ${keys.join(', ')}`);
  return getProduct(id);
}

/* ------------------------------- Cupons ------------------------------- */

export const normalizeCode = (c) => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);

export function createCoupon(c, actorId) {
  const code = normalizeCode(c.code);
  if (!code) throw new Error('Código inválido.');
  if (one('SELECT 1 FROM coupons WHERE code = ?', code)) throw new Error('Já existe um cupom com esse código.');
  if (c.type === 'percent' && (c.value < 1 || c.value > 100)) throw new Error('Porcentagem deve ser entre 1 e 100.');
  if (c.value <= 0) throw new Error('Valor do desconto deve ser maior que zero.');
  run(`INSERT INTO coupons(code, type, value, max_uses, starts_at, expires_at, min_cents, product_id, one_per_user, created_by, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  code, c.type, c.value, c.max_uses ?? null, c.starts_at ?? null, c.expires_at ?? null, c.min_cents ?? 0,
  c.product_id ?? null, c.one_per_user === false ? 0 : 1, actorId, Date.now());
  audit(actorId, 'cupom.criar', `${code} ${c.type}=${c.value}`);
  return one('SELECT * FROM coupons WHERE code = ?', code);
}

/** Calcula o desconto de um cupom para um usuário/produto. */
export function evaluateCoupon(rawCode, userId, product) {
  const code = normalizeCode(rawCode);
  const c = one('SELECT * FROM coupons WHERE code = ?', code);
  const t = Date.now();
  if (!c || !c.active) return { ok: false, reason: 'Cupom inválido.' };
  if (c.starts_at && t < c.starts_at) return { ok: false, reason: 'Esse cupom ainda não começou a valer.' };
  if (c.expires_at && t > c.expires_at) return { ok: false, reason: 'Esse cupom expirou.' };
  if (c.product_id && c.product_id !== product.id) return { ok: false, reason: 'Esse cupom não vale para este produto.' };
  if (product.price_cents < c.min_cents) return { ok: false, reason: 'O valor mínimo do cupom não foi atingido.' };

  // Usos confirmados + pedidos em aberto com o cupom (evita usar o mesmo cupom em vários pedidos ao mesmo tempo)
  const pendingWithCoupon = one(
    `SELECT COUNT(*) n FROM orders WHERE coupon_code = ? AND status IN ('aguardando_pagamento','em_analise') AND (expires_at IS NULL OR expires_at > ?)`,
    code, t,
  ).n;
  if (c.max_uses != null && c.uses + pendingWithCoupon >= c.max_uses) return { ok: false, reason: 'Esse cupom esgotou.' };
  if (c.one_per_user) {
    const used = one('SELECT 1 FROM coupon_uses WHERE code = ? AND user_id = ?', code, userId);
    const pending = one(
      `SELECT 1 FROM orders WHERE coupon_code = ? AND user_id = ? AND status IN ('aguardando_pagamento','em_analise') AND (expires_at IS NULL OR expires_at > ?)`,
      code, userId, t,
    );
    if (used || pending) return { ok: false, reason: 'Você já usou esse cupom.' };
  }

  let discount = c.type === 'percent' ? Math.floor((product.price_cents * c.value) / 100) : c.value;
  // Valor mínimo cobrado: R$ 1,00 (o Pix não aceita cobrança zerada)
  discount = Math.min(discount, product.price_cents - 100);
  if (discount <= 0) return { ok: false, reason: 'Esse cupom não gera desconto neste produto.' };
  return { ok: true, code, discount, coupon: c };
}

/* ------------------------------- Pedidos ------------------------------ */

export const getOrder = (id) => one('SELECT * FROM orders WHERE id = ?', String(id).trim().toUpperCase());
export const getOrderByMpId = (mpId) => one('SELECT * FROM orders WHERE mp_payment_id = ?', String(mpId));
export const userOrders = (userId, limit = 15) =>
  all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit);

/**
 * Cria (ou reaproveita) um pedido. Faz todas as checagens antes de gerar cobrança.
 * @returns {{ order?: object, reused?: boolean, error?: string }}
 */
export function createOrder({ userId, productId, couponCode, method }) {
  return tx(() => {
    const product = getProduct(productId);
    if (!product || !product.active) return { error: 'Esse produto não está disponível.' };
    if (product.stock != null && product.stock <= 0) return { error: 'Produto esgotado no momento.' };
    const t = Date.now();

    // Reaproveita pedido igual ainda em aberto (evita pedidos duplicados por clique repetido)
    const existing = one(
      `SELECT * FROM orders WHERE user_id = ? AND product_id = ? AND method = ? AND status = 'aguardando_pagamento'
         AND expires_at > ? AND COALESCE(coupon_code,'') = ? ORDER BY created_at DESC LIMIT 1`,
      userId, product.id, method, t + 60_000, normalizeCode(couponCode),
    );
    if (existing) return { order: existing, reused: true };

    const pending = one(
      `SELECT COUNT(*) n FROM orders WHERE user_id = ? AND status IN ('aguardando_pagamento','em_analise') AND (expires_at IS NULL OR expires_at > ?)`,
      userId, t,
    ).n;
    if (pending >= config.maxPendingOrders) {
      return { error: `Você já tem ${pending} pedidos em aberto. Pague ou cancele um deles em /meuspedidos.` };
    }
    const recent = one('SELECT COUNT(*) n FROM orders WHERE user_id = ? AND created_at > ?', userId, t - 10 * 60_000).n;
    if (recent >= 6) return { error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.' };

    let discount = 0;
    let code = null;
    if (couponCode) {
      const ev = evaluateCoupon(couponCode, userId, product);
      if (!ev.ok) return { error: ev.reason };
      discount = ev.discount;
      code = ev.code;
    }

    const id = newOrderId();
    const total = product.price_cents - discount;
    run(
      `INSERT INTO orders(id, user_id, product_id, product_name, unit_price_cents, discount_cents, total_cents, coupon_code,
         method, status, expires_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,'aguardando_pagamento',?,?,?)`,
      id, userId, product.id, product.name, product.price_cents, discount, total, code, method,
      t + config.orderExpiresMinutes * 60_000, t, t,
    );
    audit(userId, 'pedido.criar', `${id} ${product.name} ${total}c ${method}${code ? ` cupom=${code}` : ''}`);
    return { order: getOrder(id), reused: false };
  });
}

export function attachMpPayment(orderId, mpId) {
  run('UPDATE orders SET mp_payment_id = ?, updated_at = ? WHERE id = ?', String(mpId), Date.now(), orderId);
}
export function setPixCode(orderId, code) {
  run('UPDATE orders SET pix_code = ?, updated_at = ? WHERE id = ?', code, Date.now(), orderId);
}

/** Cliente avisou que pagou via Pix manual → vai para análise humana (nunca é aprovação automática). */
export function markInReview(orderId, ticketChannelId) {
  const r = run(
    `UPDATE orders SET status = 'em_analise', ticket_channel_id = COALESCE(?, ticket_channel_id), expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'aguardando_pagamento' AND method = 'pix_manual'`,
    ticketChannelId ?? null, Date.now(), orderId,
  );
  return r.changes === 1;
}

/**
 * Confirma o pagamento de forma idempotente.
 * Retorna changed=false se o pedido já estava pago (webhook repetido, clique duplo etc.).
 */
export function confirmPayment(orderId, { provider, providerId, amountCents, actorId = null }) {
  return tx(() => {
    const order = getOrder(orderId);
    if (!order) return { changed: false, reason: 'Pedido não encontrado.' };
    if (PAID_STATUSES.includes(order.status) || order.status === 'reembolsado') {
      return { changed: false, order, reason: 'Pedido já confirmado anteriormente.' };
    }
    if (amountCents !== order.total_cents) {
      audit(actorId, 'pagamento.valor_divergente', `${orderId} esperado=${order.total_cents} recebido=${amountCents}`);
      return { changed: false, order, reason: 'Valor pago diferente do valor do pedido.' };
    }
    const ev = run(
      `INSERT OR IGNORE INTO payment_events(order_id, provider, provider_id, status, amount_cents, actor_id, created_at)
       VALUES(?,?,?,?,?,?,?)`,
      orderId, provider, String(providerId), 'approved', amountCents, actorId, Date.now(),
    );
    if (ev.changes === 0) return { changed: false, order, reason: 'Evento já processado.' };

    // Aceita confirmação mesmo de pedido expirado/cancelado: o dinheiro entrou, o cliente precisa receber.
    run(`UPDATE orders SET status = 'pago', paid_at = ?, reviewed_by = COALESCE(?, reviewed_by), updated_at = ? WHERE id = ?`,
      Date.now(), actorId, Date.now(), orderId);

    if (order.coupon_code) {
      const ins = run('INSERT OR IGNORE INTO coupon_uses(code, user_id, order_id, created_at) VALUES(?,?,?,?)',
        order.coupon_code, order.user_id, orderId, Date.now());
      if (ins.changes) run('UPDATE coupons SET uses = uses + 1 WHERE code = ?', order.coupon_code);
    }
    audit(actorId ?? order.user_id, 'pagamento.confirmado', `${orderId} via ${provider} (${providerId})`);
    return { changed: true, order: getOrder(orderId) };
  });
}

export function cancelOrder(orderId, { actorId = null, reason = '', status = 'cancelado' } = {}) {
  const r = run(
    `UPDATE orders SET status = ?, note = ?, updated_at = ? WHERE id = ? AND status IN ('aguardando_pagamento','em_analise')`,
    status, reason || null, Date.now(), orderId,
  );
  if (r.changes) audit(actorId, `pedido.${status}`, `${orderId} ${reason}`);
  return r.changes === 1;
}

/** Pedidos aguardando pagamento cujo prazo acabou. */
export const dueForExpiry = () =>
  all(`SELECT * FROM orders WHERE status = 'aguardando_pagamento' AND expires_at IS NOT NULL AND expires_at <= ?`, Date.now());

/** Pix do Mercado Pago a conferir: em aberto + expirados nas últimas 2h (pagamento que chegou no limite do prazo). */
export const pendingMpOrders = () =>
  all(`SELECT * FROM orders WHERE method = 'mercadopago' AND mp_payment_id IS NOT NULL
       AND (status = 'aguardando_pagamento' OR (status = 'expirado' AND updated_at > ?))`, Date.now() - 2 * 3600_000);

/* ------------------------------- Entrega ------------------------------ */

/** Reserva a entrega: só um processo consegue (impede entrega duplicada). */
export function claimDelivery(orderId) {
  const r = run(
    `UPDATE orders SET status = 'processando', delivery_attempts = delivery_attempts + 1, updated_at = ?
     WHERE id = ? AND status IN ('pago','falha_entrega')`,
    Date.now(), orderId,
  );
  return r.changes === 1 ? getOrder(orderId) : null;
}

/** Baixa o estoque uma única vez por pedido. */
export function takeStock(order) {
  return tx(() => {
    const o = getOrder(order.id);
    if (o.stock_taken) return true;
    const r = run('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock IS NOT NULL AND stock > 0', o.product_id);
    const p = getProduct(o.product_id);
    if (r.changes === 0 && p.stock != null) return false; // esgotou entre o pedido e o pagamento
    run('UPDATE orders SET stock_taken = 1 WHERE id = ?', o.id);
    return true;
  });
}

export function finishDelivery(orderId, ok, error = null) {
  run(`UPDATE orders SET status = ?, delivered_at = CASE WHEN ? THEN ? ELSE delivered_at END, last_error = ?, updated_at = ? WHERE id = ?`,
    ok ? 'entregue' : 'falha_entrega', ok ? 1 : 0, Date.now(), error, Date.now(), orderId);
}

export function markRefund(orderId, status, actorId, note = '') {
  const r = run(
    `UPDATE orders SET status = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ? AND status IN ('pago','processando','entregue','falha_entrega','reembolso_solicitado')`,
    status, note || null, Date.now(), orderId,
  );
  if (r.changes) audit(actorId, `pedido.${status}`, `${orderId} ${note}`);
  return r.changes === 1;
}

/* ----------------------------- Relatórios ----------------------------- */

export function salesStats(sinceMs = 0) {
  const s = one(
    `SELECT COUNT(*) vendas, COALESCE(SUM(total_cents),0) bruto, COALESCE(SUM(discount_cents),0) descontos
     FROM orders WHERE status IN ('pago','processando','entregue','falha_entrega','reembolso_solicitado') AND paid_at >= ?`,
    sinceMs,
  );
  const refunds = one(
    `SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) total FROM orders WHERE status = 'reembolsado' AND paid_at >= ?`, sinceMs,
  );
  const top = all(
    `SELECT product_name name, COUNT(*) qtd, SUM(total_cents) total FROM orders
     WHERE status IN ('pago','processando','entregue','falha_entrega','reembolso_solicitado') AND paid_at >= ?
     GROUP BY product_id ORDER BY qtd DESC, total DESC LIMIT 5`,
    sinceMs,
  );
  const pending = one(`SELECT COUNT(*) n FROM orders WHERE status IN ('aguardando_pagamento','em_analise')`).n;
  const review = one(`SELECT COUNT(*) n FROM orders WHERE status = 'em_analise'`).n;
  const failures = one(`SELECT COUNT(*) n FROM orders WHERE status = 'falha_entrega'`).n;
  return { ...s, refunds, top, pending, review, failures };
}
