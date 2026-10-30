import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config.js';
import { one, run } from '../db.js';
import { baseEmbed, COLORS, logoFile } from '../theme.js';
import { brl, ts } from '../util.js';
import { claimDelivery, finishDelivery, getOrder, getProduct, takeStock } from './orders.js';
import { getClient, logError, sendLog } from './logger.js';

/** Monta o embed com o conteúdo do produto (só para quem pagou). */
export function deliveryEmbed(order, product) {
  const e = baseEmbed('Seu pedido foi entregue')
    .setDescription(`Obrigado por comprar na **${config.storeName}**! Guarde esta mensagem.`)
    .addFields(
      { name: 'Pedido', value: `\`${order.id}\``, inline: true },
      { name: 'Produto', value: order.product_name, inline: true },
      { name: 'Valor', value: brl(order.total_cents), inline: true },
      { name: 'Data da compra', value: ts(order.paid_at || order.created_at), inline: false },
    );
  if (product?.role_id) {
    let txt = `Cargo <@&${product.role_id}> liberado.`;
    const vip = one('SELECT * FROM vips WHERE user_id = ? AND role_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', order.user_id, product.role_id);
    if (vip) txt += vip.expires_at ? ` Válido até ${ts(vip.expires_at)}.` : ' Acesso permanente.';
    e.addFields({ name: 'VIP', value: txt });
  }
  if (product?.delivery_content) {
    const label = { link: 'Link de acesso', arquivo: 'Download', texto: 'Instruções', cargo: 'Informações' }[product.delivery_type] || 'Entrega';
    e.addFields({ name: label, value: product.delivery_content.slice(0, 1024) });
  }
  if (product?.rules) e.addFields({ name: 'Regras de uso', value: product.rules.slice(0, 1024) });
  e.addFields({ name: 'Precisa de ajuda?', value: 'Use **/suporte** e informe o ID do pedido.' });
  return e;
}

/** Concede o cargo e registra/estende o VIP. */
async function grantRole(guild, order, product) {
  const member = await guild.members.fetch(order.user_id).catch(() => null);
  if (!member) throw new Error('Comprador não está mais no servidor.');
  await member.roles.add(product.role_id, `Compra ${order.id}`);

  const t = Date.now();
  const days = Number(product.vip_days) || 0;
  const current = one('SELECT * FROM vips WHERE user_id = ? AND role_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', order.user_id, product.role_id);
  if (one('SELECT 1 FROM vips WHERE order_id = ?', order.id)) return; // já registrado (reenvio)

  if (current && current.expires_at && days > 0) {
    // Renovação: soma os dias ao vencimento atual
    const base = Math.max(current.expires_at, t);
    run('UPDATE vips SET expires_at = ?, warned = 0, order_id = ?, updated_at = ? WHERE id = ?', base + days * 86400000, order.id, t, current.id);
  } else if (current && !current.expires_at) {
    // Já é permanente, não muda nada
  } else {
    if (current && days === 0) run('UPDATE vips SET expires_at = NULL, updated_at = ? WHERE id = ?', t, current.id);
    else run(`INSERT INTO vips(user_id, product_id, role_id, order_id, expires_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`,
      order.user_id, product.id, product.role_id, order.id, days > 0 ? t + days * 86400000 : null, t, t);
  }
}

/**
 * Entrega um pedido pago. Seguro para chamar várias vezes:
 * claimDelivery() garante que só uma execução entrega de fato.
 */
export async function deliverOrder(orderId, { actorId = null } = {}) {
  const order = claimDelivery(orderId);
  if (!order) return { ok: false, reason: 'Pedido não está pronto para entrega (já entregue ou não pago).' };
  const product = getProduct(order.product_id);
  const client = getClient();

  try {
    if (!product) throw new Error('Produto não existe mais.');
    if (!takeStock(order)) throw new Error('Produto esgotou entre o pedido e o pagamento. Entregue manualmente ou reembolse.');

    if (product.role_id) {
      const guild = await client.guilds.fetch(config.guildId);
      await grantRole(guild, order, product);
    }

    const fresh = getOrder(order.id);
    let dmOk = true;
    try {
      const user = await client.users.fetch(order.user_id);
      await user.send({ embeds: [deliveryEmbed(fresh, product)], files: [logoFile()], components: deliveryComponents(fresh) });
    } catch {
      dmOk = false; // DM fechada: o cliente vê a entrega em /meuspedidos
    }

    finishDelivery(order.id, true, dmOk ? null : 'DM fechada — cliente pode ver em /meuspedidos');
    await sendLog('vendas', {
      title: `${'✔'} Venda entregue — ${brl(order.total_cents)}`,
      description: `**${order.product_name}** para <@${order.user_id}>`,
      fields: [
        { name: 'Pedido', value: `\`${order.id}\``, inline: true },
        { name: 'Método', value: order.method, inline: true },
        { name: 'DM', value: dmOk ? 'enviada' : 'fechada', inline: true },
        ...(actorId ? [{ name: 'Liberado por', value: `<@${actorId}>`, inline: true }] : []),
      ],
      color: COLORS.main,
    });
    return { ok: true, dmOk };
  } catch (err) {
    finishDelivery(order.id, false, String(err.message).slice(0, 500));
    await sendLog('erros', {
      title: `✖ Falha na entrega — ${order.id}`,
      description: `${err.message}\n\nO cliente **não** será cobrado de novo. Use o botão ou \`/gpedido reenviar\`.`,
      color: COLORS.dark,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`adm:redeliver:${order.id}`).setLabel('Tentar entregar de novo').setStyle(ButtonStyle.Secondary),
      )],
    });
    if (!String(err.message).includes('esgotou')) await logError(`entrega ${order.id}`, err);
    return { ok: false, reason: err.message };
  }
}

/** Botões que acompanham a entrega: avaliar (se ainda não avaliou). */
export function deliveryComponents(order) {
  if (one('SELECT 1 FROM reviews WHERE order_id = ?', order.id)) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rev:open:${order.id}`).setLabel('Avaliar compra').setStyle(ButtonStyle.Secondary),
  )];
}

/** Botão "ver entrega" (usado em /meuspedidos quando a DM estava fechada). */
export function deliveryButton(orderId) {
  return new ButtonBuilder().setCustomId(`ord:view:${orderId}`).setLabel('Ver entrega').setStyle(ButtonStyle.Secondary);
}
