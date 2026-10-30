import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} from 'discord.js';
import { config, features } from '../config.js';
import { getSetting } from '../db.js';
import { baseEmbed, bannerFile, CATEGORIES, COLORS, logoFile, STATUS_LABEL } from '../theme.js';
import { brl, clip, rel, ts } from '../util.js';
import { listProducts } from '../services/orders.js';
import { TICKET_REASONS } from '../services/tickets.js';
import { productRating, stars } from '../services/reviews.js';

const DELIVERY_LABEL = {
  cargo: 'Cargo no servidor (automático)',
  link: 'Link enviado na DM',
  arquivo: 'Arquivo/download enviado na DM',
  texto: 'Instruções enviadas na DM',
};

const stockText = (p) => (p.stock == null ? 'Disponível' : p.stock > 0 ? `${p.stock} em estoque` : 'Esgotado');
const vipText = (p) => (p.role_id ? (p.vip_days ? `${p.vip_days} dias` : 'Permanente') : null);

export const DEFAULT_TERMS = [
  '**1.** Produtos digitais são entregues automaticamente após a confirmação do pagamento.',
  '**2.** Pix automático é confirmado pelo Mercado Pago. Pix manual é conferido pela equipe no extrato — enviar comprovante não libera nada sozinho.',
  '**3.** O acesso é pessoal. Revender, compartilhar ou vazar o conteúdo leva a banimento sem reembolso.',
  '**4.** Reembolso: pode ser pedido em até 7 dias se o produto não foi entregue ou não corresponde ao anúncio. Abra um ticket.',
  '**5.** VIP temporário: o cargo é removido no vencimento (você recebe aviso antes). Renovar soma os dias.',
  '**6.** Privacidade: guardamos só seu ID do Discord e o histórico de pedidos. Não guardamos dados de cartão nem senhas.',
].join('\n');

export const termsText = () => getSetting('terms_text') || DEFAULT_TERMS;

/* ------------------------------ Vitrine ------------------------------ */

export function storePanel() {
  const e = baseEmbed(`${config.storeName.toUpperCase()} STORE`, { thumb: true })
    .setDescription(
      `Bem-vindo à loja oficial da **${config.storeName}**!\n` +
      'Escolha uma categoria abaixo, confira os detalhes e finalize com segurança.\n\n' +
      '▸ Pagamento por **Pix**\n▸ Entrega automática na sua DM\n▸ Suporte humano por ticket',
    )
    .setImage('attachment://banner.png');

  // Todas as categorias ficam no menu: a lista de produtos é lida ao vivo, sem precisar republicar o painel
  const options = Object.entries(CATEGORIES).map(([value, label]) => ({ label, value }));
  const rows = [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('store:cat').setPlaceholder('Escolha uma categoria').addOptions(options),
  )];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('store:orders').setLabel('Meus pedidos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('store:support').setLabel('Suporte').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('store:terms').setLabel('Termos').setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [e], components: rows, files: [logoFile(), bannerFile()] };
}

/** Lista produtos (por categoria ou busca) com menu para abrir cada um. */
export function productList({ category, search } = {}) {
  const items = listProducts({ category, search }).slice(0, 25);
  const title = search ? `Busca: "${clip(search, 40)}"` : CATEGORIES[category] || 'Produtos';
  const e = baseEmbed(title);
  if (!items.length) {
    e.setDescription('Nenhum produto encontrado por aqui ainda.');
    return { embeds: [e], components: [], files: [logoFile()] };
  }
  e.setDescription(items.map((p) =>
    `**${p.name}** — ${brl(p.price_cents)}\n${clip(p.description.split('\n')[0], 90) || '—'} • ${stockText(p)}`).join('\n\n').slice(0, 4000));
  const menu = new StringSelectMenuBuilder().setCustomId('store:prod').setPlaceholder('Ver detalhes de um produto')
    .addOptions(items.map((p) => ({
      label: clip(p.name, 100), value: String(p.id), description: clip(`${brl(p.price_cents)} • ${stockText(p)}`, 100),
    })));
  return { embeds: [e], components: [new ActionRowBuilder().addComponents(menu)], files: [logoFile()] };
}

export function productView(p) {
  const e = baseEmbed(p.name)
    .setDescription(p.description || 'Sem descrição.')
    .addFields(
      { name: 'Preço', value: `**${brl(p.price_cents)}**`, inline: true },
      { name: 'Disponibilidade', value: stockText(p), inline: true },
      { name: 'Categoria', value: CATEGORIES[p.category] || p.category, inline: true },
      { name: 'Entrega', value: DELIVERY_LABEL[p.delivery_type] || p.delivery_type, inline: true },
    );
  if (vipText(p)) e.addFields({ name: 'Duração do VIP', value: vipText(p), inline: true });
  const rating = productRating(p.id);
  if (rating?.n) e.addFields({ name: 'Avaliações', value: `${stars(Math.round(rating.media))} ${rating.media.toFixed(1)} (${rating.n})`, inline: true });
  if (p.rules) e.addFields({ name: 'Regras de uso', value: clip(p.rules, 1024) });
  if (p.image_url) e.setImage(p.image_url);

  const soldOut = p.stock != null && p.stock <= 0;
  return {
    embeds: [e],
    files: [logoFile()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`buy:start:${p.id}`).setLabel(soldOut ? 'Esgotado' : 'Comprar').setStyle(ButtonStyle.Primary).setDisabled(soldOut),
      new ButtonBuilder().setCustomId('tk:open:duvida').setLabel('Tirar dúvida').setStyle(ButtonStyle.Secondary),
    )],
  };
}

/** Tela de confirmação: termos + resumo + escolha do pagamento. */
export function confirmView(p, coupon = null) {
  const discount = coupon?.ok ? coupon.discount : 0;
  const e = baseEmbed('Confirme sua compra')
    .setDescription(`Leia antes de pagar:\n\n${clip(termsText(), 3000)}`)
    .addFields(
      { name: 'Produto', value: p.name, inline: true },
      { name: 'Você recebe', value: DELIVERY_LABEL[p.delivery_type] + (vipText(p) ? ` • VIP ${vipText(p)}` : ''), inline: true },
      { name: 'Total', value: discount ? `~~${brl(p.price_cents)}~~ **${brl(p.price_cents - discount)}**` : `**${brl(p.price_cents)}**`, inline: true },
    );
  if (coupon?.ok) e.addFields({ name: 'Cupom', value: `\`${coupon.code}\` aplicado (−${brl(discount)})` });
  if (coupon && !coupon.ok) e.addFields({ name: 'Cupom', value: `✖ ${coupon.reason}` });

  const code = coupon?.ok ? coupon.code : '-';
  const buttons = [];
  if (features.mercadoPago) {
    buttons.push(new ButtonBuilder().setCustomId(`buy:pay:mp:${p.id}:${code}`).setLabel('Pix automático').setStyle(ButtonStyle.Primary));
  }
  if (features.pixManual) {
    buttons.push(new ButtonBuilder().setCustomId(`buy:pay:pm:${p.id}:${code}`).setLabel('Pix manual').setStyle(ButtonStyle.Secondary));
  }
  buttons.push(new ButtonBuilder().setCustomId(`buy:coupon:${p.id}`).setLabel('Aplicar cupom').setStyle(ButtonStyle.Secondary));
  if (!features.mercadoPago && !features.pixManual) e.addFields({ name: 'Aviso', value: 'A loja ainda não configurou pagamentos.' });
  e.addFields({ name: '​', value: 'Ao escolher o pagamento você concorda com os termos acima.' });
  return { embeds: [e], files: [logoFile()], components: [new ActionRowBuilder().addComponents(buttons)] };
}

/** Tela do Pix com QR Code e copia e cola. */
export function checkoutView(order, checkout) {
  const manual = order.method === 'pix_manual';
  const e = baseEmbed(manual ? 'Pague com Pix (manual)' : 'Pague com Pix', { thumb: !checkout.png })
    .setDescription(
      (manual
        ? 'Escaneie o QR Code ou use o **copia e cola**. Depois de pagar, clique em **Já paguei** e envie o comprovante no ticket. A equipe confere no extrato e libera.'
        : 'Escaneie o QR Code ou use o **copia e cola**. A confirmação é **automática** — você recebe o produto na DM em instantes.') +
      `\n\n\`\`\`${checkout.code}\`\`\``,
    )
    .addFields(
      { name: 'Pedido', value: `\`${order.id}\``, inline: true },
      { name: 'Produto', value: order.product_name, inline: true },
      { name: 'Valor', value: `**${brl(order.total_cents)}**`, inline: true },
    );
  if (order.expires_at) e.addFields({ name: 'Expira', value: `${rel(order.expires_at)}`, inline: true });
  const files = [logoFile()];
  if (checkout.png) {
    files.push(new AttachmentBuilder(checkout.png, { name: 'pix.png' }));
    e.setImage('attachment://pix.png');
  }

  const row = new ActionRowBuilder();
  row.addComponents(new ButtonBuilder().setCustomId(`ord:copy:${order.id}`).setLabel('Copiar código').setStyle(ButtonStyle.Secondary));
  if (manual) row.addComponents(new ButtonBuilder().setCustomId(`ord:paid:${order.id}`).setLabel('Já paguei').setStyle(ButtonStyle.Primary));
  else row.addComponents(new ButtonBuilder().setCustomId(`ord:check:${order.id}`).setLabel('Verificar pagamento').setStyle(ButtonStyle.Primary));
  if (checkout.ticketUrl) row.addComponents(new ButtonBuilder().setURL(checkout.ticketUrl).setLabel('Abrir no navegador').setStyle(ButtonStyle.Link));
  row.addComponents(new ButtonBuilder().setCustomId(`ord:cancel:${order.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger));
  return { embeds: [e], files, components: [row] };
}

/* ------------------------------- Pedidos ------------------------------ */

export function orderEmbed(o, { admin = false } = {}) {
  const e = baseEmbed(`Pedido ${o.id}`, { color: o.status === 'entregue' ? COLORS.main : COLORS.muted })
    .addFields(
      { name: 'Situação', value: STATUS_LABEL[o.status] || o.status, inline: false },
      { name: 'Produto', value: o.product_name, inline: true },
      { name: 'Valor', value: brl(o.total_cents) + (o.discount_cents ? ` (−${brl(o.discount_cents)})` : ''), inline: true },
      { name: 'Pagamento', value: o.method === 'mercadopago' ? 'Pix automático' : o.method === 'pix_manual' ? 'Pix manual' : o.method, inline: true },
      { name: 'Criado', value: ts(o.created_at), inline: true },
    );
  if (o.paid_at) e.addFields({ name: 'Pago', value: ts(o.paid_at), inline: true });
  if (o.delivered_at) e.addFields({ name: 'Entregue', value: ts(o.delivered_at), inline: true });
  if (o.coupon_code) e.addFields({ name: 'Cupom', value: `\`${o.coupon_code}\``, inline: true });
  if (admin) {
    e.addFields({ name: 'Cliente', value: `<@${o.user_id}> (\`${o.user_id}\`)`, inline: false });
    if (o.mp_payment_id) e.addFields({ name: 'ID Mercado Pago', value: `\`${o.mp_payment_id}\``, inline: true });
    if (o.reviewed_by) e.addFields({ name: 'Aprovado por', value: `<@${o.reviewed_by}>`, inline: true });
    if (o.delivery_attempts) e.addFields({ name: 'Tentativas de entrega', value: String(o.delivery_attempts), inline: true });
    if (o.last_error) e.addFields({ name: 'Último erro', value: clip(o.last_error, 1024) });
    if (o.note) e.addFields({ name: 'Observação', value: clip(o.note, 1024) });
  }
  return e;
}

export function orderButtons(o, { admin = false } = {}) {
  const row = new ActionRowBuilder();
  if (o.status === 'aguardando_pagamento') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`ord:show:${o.id}`).setLabel('Ver Pix').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ord:cancel:${o.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger),
    );
  }
  if (!admin && ['entregue'].includes(o.status)) {
    row.addComponents(new ButtonBuilder().setCustomId(`ord:view:${o.id}`).setLabel('Ver entrega').setStyle(ButtonStyle.Secondary));
  }
  if (admin) {
    if (['em_analise', 'aguardando_pagamento', 'expirado', 'cancelado'].includes(o.status) && o.method !== 'mercadopago') {
      row.addComponents(new ButtonBuilder().setCustomId(`adm:approve:${o.id}`).setLabel('Aprovar pagamento').setStyle(ButtonStyle.Success));
    }
    if (['em_analise', 'aguardando_pagamento'].includes(o.status)) {
      row.addComponents(new ButtonBuilder().setCustomId(`adm:reject:${o.id}`).setLabel('Recusar').setStyle(ButtonStyle.Danger));
    }
    if (['pago', 'falha_entrega', 'entregue'].includes(o.status)) {
      row.addComponents(new ButtonBuilder().setCustomId(`adm:redeliver:${o.id}`).setLabel('Reenviar entrega').setStyle(ButtonStyle.Secondary));
    }
  }
  if (!admin) {
    row.addComponents(new ButtonBuilder().setCustomId(`tk:open:${o.status === 'entregue' ? 'duvida' : 'nao_recebido'}:${o.id}`)
      .setLabel('Suporte').setStyle(ButtonStyle.Secondary));
  }
  return row.components.length ? [row] : [];
}

export function ordersList(orders) {
  const e = baseEmbed('Meus pedidos');
  if (!orders.length) return { embeds: [e.setDescription('Você ainda não tem pedidos. Use **/loja** para comprar.')], files: [logoFile()], components: [] };
  e.setDescription(orders.map((o) =>
    `\`${o.id}\` • **${clip(o.product_name, 40)}** • ${brl(o.total_cents)}\n${STATUS_LABEL[o.status] || o.status} • ${ts(o.created_at)}`).join('\n\n'));
  const menu = new StringSelectMenuBuilder().setCustomId('ord:pick').setPlaceholder('Abrir um pedido')
    .addOptions(orders.slice(0, 25).map((o) => ({
      label: `${o.id} — ${clip(o.product_name, 60)}`, value: o.id, description: clip(STATUS_LABEL[o.status] || o.status, 100),
    })));
  return { embeds: [e], files: [logoFile()], components: [new ActionRowBuilder().addComponents(menu)] };
}

/* ------------------------------- Diversos ------------------------------ */

export function helpView(admin = false) {
  const e = baseEmbed(`Comandos da ${config.botName}`)
    .addFields({
      name: 'Para clientes',
      value: [
        '`/loja` — abrir a loja (filtre por categoria ou pesquise)',
        '`/comprar` — comprar um produto direto pelo nome',
        '`/meuspedidos` — ver seus pedidos',
        '`/pedido` — consultar um pedido seu pelo ID',
        '`/suporte` — abrir um ticket',
        '`/termos` — termos, reembolso e privacidade',
      ].join('\n'),
    }, {
      name: 'Comunidade',
      value: [
        '`/video` — vídeos gratuitos para edição (Pexels/Pixabay)',
        '`/musica` — músicas livres Creative Commons (Jamendo)',
        '`/torneio chave` — ver a chave de um torneio',
      ].join('\n'),
    });
  if (admin) {
    e.addFields({
      name: 'Para administradores',
      value: [
        '`/admin painel` • `/admin backup`',
        '`/produto adicionar|editar|remover|listar|estoque`',
        '`/gpedido consultar|aprovar|reenviar|cancelar|reembolsar|cliente`',
        '`/cupom criar|listar|desativar`',
        '`/vendas` • `/vip listar|dar|remover`',
        '`/configurar canais|painel-loja|painel-suporte|termos`',
        '`/torneio criar|iniciar|cancelar` • `/votacao criar|encerrar`',
      ].join('\n'),
    });
  }
  return { embeds: [e], files: [logoFile()] };
}

export function termsView() {
  return { embeds: [baseEmbed(`Termos da ${config.storeName}`).setDescription(termsText())], files: [logoFile()] };
}

export function supportPanel() {
  const e = baseEmbed('Central de suporte')
    .setDescription('Precisa de ajuda? Escolha o assunto abaixo e um canal privado será aberto com a equipe.\n\nTenha em mãos o **ID do pedido** (ex.: `CUT-ABCD1234`), se houver.');
  const menu = new StringSelectMenuBuilder().setCustomId('tk:reason').setPlaceholder('Sobre o que você precisa de ajuda?')
    .addOptions(Object.entries(TICKET_REASONS).filter(([k]) => k !== 'comprovante').map(([value, label]) => ({ label, value })));
  return { embeds: [e], files: [logoFile()], components: [new ActionRowBuilder().addComponents(menu)] };
}
