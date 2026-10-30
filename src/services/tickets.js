import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { all, audit, getSetting, one, run } from '../db.js';
import { baseEmbed, logoFile } from '../theme.js';
import { brl, clip, isStaff } from '../util.js';
import { getOrder } from './orders.js';
import { getClient, sendLog } from './logger.js';
import { colorInt, fillTemplate, getTicketConfig, reasonLabel } from './ticketConfig.js';

export { reasonLabel };

export const openTicketOf = (userId) =>
  one(`SELECT * FROM tickets WHERE user_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1`, userId);
export const getTicket = (id) => one('SELECT * FROM tickets WHERE id = ?', Number(id));

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

  const cfg = getTicketConfig();
  const vars = { usuario: `<@${user.id}>`, motivo: reasonLabel(reason), servidor: guild.name };
  const e = baseEmbed(clip(fillTemplate(cfg.welcome.title, { ...vars, usuario: user.globalName || user.username }), 256), { color: colorInt(cfg.panel.color) })
    .setDescription(fillTemplate(cfg.welcome.message, vars));
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

/** Registra quem assumiu o atendimento (vai junto na avaliação). */
export function claimTicket(channelId, staffId) {
  const t = one(`SELECT * FROM tickets WHERE channel_id = ? AND status = 'aberto'`, channelId);
  if (!t) return { error: 'Este canal não é um ticket aberto.' };
  run('UPDATE tickets SET claimed_by = ? WHERE id = ?', staffId, t.id);
  audit(staffId, 'ticket.assumir', `#${t.id}`);
  return { ok: true, ticket: t };
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

/* ------------------------------ Avaliação do atendimento ------------------------------ */

export function ratingRequest(t, staffId) {
  const cfg = getTicketConfig();
  const e = new EmbedBuilder().setColor(colorInt(cfg.panel.color)).setTitle('Avalie seu atendimento')
    .setDescription(cfg.rating.message)
    .addFields(
      { name: 'Ticket', value: `#${t.id}`, inline: true },
      { name: 'Assunto', value: reasonLabel(t.reason), inline: true },
      ...(staffId ? [{ name: 'Atendido por', value: `<@${staffId}>`, inline: true }] : []),
    )
    .setThumbnail('attachment://logo.png')
    .setFooter({ text: `${config.storeName} • leva 5 segundos`, iconURL: 'attachment://logo.png' });
  const row = new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map((n) =>
    new ButtonBuilder().setCustomId(`trate:${t.id}:${n}`).setLabel(`${n} ★`).setStyle(n >= 4 ? ButtonStyle.Success : n <= 2 ? ButtonStyle.Danger : ButtonStyle.Secondary)));
  return { embeds: [e], files: [logoFile()], components: [row] };
}

/** Salva a nota. Só quem abriu o ticket, só depois de fechado, uma vez. */
export function saveTicketRating({ ticketId, userId, rating, comment = '' }) {
  const t = getTicket(ticketId);
  if (!t || t.user_id !== userId) return { error: 'Atendimento não encontrado.' };
  if (t.status !== 'fechado') return { error: 'Esse atendimento ainda está aberto.' };
  const n = Number(rating);
  if (!Number.isInteger(n) || n < 1 || n > 5) return { error: 'Nota inválida.' };
  if (one('SELECT 1 FROM ticket_ratings WHERE ticket_id = ?', t.id)) return { error: 'Você já avaliou esse atendimento. Obrigado!' };
  const staffId = t.claimed_by || (t.closed_by && t.closed_by !== t.user_id ? t.closed_by : null);
  run('INSERT INTO ticket_ratings(ticket_id, user_id, staff_id, rating, comment, created_at) VALUES(?,?,?,?,?,?)',
    t.id, userId, staffId, n, clip(String(comment || '').trim(), 500) || null, Date.now());
  audit(userId, 'ticket.avaliar', `#${t.id} nota=${n}`);
  return { ok: true, ticket: t, rating: n, staffId };
}

/** Publica a avaliação no canal escolhido pelo admin. */
export async function publishTicketRating({ ticket, rating, comment, staffId }) {
  const channelId = getSetting('channel_ticket_reviews') || getSetting('channel_reviews');
  if (!channelId) return false;
  try {
    const ch = await getClient().channels.fetch(channelId);
    const cfg = getTicketConfig();
    const e = new EmbedBuilder().setColor(colorInt(cfg.panel.color))
      .setTitle(`${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} · Atendimento`)
      .setDescription(comment ? `“${clip(comment, 500)}”` : '_Sem comentário._')
      .addFields(
        { name: 'Cliente', value: `<@${ticket.user_id}>`, inline: true },
        { name: 'Atendente', value: staffId ? `<@${staffId}>` : '—', inline: true },
        { name: 'Assunto', value: reasonLabel(ticket.reason), inline: true },
      )
      .setFooter({ text: `Ticket #${ticket.id}`, iconURL: 'attachment://logo.png' })
      .setTimestamp();
    await ch.send({ embeds: [e], files: [logoFile()], allowedMentions: { parse: [] } });
    return true;
  } catch (e) {
    console.warn('[avaliação de ticket] não consegui publicar:', e.message);
    return false;
  }
}

export function ticketRatingStats(limit = 50) {
  const s = one('SELECT COUNT(*) n, AVG(rating) avg FROM ticket_ratings');
  const byStaff = all(`SELECT staff_id, COUNT(*) n, AVG(rating) avg FROM ticket_ratings WHERE staff_id IS NOT NULL GROUP BY staff_id ORDER BY avg DESC, n DESC LIMIT 20`);
  const recent = all(`SELECT r.*, t.reason FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id ORDER BY r.created_at DESC LIMIT ?`, limit);
  return { count: s.n, avg: s.avg, byStaff, recent };
}

/* ------------------------------------ Fechar ------------------------------------ */

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
    description: `Cliente: <@${t.user_id}> • Motivo: ${reasonLabel(t.reason)}${t.order_id ? ` • Pedido \`${t.order_id}\`` : ''}\nFechado por <@${closer.id}>${t.claimed_by ? ` • Atendido por <@${t.claimed_by}>` : ''}`,
    files,
  });

  // Pede a avaliação na DM de quem abriu (não para o canal interno de comprovante)
  let ratingSent = false;
  if (getTicketConfig().rating.enabled && t.reason !== 'comprovante') {
    const staffId = t.claimed_by || (closer.id !== t.user_id ? closer.id : null);
    const user = await channel.client.users.fetch(t.user_id).catch(() => null);
    ratingSent = await user?.send(ratingRequest({ ...t, status: 'fechado' }, staffId)).then(() => true).catch(() => false) ?? false;
  }
  setTimeout(() => channel.delete('Ticket fechado').catch(() => {}), 5000);
  return { ok: true, ratingSent };
}
