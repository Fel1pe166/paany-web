import { all, audit, getSetting, one, run } from '../db.js';
import { baseEmbed, logoFile } from '../theme.js';
import { clip } from '../util.js';
import { getClient } from './logger.js';
import { getOrder } from './orders.js';

export const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** Grava a avaliação de um pedido entregue. Uma por pedido, só do comprador. */
export function saveReview({ orderId, userId, rating, comment }) {
  const o = getOrder(orderId);
  if (!o || o.user_id !== userId) return { error: 'Pedido não encontrado.' };
  if (o.status !== 'entregue') return { error: 'Só dá para avaliar pedidos entregues.' };
  const n = Number(String(rating).trim());
  if (!Number.isInteger(n) || n < 1 || n > 5) return { error: 'A nota precisa ser um número de 1 a 5.' };
  if (one('SELECT 1 FROM reviews WHERE order_id = ?', o.id)) return { error: 'Você já avaliou esse pedido. Obrigado!' };
  run('INSERT INTO reviews(order_id, user_id, product_id, rating, comment, created_at) VALUES(?,?,?,?,?,?)',
    o.id, userId, o.product_id, n, clip(comment?.trim() || '', 300) || null, Date.now());
  audit(userId, 'avaliacao.criar', `${o.id} nota=${n}`);
  return { ok: true, order: o, rating: n };
}

/** Publica no canal de avaliações (configurado em /configurar canais). */
export async function publishReview({ order, rating, comment, userId }) {
  const channelId = getSetting('channel_reviews');
  if (!channelId) return;
  try {
    const ch = await getClient().channels.fetch(channelId);
    const e = baseEmbed(stars(rating))
      .setDescription(comment ? `“${clip(comment, 300)}”` : '_Sem comentário._')
      .addFields({ name: 'Produto', value: order.product_name, inline: true }, { name: 'Cliente', value: `<@${userId}>`, inline: true });
    await ch.send({ embeds: [e], files: [logoFile()], allowedMentions: { users: [] } });
  } catch (e) {
    console.warn('[avaliações] não consegui publicar:', e.message);
  }
}

export function productRating(productId) {
  return one('SELECT COUNT(*) n, AVG(rating) media FROM reviews WHERE product_id = ? AND hidden = 0', productId);
}

export const latestReviews = (limit = 50) =>
  all(`SELECT r.*, p.name product_name FROM reviews r LEFT JOIN products p ON p.id = r.product_id ORDER BY r.id DESC LIMIT ?`, limit);
