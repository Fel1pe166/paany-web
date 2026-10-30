// Fluxos do cliente: loja, compra, pedidos e tickets.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { config, features } from '../config.js';
import { audit, getSetting } from '../db.js';
import { baseEmbed, COLORS, logoFile, notice } from '../theme.js';
import { brl, cooldown, isAdmin, isStaff } from '../util.js';
import { deliveryComponents, deliveryEmbed } from '../services/delivery.js';
import { publishReview, saveReview } from '../services/reviews.js';
import { logError, sendLog } from '../services/logger.js';
import { cancelPayment } from '../services/mercadopago.js';
import {
  cancelOrder, createOrder, evaluateCoupon, getOrder, getProduct, markInReview, userOrders,
} from '../services/orders.js';
import { checkMpOrder, getCheckout } from '../services/payments.js';
import { closeTicket, createTicket, TICKET_REASONS } from '../services/tickets.js';
import {
  checkoutView, confirmView, helpView, orderButtons, orderEmbed, ordersList, productList, productView, supportPanel, termsView,
} from '../ui/store.js';

export const EPH = MessageFlags.Ephemeral;
const err = (text) => ({ embeds: [notice(text, 'error')], flags: EPH });
const ok = (text) => ({ embeds: [notice(text, 'ok')], flags: EPH });

/** Servidor da loja, mesmo quando o clique vem da DM (ex.: renovar VIP). */
const guildOf = async (i) => i.guild ?? i.client.guilds.fetch(config.guildId);

/** Responde de forma segura, seja a interação já respondida ou não. */
export async function respond(i, payload) {
  const p = { ...payload };
  if (i.deferred || i.replied) {
    delete p.flags;
    return i.editReply(p);
  }
  return i.reply(p);
}

/* ------------------------------- Loja ------------------------------- */

export async function showList(i, filter) {
  return respond(i, { ...productList(filter), flags: EPH });
}

export async function showProduct(i, productId) {
  const p = getProduct(productId);
  if (!p || !p.active) return respond(i, err('Produto não encontrado.'));
  return respond(i, { ...productView(p), flags: EPH });
}

/** Loja pausada pelo painel (modo manutenção): mostra o aviso e bloqueia novas compras. */
export function storePaused() {
  if (getSetting('store_paused') !== '1') return null;
  return getSetting('store_paused_msg') || 'A loja está em manutenção. Volte em instantes!';
}

export async function startPurchase(i, productId, couponCode = null) {
  const paused = storePaused();
  if (paused) return respond(i, err(paused));
  const p = getProduct(productId);
  if (!p || !p.active) return respond(i, err('Produto não disponível.'));
  if (p.stock != null && p.stock <= 0) return respond(i, err('Produto esgotado.'));
  const coupon = couponCode ? evaluateCoupon(couponCode, i.user.id, p) : null;
  const view = confirmView(p, coupon);
  if (i.isModalSubmit?.() && i.isFromMessage?.()) return i.update({ ...view }); // atualiza a tela de confirmação
  return respond(i, { ...view, flags: EPH });
}

export function couponModal(productId) {
  return new ModalBuilder().setCustomId(`modal:coupon:${productId}`).setTitle('Aplicar cupom')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('code').setLabel('Código do cupom').setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(32),
    ));
}

/** Cliente escolheu o pagamento → cria pedido e mostra o Pix. */
export async function pay(i, methodKey, productId, couponCode) {
  const paused = storePaused();
  if (paused) return respond(i, err(paused));
  const wait = cooldown(i.user.id, 'pay', 4000);
  if (wait) return respond(i, err(`Calma! Tente de novo em ${wait}s.`));
  const method = methodKey === 'mp' ? 'mercadopago' : 'pix_manual';
  if (method === 'mercadopago' && !features.mercadoPago) return respond(i, err('Pix automático indisponível.'));
  if (method === 'pix_manual' && !features.pixManual) return respond(i, err('Pix manual indisponível.'));

  await i.deferReply({ flags: EPH });
  const res = createOrder({ userId: i.user.id, productId, couponCode: couponCode && couponCode !== '-' ? couponCode : null, method });
  if (res.error) return i.editReply(err(res.error));

  try {
    const checkout = await getCheckout(res.order);
    const order = getOrder(res.order.id);
    await i.editReply(checkoutView(order, checkout));
    if (!res.reused) {
      await sendLog('vendas', {
        title: 'Novo pedido aguardando pagamento',
        description: `\`${order.id}\` • **${order.product_name}** • ${brl(order.total_cents)} • ${method === 'mercadopago' ? 'Pix automático' : 'Pix manual'} • <@${order.user_id}>`,
      });
    }
  } catch (e) {
    cancelOrder(res.order.id, { reason: `Falha ao gerar cobrança: ${e.message}` });
    await logError(`gerar Pix ${res.order.id}`, e);
    return i.editReply(err('Não consegui gerar o Pix agora. Tente novamente em instantes ou abra um ticket em /suporte.'));
  }
}

/* ------------------------------ Pedidos ----------------------------- */

/** Busca o pedido e garante que é do próprio usuário (ou da equipe). */
function ownOrder(i, orderId) {
  const o = getOrder(orderId);
  if (!o) return null;
  if (o.user_id !== i.user.id && !isAdmin(i.user.id)) return null;
  return o;
}

export async function myOrders(i) {
  return respond(i, { ...ordersList(userOrders(i.user.id)), flags: EPH });
}

export async function showOrder(i, orderId) {
  const o = ownOrder(i, orderId);
  if (!o) return respond(i, err('Pedido não encontrado. Confira o ID em /meuspedidos.'));
  return respond(i, { embeds: [orderEmbed(o)], components: orderButtons(o), files: [logoFile()], flags: EPH });
}

export async function showPix(i, orderId) {
  const o = ownOrder(i, orderId);
  if (!o) return respond(i, err('Pedido não encontrado.'));
  if (o.status !== 'aguardando_pagamento') return respond(i, err('Esse pedido não está mais aguardando pagamento.'));
  await i.deferReply({ flags: EPH });
  try {
    return i.editReply(checkoutView(o, await getCheckout(o)));
  } catch (e) {
    await logError(`mostrar Pix ${o.id}`, e);
    return i.editReply(err('Não consegui recuperar o Pix. Abra um ticket em /suporte.'));
  }
}

export async function copyCode(i, orderId) {
  const o = ownOrder(i, orderId);
  if (!o?.pix_code) return respond(i, err('Código indisponível.'));
  // Mensagem só com o código: no celular basta segurar e copiar
  return respond(i, { content: o.pix_code, flags: EPH });
}

export async function checkPayment(i, orderId) {
  const o = ownOrder(i, orderId);
  if (!o) return respond(i, err('Pedido não encontrado.'));
  if (o.status === 'entregue') return respond(i, ok('Pagamento confirmado e produto entregue! Confira sua DM.'));
  if (o.status !== 'aguardando_pagamento') return respond(i, err(`Situação do pedido: ${o.status}.`));
  const wait = cooldown(i.user.id, `check:${o.id}`, 8000);
  if (wait) return respond(i, err(`Aguarde ${wait}s para verificar de novo.`));
  await i.deferReply({ flags: EPH });
  try {
    const r = await checkMpOrder(o);
    const fresh = getOrder(o.id);
    if (fresh.status === 'entregue') return i.editReply(ok('Pagamento confirmado! O produto foi enviado na sua DM.'));
    if (fresh.status === 'falha_entrega') return i.editReply(ok('Pagamento confirmado! Houve um problema na entrega e a equipe já foi avisada — você não será cobrado de novo.'));
    if (['pending', 'in_process'].includes(r.status)) return i.editReply(err('Ainda não recebemos o pagamento. Se você já pagou, aguarde alguns segundos.'));
    return i.editReply(err(`Situação do pagamento: ${r.status}.`));
  } catch (e) {
    await logError(`verificar ${o.id}`, e);
    return i.editReply(err('Não consegui consultar agora. A verificação automática continua rodando.'));
  }
}

export async function cancelMyOrder(i, orderId) {
  const o = ownOrder(i, orderId);
  if (!o) return respond(i, err('Pedido não encontrado.'));
  if (o.status !== 'aguardando_pagamento') return respond(i, err('Só dá para cancelar pedidos aguardando pagamento.'));
  if (o.method === 'mercadopago' && o.mp_payment_id) {
    // Confere antes: se já foi pago, não cancela
    try {
      const r = await checkMpOrder(o);
      if (r.status === 'approved') return respond(i, ok('Esse pedido já foi pago e entregue!'));
      await cancelPayment(o.mp_payment_id);
    } catch { /* segue cancelando localmente */ }
  }
  cancelOrder(o.id, { actorId: i.user.id, reason: 'Cancelado pelo cliente' });
  return respond(i, ok(`Pedido \`${o.id}\` cancelado.`));
}

export async function viewDelivery(i, orderId) {
  const o = ownOrder(i, orderId);
  if (!o || o.status !== 'entregue') return respond(i, err('Entrega indisponível para esse pedido.'));
  return respond(i, { embeds: [deliveryEmbed(o, getProduct(o.product_id))], components: deliveryComponents(o), files: [logoFile()], flags: EPH });
}

/** Pix manual: cliente avisa que pagou → ticket para comprovante + fila de aprovação. */
export async function manualPaid(i, orderId) {
  const o = ownOrder(i, orderId);
  if (!o || o.method !== 'pix_manual') return respond(i, err('Pedido não encontrado.'));
  if (o.status === 'em_analise') return respond(i, ok('Seu pagamento já está em análise. Aguarde a equipe.'));
  if (o.status !== 'aguardando_pagamento') return respond(i, err('Esse pedido não está aguardando pagamento.'));
  await i.deferReply({ flags: EPH });

  try {
    const { channel } = await createTicket(await guildOf(i), i.user, { reason: 'comprovante', orderId: o.id });
    if (!markInReview(o.id, channel.id)) return i.editReply(err('Não foi possível colocar em análise.'));

    const adminRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`adm:approve:${o.id}`).setLabel('Aprovar (conferi o extrato)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`adm:reject:${o.id}`).setLabel('Recusar').setStyle(ButtonStyle.Danger),
    );
    await channel.send({
      embeds: [baseEmbed('Envie o comprovante', { thumb: false }).setDescription(
        `Pedido \`${o.id}\` • **${o.product_name}** • **${brl(o.total_cents)}**\n\n` +
        'Envie aqui a imagem ou PDF do comprovante. A equipe confere **no extrato do banco** e libera.\n' +
        '_Os botões abaixo são exclusivos da equipe._',
      ).setColor(COLORS.muted)],
      components: [adminRow],
    });
    await sendLog('aprovacoes', {
      title: `Pix manual para conferir — ${brl(o.total_cents)}`,
      description: `\`${o.id}\` • **${o.product_name}** • <@${o.user_id}>\nComprovante em <#${channel.id}>.\n\n**Só aprove depois de ver o valor no extrato.** Comprovante pode ser falso.`,
      components: [adminRow],
      color: COLORS.main,
    });
    audit(i.user.id, 'pix_manual.enviado', o.id);
    return i.editReply(ok(`Perfeito! Envie o comprovante em <#${channel.id}>. Você recebe o produto assim que a equipe confirmar.`));
  } catch (e) {
    await logError(`pix manual ${o.id}`, e);
    return i.editReply(err('Não consegui abrir o canal do comprovante. Use /suporte.'));
  }
}

/* ----------------------------- Avaliações ---------------------------- */

export function reviewModal(orderId) {
  return new ModalBuilder().setCustomId(`modal:review:${orderId}`).setTitle('Avalie sua compra').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rating').setLabel('Nota de 1 a 5')
      .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(1).setPlaceholder('5')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('comment').setLabel('Comentário (opcional)')
      .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300)),
  );
}

export async function submitReview(i, orderId) {
  const comment = i.fields.getTextInputValue('comment');
  const r = saveReview({ orderId, userId: i.user.id, rating: i.fields.getTextInputValue('rating'), comment });
  if (r.error) return respond(i, err(r.error));
  await publishReview({ order: r.order, rating: r.rating, comment, userId: i.user.id });
  // Tira o botão "Avaliar" da mensagem de entrega
  if (i.isFromMessage?.()) {
    await i.update({ components: [] }).catch(() => {});
    return i.followUp(ok('Obrigado pela avaliação!')).catch(() => {});
  }
  return respond(i, ok('Obrigado pela avaliação!'));
}

/* ------------------------------ Tickets ----------------------------- */

export function ticketModal(reason, orderId = '') {
  const m = new ModalBuilder().setCustomId(`modal:ticket:${reason}`).setTitle(TICKET_REASONS[reason]?.slice(0, 45) || 'Suporte');
  m.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('order').setLabel('ID do pedido (se tiver)').setStyle(TextInputStyle.Short)
        .setRequired(false).setMaxLength(20).setValue(orderId || ''),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('desc').setLabel('Descreva o que aconteceu').setStyle(TextInputStyle.Paragraph)
        .setRequired(true).setMinLength(5).setMaxLength(1000),
    ),
  );
  return m;
}

export async function openSupport(i) {
  return respond(i, { ...supportPanel(), flags: EPH });
}

export async function submitTicket(i, reason) {
  const wait = cooldown(i.user.id, 'ticket', 30000);
  if (wait) return respond(i, err(`Aguarde ${wait}s para abrir outro ticket.`));
  await i.deferReply({ flags: EPH });
  try {
    const { channel, existing } = await createTicket(await guildOf(i), i.user, {
      reason,
      orderId: i.fields.getTextInputValue('order')?.trim() || null,
      description: i.fields.getTextInputValue('desc'),
    });
    return i.editReply(existing
      ? err(`Você já tem um ticket aberto: <#${channel.id}>`)
      : ok(`Ticket aberto: <#${channel.id}>`));
  } catch (e) {
    await logError('abrir ticket', e);
    return i.editReply(err('Não consegui abrir o ticket. Avise um administrador.'));
  }
}

export async function ticketAction(i, action) {
  if (action === 'close') {
    const r = await closeTicket(i.channel, i.member);
    return respond(i, r.error ? err(r.error) : ok('Ticket será fechado em 5 segundos.'));
  }
  if (action === 'claim') {
    if (!isStaff(i.member)) return respond(i, err('Só a equipe pode assumir tickets.'));
    return i.reply({ embeds: [notice(`<@${i.user.id}> assumiu este atendimento.`, 'ok')] });
  }
  if (action === 'call') {
    const wait = cooldown(i.channelId, 'call-staff', 10 * 60_000);
    if (wait) return respond(i, err(`A equipe já foi chamada. Aguarde ${Math.ceil(wait / 60)} min.`));
    const role = config.staffRoleId;
    return i.reply({
      content: role ? `<@&${role}>` : 'Equipe',
      embeds: [notice(`<@${i.user.id}> está chamando a equipe.`)],
      allowedMentions: { roles: role ? [role] : [] },
    });
  }
  return null;
}

export const help = (i) => respond(i, { ...helpView(isAdmin(i.user.id)), flags: EPH });
export const terms = (i) => respond(i, { ...termsView(), flags: EPH });
