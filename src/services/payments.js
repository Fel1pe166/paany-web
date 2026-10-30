import { config, features } from '../config.js';
import { audit } from '../db.js';
import { COLORS } from '../theme.js';
import { deliverOrder } from './delivery.js';
import { logError, sendLog } from './logger.js';
import { createPixPayment, getPayment, validateApproved } from './mercadopago.js';
import {
  attachMpPayment, cancelOrder, confirmPayment, dueForExpiry, getOrder, getProduct, markRefund, pendingMpOrders, setPixCode,
} from './orders.js';
import { buildPixCode } from './pix.js';

let QRCode = null;
try { QRCode = (await import('qrcode')).default; } catch { /* sem a lib: envia só o copia e cola */ }

/**
 * Gera (ou recupera) a cobrança Pix do pedido.
 * @returns {Promise<{ code: string, png: Buffer|null, ticketUrl?: string }>}
 */
export async function getCheckout(order) {
  const product = getProduct(order.product_id);

  if (order.method === 'mercadopago') {
    if (!features.mercadoPago) throw new Error('Mercado Pago não configurado.');
    if (!order.mp_payment_id) {
      const pay = await createPixPayment(order, product?.name || order.product_name);
      attachMpPayment(order.id, pay.id);
      setPixCode(order.id, pay.qrCode);
      return { code: pay.qrCode, png: pay.qrBase64 ? Buffer.from(pay.qrBase64, 'base64') : null, ticketUrl: pay.ticketUrl };
    }
    const p = await getPayment(order.mp_payment_id);
    const td = p.point_of_interaction?.transaction_data || {};
    return { code: td.qr_code || order.pix_code, png: td.qr_code_base64 ? Buffer.from(td.qr_code_base64, 'base64') : null, ticketUrl: td.ticket_url };
  }

  if (order.method === 'pix_manual') {
    if (!features.pixManual) throw new Error('Pix manual não configurado.');
    const code = order.pix_code || buildPixCode({
      key: config.pixKey, name: config.pixName, city: config.pixCity, amountCents: order.total_cents, txid: order.id,
    });
    if (!order.pix_code) setPixCode(order.id, code);
    const png = QRCode ? await QRCode.toBuffer(code, { margin: 2, width: 360, color: { dark: '#000000', light: '#FFFFFF' } }) : null;
    return { code, png };
  }

  throw new Error(`Método desconhecido: ${order.method}`);
}

/** Pagamento confirmado → registra e entrega. */
export async function onPaid(orderId, { provider, providerId, amountCents, actorId = null }) {
  const res = confirmPayment(orderId, { provider, providerId, amountCents, actorId });
  if (!res.changed) {
    // Pode ser repetição; se ficou "pago" sem entrega (queda do bot), tenta entregar
    if (res.order?.status === 'pago') await deliverOrder(orderId, { actorId });
    return res;
  }
  const delivery = await deliverOrder(orderId, { actorId });
  return { ...res, delivery };
}

/**
 * Consulta o Mercado Pago e age conforme o status real do pagamento.
 * Nunca confia em dados vindos do cliente ou do corpo do webhook.
 */
export async function checkMpOrder(orderOrId) {
  const order = typeof orderOrId === 'string' ? getOrder(orderOrId) : orderOrId;
  if (!order?.mp_payment_id) return { status: 'sem_pagamento' };
  const p = await getPayment(order.mp_payment_id);

  if (p.status === 'approved') {
    const v = validateApproved(p, order);
    if (!v.ok) {
      audit(null, 'pagamento.invalido', `${order.id}: ${v.problems.join(', ')}`);
      await sendLog('erros', {
        title: `Pagamento suspeito — ${order.id}`,
        description: `O Mercado Pago retornou aprovado, mas não bateu com o pedido: ${v.problems.join(', ')}. Nada foi entregue.`,
        color: COLORS.dark,
      });
      return { status: 'invalido' };
    }
    const r = await onPaid(order.id, {
      provider: 'mercadopago', providerId: p.id, amountCents: Math.round(Number(p.transaction_amount) * 100),
    });
    return { status: 'approved', ...r };
  }

  if (['cancelled', 'rejected'].includes(p.status)) {
    cancelOrder(order.id, { reason: `Mercado Pago: ${p.status}`, status: p.status === 'cancelled' ? 'expirado' : 'cancelado' });
    return { status: p.status };
  }
  if (['refunded', 'charged_back'].includes(p.status)) {
    markRefund(order.id, 'reembolsado', null, `Mercado Pago: ${p.status}`);
    return { status: p.status };
  }
  return { status: p.status }; // pending / in_process
}

let polling = false;
/** Roda periodicamente: confere Pix pendentes (funciona sem webhook, ideal p/ hospedagem grátis). */
export async function pollPayments() {
  if (polling) return;
  polling = true;
  try {
    if (features.mercadoPago) {
      for (const o of pendingMpOrders()) {
        try { await checkMpOrder(o); } catch (e) { if (e.status !== 404) console.warn(`[poll] ${o.id}: ${e.message}`); }
      }
    }
    // Expira pedidos vencidos (com uma última checagem no MP antes)
    for (const o of dueForExpiry()) {
      try {
        if (o.method === 'mercadopago' && o.mp_payment_id) {
          await checkMpOrder(o);
          if (getOrder(o.id).status !== 'aguardando_pagamento') continue; // já foi pago/cancelado pelo MP
        }
        cancelOrder(o.id, { reason: 'Prazo de pagamento esgotado', status: 'expirado' });
      } catch (e) {
        console.warn(`[expirar] ${o.id}: ${e.message}`);
      }
    }
  } catch (e) {
    await logError('verificação de pagamentos', e);
  } finally {
    polling = false;
  }
}

export function startPaymentLoop() {
  const ms = Math.max(10, config.pollSeconds) * 1000;
  setInterval(pollPayments, ms).unref?.();
  setTimeout(pollPayments, 5000);
}
