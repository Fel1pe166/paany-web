import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { audit, getSetting, one, run } from '../db.js';
import { baseEmbed, logoFile } from '../theme.js';
import { brl, isStaff } from '../util.js';
import { getOrder } from './orders.js';
import { sendLog } from './logger.js';

export const TICKET_REASONS = {
  duvida: 'Dúvidas sobre produtos',
  pagamento: 'Problemas com pagamento',
  nao_recebido: 'Produto não recebido',
  reembolso: 'Solicitação de reembolso',
  vip: 'Problemas com VIP',
  outros: 'Outros assuntos',
  comprovante: 'Comprovante de Pix manual',
};

export const openTicketOf = (userId) =>
  one(`SELECT * FROM tickets WHERE user_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1`, userId);

/**
 * Cria um canal privado de atendimento.
 * @returns {Promise<{ channel?: import('discord.js').TextChannel, error?: string, existing?: boolean }>}
 */
export async function createTicket(guild, user, { reason, orderId = null, description = '' }) {
  const open = openTicketOf(user.id);
  if (open) {
    const ch = await guild.channels.fetch(open.channel_id).catch(() => null);
    if (ch) return { channel: ch, existing: true };
    run(`UPDATE tickets SET status = 'fechado', closed_at = ? WHERE id = ?`, Date.now(), open.id);
  }

  // Só anexa o pedido se ele for do próprio usuário
  let order = null;
  if (orderId) {
    order = getOrder(orderId);
    if (!order || order.user_id !== user.id) order = null;
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks],
    },
    {
      id: guild.client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
    },
  ];
  if (config.staffRoleId) {
    overwrites.push({
      id: config.staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles],
    });
  }

  const base = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'cliente';
  const channel = await guild.channels.create({
    name: `${reason === 'comprovante' ? 'pix' : 'ticket'}-${base}`,
    type: ChannelType.GuildText,
    parent: getSetting('ticket_category') || undefined,
    permissionOverwrites: overwrites,
    topic: `Ticket de ${user.tag ?? user.username} (${user.id})${order ? ` • Pedido ${order.id}` : ''}`,
  });

  run('INSERT INTO tickets(channel_id, user_id, reason, order_id, created_at) VALUES(?,?,?,?,?)',
    channel.id, user.id, reason, order?.id ?? null, Date.now());

  const e = baseEmbed(`Atendimento • ${TICKET_REASONS[reason] || reason}`)
    .setDescription(`Olá <@${user.id}>! Explique o que aconteceu e a equipe vai te responder aqui.\n` +
      'Nunca envie senhas ou dados de cartão. A equipe **nunca** pede pagamento por fora da loja.');
  if (order) {
    e.addFields(
      { name: 'Pedido', value: `\`${order.id}\``, inline: true },
      { name: 'Produto', value: order.product_name, inline: true },
      { name: 'Valor', value: brl(order.total_cents), inline: true },
    );
  }
  if (description) e.addFields({ name: 'Descrição', value: description.slice(0, 1024) });

  await channel.send({
    content: `<@${user.id}>${config.staffRoleId ? ` <@&${config.staffRoleId}>` : ''}`,
    embeds: [e],
    files: [logoFile()],
    components: [ticketButtons()],
    allowedMentions: { users: [user.id], roles: config.staffRoleId ? [config.staffRoleId] : [] },
  });
  audit(user.id, 'ticket.abrir', `${channel.id} ${reason}${order ? ` ${order.id}` : ''}`);
  return { channel };
}

export function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tk:claim').setLabel('Assumir').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tk:call').setLabel('Chamar equipe').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tk:close').setLabel('Fechar ticket').setStyle(ButtonStyle.Danger),
  );
}

/** Gera transcrição em texto do canal (precisa do Message Content Intent). */
async function transcript(channel) {
  const lines = [];
  let before;
  for (let i = 0; i < 5; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    for (const m of batch.values()) {
      const att = [...m.attachments.values()].map((a) => ` [anexo: ${a.url}]`).join('');
      const emb = m.embeds.length ? ` [embed: ${m.embeds[0].title || ''}]` : '';
      lines.push(`[${new Date(m.createdTimestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ${m.author.tag ?? m.author.username}: ${m.content}${att}${emb}`);
    }
    before = batch.last().id;
  }
  return lines.reverse().join('\n');
}

export async function closeTicket(channel, closer) {
  const t = one(`SELECT * FROM tickets WHERE channel_id = ? AND status = 'aberto'`, channel.id);
  if (!t) return { error: 'Este canal não é um ticket aberto.' };
  if (closer.id !== t.user_id && !isStaff(closer)) return { error: 'Só o cliente ou a equipe podem fechar.' };

  run(`UPDATE tickets SET status = 'fechado', closed_at = ?, closed_by = ? WHERE id = ?`, Date.now(), closer.id, t.id);
  audit(closer.id, 'ticket.fechar', `${channel.id}`);

  let files;
  if (config.transcripts) {
    try {
      const text = await transcript(channel);
      files = [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${t.id}.txt` })];
    } catch { /* sem permissão de leitura */ }
  }
  await sendLog('admin', {
    title: `Ticket #${t.id} fechado`,
    description: `Cliente: <@${t.user_id}> • Motivo: ${TICKET_REASONS[t.reason] || t.reason}${t.order_id ? ` • Pedido \`${t.order_id}\`` : ''}\nFechado por <@${closer.id}>`,
    files,
  });
  setTimeout(() => channel.delete('Ticket fechado').catch(() => {}), 5000);
  return { ok: true };
}
