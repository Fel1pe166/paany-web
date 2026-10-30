// Ações administrativas usadas tanto pelo Discord quanto pelo painel web.
// Quem chama é responsável por checar isAdmin(actorId) antes.
import { config } from '../config.js';
import { audit, run } from '../db.js';
import { baseEmbed, COLORS, logoFile } from '../theme.js';
import { brl } from '../util.js';
import { deliverOrder, deliveryEmbed } from './delivery.js';
import { getClient, logError, sendLog } from './logger.js';
import { refundPayment } from './mercadopago.js';
import { cancelOrder, getOrder, getProduct, markRefund } from './orders.js';
import { onPaid } from './payments.js';

const res = (ok, message) => ({ ok, message });
const by = (actorId, via) => `<@${actorId}>${via === 'web' ? ' (painel web)' : ''}`;

async function dm(userId, embed) {
  const user = await getClient()?.users.fetch(userId).catch(() => null);
  return user?.send({ embeds: [embed], files: [logoFile()] }).then(() => true).catch(() => false) ?? false;
}

/** Aprovação humana de Pix manual. typedId precisa ser igual ao ID (evita clique acidental). */
export async function approveManualOrder(orderId, actorId, typedId, via = 'discord') {
  const o = getOrder(orderId);
  if (!o) return res(false, 'Pedido não encontrado.');
  if (o.method === 'mercadopago') return res(false, 'Pedidos do Mercado Pago são confirmados só pela API do Mercado Pago.');
  if (String(typedId || '').trim().toUpperCase() !== o.id) return res(false, 'O ID digitado não confere. Nada foi aprovado.');

  const r = await onPaid(o.id, { provider: 'pix_manual', providerId: o.id, amountCents: o.total_cents, actorId });
  if (!r.changed) return res(false, r.reason || 'Nada foi alterado.');
  await sendLog('admin', { title: 'Pix manual aprovado', description: `\`${o.id}\` • ${brl(o.total_cents)} • aprovado por ${by(actorId, via)}`, color: COLORS.main });
  if (r.delivery?.ok) {
    return res(true, `Pagamento aprovado e produto entregue${r.delivery.dmOk ? '' : ' (DM do cliente fechada — ele vê em /meuspedidos)'}.`);
  }
  return res(false, `Pagamento aprovado, mas a entrega falhou: ${r.delivery?.reason}. Use "Reenviar entrega".`);
}

export async function rejectManualOrder(orderId, actorId, reason, via = 'discord') {
  const o = getOrder(orderId);
  if (!o) return res(false, 'Pedido não encontrado.');
  if (!reason?.trim()) return res(false, 'Informe o motivo.');
  if (!cancelOrder(o.id, { actorId, reason: `Recusado: ${reason}` })) return res(false, 'Esse pedido não está em aberto.');
  await dm(o.user_id, baseEmbed('Pagamento não confirmado').setDescription(
    `Seu pedido \`${o.id}\` (${o.product_name}) foi recusado pela equipe.\n**Motivo:** ${reason}\n\nSe acha que é um engano, abra um ticket em **/suporte**.`));
  await sendLog('admin', { title: 'Pix manual recusado', description: `\`${o.id}\` por ${by(actorId, via)} — ${reason}` });
  return res(true, 'Pedido recusado e cliente avisado.');
}

export async function redeliverOrder(orderId, actorId) {
  const o = getOrder(orderId);
  if (!o) return res(false, 'Pedido não encontrado.');
  if (o.status === 'entregue') {
    // Só reenvia a mensagem (não entrega de novo nem baixa estoque)
    const sent = await dm(o.user_id, deliveryEmbed(o, getProduct(o.product_id)));
    audit(actorId, 'pedido.reenviar_dm', o.id);
    return sent ? res(true, 'Mensagem de entrega reenviada na DM do cliente.') : res(false, 'A DM do cliente está fechada. Ele pode ver em /meuspedidos.');
  }
  if (!['pago', 'falha_entrega'].includes(o.status)) return res(false, `Pedido está "${o.status}", não dá para entregar.`);
  audit(actorId, 'pedido.reentregar', o.id);
  const r = await deliverOrder(o.id, { actorId });
  return r.ok ? res(true, 'Entregue com sucesso.') : res(false, `Falhou de novo: ${r.reason}`);
}

export async function cancelOrderAdmin(orderId, actorId, reason, via = 'discord') {
  const motivo = reason?.trim() || 'Cancelado pela equipe';
  if (!cancelOrder(orderId, { actorId, reason: motivo })) return res(false, 'Pedido não encontrado ou não está em aberto.');
  await sendLog('admin', { title: 'Pedido cancelado', description: `\`${orderId}\` por ${by(actorId, via)} — ${motivo}` });
  return res(true, `Pedido ${orderId} cancelado.`);
}

export async function refundOrder(orderId, actorId, { removeRole = true, reason = '', via = 'discord' } = {}) {
  const o = getOrder(orderId);
  if (!o) return res(false, 'Pedido não encontrado.');
  if (!['pago', 'processando', 'entregue', 'falha_entrega', 'reembolso_solicitado'].includes(o.status)) {
    return res(false, `Pedido está "${o.status}" e não pode ser reembolsado.`);
  }
  let how;
  if (o.method === 'mercadopago' && o.mp_payment_id) {
    try {
      await refundPayment(o.mp_payment_id, o.id);
      how = 'Estorno feito automaticamente pelo Mercado Pago.';
    } catch (e) {
      await logError(`reembolso ${o.id}`, e);
      return res(false, `O Mercado Pago recusou o estorno: ${e.message}`);
    }
  } else {
    how = 'Pix manual: devolva o valor pelo app do seu banco (o bot não movimenta sua conta).';
  }
  markRefund(o.id, 'reembolsado', actorId, reason);

  if (removeRole) {
    const product = getProduct(o.product_id);
    if (product?.role_id) {
      const guild = await getClient()?.guilds.fetch(config.guildId).catch(() => null);
      const member = await guild?.members.fetch(o.user_id).catch(() => null);
      await member?.roles.remove(product.role_id, `Reembolso ${o.id}`).catch(() => {});
      run('UPDATE vips SET active = 0, updated_at = ? WHERE user_id = ? AND role_id = ? AND active = 1', Date.now(), o.user_id, product.role_id);
    }
  }
  await dm(o.user_id, baseEmbed('Reembolso realizado').setDescription(
    `Seu pedido \`${o.id}\` (${o.product_name}) foi reembolsado: **${brl(o.total_cents)}**.${reason ? `\nMotivo: ${reason}` : ''}`));
  await sendLog('admin', { title: 'Reembolso', description: `\`${o.id}\` • ${brl(o.total_cents)} • por ${by(actorId, via)}\n${how}${reason ? `\nMotivo: ${reason}` : ''}` });
  return res(true, `Pedido reembolsado. ${how}`);
}
