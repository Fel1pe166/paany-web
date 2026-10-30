// Distribui comandos, botões, menus e formulários para os fluxos certos.
import { MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { notice } from '../theme.js';
import { brl, clip, cooldown, isAdmin } from '../util.js';
import { listProducts } from '../services/orders.js';
import { logError } from '../services/logger.js';
import { storePanel } from '../ui/store.js';
import * as C from './client.js';
import * as A from './admin.js';
import * as K from './community.js';

const ADMIN_COMMANDS = new Set(['admin', 'produto', 'gpedido', 'cupom', 'vendas', 'vip', 'configurar']);

async function onCommand(i) {
  // Comandos só funcionam no servidor configurado
  if (!i.inGuild() || i.guildId !== config.guildId) {
    return i.reply({ embeds: [notice('Use os comandos dentro do servidor da loja.', 'error')], flags: MessageFlags.Ephemeral });
  }
  if (!ADMIN_COMMANDS.has(i.commandName)) {
    const wait = cooldown(i.user.id, 'cmd', 1500);
    if (wait) return i.reply({ embeds: [notice('Devagar! Tente de novo em instantes.', 'error')], flags: MessageFlags.Ephemeral });
  }
  const o = i.options;
  switch (i.commandName) {
    case 'loja':
      if (o.getString('categoria') || o.getString('busca')) return C.showList(i, { category: o.getString('categoria'), search: o.getString('busca') });
      return i.reply({ ...storePanel(), flags: MessageFlags.Ephemeral });
    case 'comprar': return C.startPurchase(i, o.getString('produto'), o.getString('cupom'));
    case 'meuspedidos': return C.myOrders(i);
    case 'pedido': return C.showOrder(i, o.getString('id'));
    case 'suporte': return C.openSupport(i);
    case 'ajuda': return C.help(i);
    case 'termos': return C.terms(i);
    case 'admin': return A.adminCommand(i);
    case 'produto': return A.productCommand(i);
    case 'gpedido': return A.orderAdminCommand(i);
    case 'cupom': return A.couponCommand(i);
    case 'vendas': return A.salesCommand(i);
    case 'vip': return A.vipCommand(i);
    case 'configurar': return A.configCommand(i);
    case 'torneio': return K.tournamentCommand(i);
    case 'votacao': return K.pollCommand(i);
    case 'video':
    case 'musica': return K.mediaCommand(i);
    default: return null;
  }
}

async function onAutocomplete(i) {
  if (i.commandName === 'torneio' || i.commandName === 'votacao') return i.respond(K.communityAutocomplete(i));
  const focused = String(i.options.getFocused() || '').toLowerCase();
  const admin = ADMIN_COMMANDS.has(i.commandName) && isAdmin(i.user.id);
  let items = listProducts({ includeInactive: admin });
  if (i.commandName === 'vip') items = items.filter((p) => p.role_id);
  const choices = items
    .filter((p) => !focused || p.name.toLowerCase().includes(focused) || String(p.id) === focused)
    .slice(0, 25)
    .map((p) => ({ name: clip(`${p.name} — ${brl(p.price_cents)}${p.active ? '' : ' (inativo)'}`, 100), value: String(p.id) }));
  return i.respond(choices);
}

async function onComponent(i) {
  const [scope, action, ...args] = i.customId.split(':');

  // Anti-spam geral para cliques
  const wait = cooldown(i.user.id, 'click', 800);
  if (wait && scope !== 'adm') return i.reply({ embeds: [notice('Devagar!', 'error')], flags: MessageFlags.Ephemeral });

  if (scope === 'trn') return K.tournamentButton(i, action, args);
  if (scope === 'poll') return K.pollButton(i, action, args);
  if (scope === 'med') return K.mediaButton(i, action, args);

  if (scope === 'store') {
    if (action === 'cat') return C.showList(i, { category: i.values[0] });
    if (action === 'prod') return C.showProduct(i, i.values[0]);
    if (action === 'orders') return C.myOrders(i);
    if (action === 'support') return C.openSupport(i);
    if (action === 'terms') return C.terms(i);
  }

  if (scope === 'buy') {
    if (action === 'start') return C.startPurchase(i, args[0]);
    if (action === 'coupon') return i.showModal(C.couponModal(args[0]));
    if (action === 'pay') return C.pay(i, args[0], args[1], args[2]);
  }

  if (scope === 'ord') {
    if (action === 'pick') return C.showOrder(i, i.values[0]);
    const id = args[0];
    if (action === 'show') return C.showPix(i, id);
    if (action === 'copy') return C.copyCode(i, id);
    if (action === 'check') return C.checkPayment(i, id);
    if (action === 'cancel') return C.cancelMyOrder(i, id);
    if (action === 'view') return C.viewDelivery(i, id);
    if (action === 'paid') return C.manualPaid(i, id);
  }

  if (scope === 'rev' && action === 'open') return i.showModal(C.reviewModal(args[0]));

  if (scope === 'tk') {
    if (action === 'open') {
      if (!args[0]) return C.openSupport(i);
      return i.showModal(C.ticketModal(args[0], args[1]));
    }
    if (action === 'reason') return i.showModal(C.ticketModal(i.values[0]));
    return C.ticketAction(i, action);
  }

  if (scope === 'adm') {
    if (!A.requireAdmin(i)) return null;
    if (action === 'approve') return i.showModal(A.approveModal(args[0]));
    if (action === 'reject') return i.showModal(A.rejectModal(args[0]));
    if (action === 'redeliver') return A.redeliver(i, args[0]);
  }
  return null;
}

async function onModal(i) {
  const [, kind, ...args] = i.customId.split(':');
  if (kind === 'coupon') return C.startPurchase(i, args[0], i.fields.getTextInputValue('code'));
  if (kind === 'ticket') return C.submitTicket(i, args[0]);
  if (kind === 'review') return C.submitReview(i, args[0]);
  if (kind === 'padd' || kind === 'pedit') return A.productModalSubmit(i, kind, args[0]);
  if (kind === 'approve') return A.approveManual(i, args[0], i.fields.getTextInputValue('confirm'));
  if (kind === 'reject') return A.rejectManual(i, args[0], i.fields.getTextInputValue('reason'));
  if (kind === 'terms') return A.termsModalSubmit(i);
  return null;
}

export async function handleInteraction(i) {
  try {
    if (i.isAutocomplete()) return await onAutocomplete(i);
    if (i.isChatInputCommand()) return await onCommand(i);
    if (i.isButton() || i.isStringSelectMenu()) return await onComponent(i);
    if (i.isModalSubmit()) return await onModal(i);
  } catch (e) {
    await logError(`interação ${i.commandName || i.customId || i.type} de ${i.user?.id}`, e);
    const payload = { embeds: [notice('Algo deu errado. A equipe foi avisada — tente de novo ou use /suporte.', 'error')], flags: MessageFlags.Ephemeral };
    try {
      if (i.isAutocomplete()) return;
      if (i.deferred || i.replied) await i.followUp(payload);
      else await i.reply(payload);
    } catch { /* interação expirada */ }
  }
  return null;
}
