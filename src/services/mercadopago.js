import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// Integração oficial pela API REST do Mercado Pago (Payments API).
const API = 'https://api.mercadopago.com';

async function mp(path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${config.mpAccessToken}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Mercado Pago ${res.status}: ${data.message || data.error || text.slice(0, 200)}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Data no formato aceito pelo MP, no fuso de Brasília (-03:00). */
export function mpDate(ms) {
  const d = new Date(ms - 3 * 3600 * 1000);
  return d.toISOString().replace('Z', '-03:00');
}

/** Cria uma cobrança Pix e devolve QR Code + copia e cola. */
export async function createPixPayment(order, productName) {
  const body = {
    transaction_amount: Number((order.total_cents / 100).toFixed(2)),
    description: `${config.storeName} - ${productName}`.slice(0, 250),
    payment_method_id: 'pix',
    external_reference: order.id,
    date_of_expiration: mpDate(order.expires_at),
    payer: { email: config.payerEmail },
    metadata: { order_id: order.id, discord_user_id: order.user_id },
  };
  if (config.publicUrl && config.mpWebhookSecret) {
    body.notification_url = `${config.publicUrl}/webhook/mercadopago`;
  }
  const p = await mp('/v1/payments', { method: 'POST', body, idempotencyKey: `create-${order.id}` });
  const tdata = p.point_of_interaction?.transaction_data || {};
  return {
    id: String(p.id),
    status: p.status,
    qrCode: tdata.qr_code,
    qrBase64: tdata.qr_code_base64,
    ticketUrl: tdata.ticket_url,
  };
}

export const getPayment = (id) => mp(`/v1/payments/${encodeURIComponent(id)}`);

export const refundPayment = (id, orderId) =>
  mp(`/v1/payments/${encodeURIComponent(id)}/refunds`, { method: 'POST', body: {}, idempotencyKey: `refund-${orderId}` });

export const cancelPayment = (id) =>
  mp(`/v1/payments/${encodeURIComponent(id)}`, { method: 'PUT', body: { status: 'cancelled' } });

/**
 * Valida o pagamento retornado pela API contra o pedido.
 * Só retorna ok=true se TUDO bater: aprovado, BRL, mesmo pedido e mesmo valor.
 */
export function validateApproved(payment, order) {
  const problems = [];
  if (payment.status !== 'approved') problems.push(`status=${payment.status}`);
  if (payment.currency_id && payment.currency_id !== 'BRL') problems.push(`moeda=${payment.currency_id}`);
  if (payment.external_reference !== order.id) problems.push('referência diferente');
  if (Math.round(Number(payment.transaction_amount) * 100) !== order.total_cents) problems.push('valor diferente');
  if (order.mp_payment_id && String(payment.id) !== String(order.mp_payment_id)) problems.push('id diferente');
  return { ok: problems.length === 0, problems };
}

/**
 * Verifica a assinatura x-signature do webhook do Mercado Pago.
 * manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};"
 */
export function verifyWebhookSignature({ signature, requestId, dataId, secret = config.mpWebhookSecret }) {
  if (!signature || !secret) return false;
  const parts = Object.fromEntries(
    signature.split(',').map((kv) => kv.split('=').map((s) => s.trim())).filter((a) => a.length === 2),
  );
  const tsv = parts.ts;
  const v1 = parts.v1;
  if (!tsv || !v1) return false;

  let manifest = '';
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${tsv};`;

  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
