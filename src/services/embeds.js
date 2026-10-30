// Construtor de embeds com botões (criados pelo admin no Discord ou no painel web).
// Botões podem: abrir um link, abrir a loja, abrir o suporte ou dar/tirar um cargo.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { all, audit, one, run } from '../db.js';
import { colorInt, HEX, isUrl, parseEmoji } from './ticketConfig.js';

export const MAX_BUTTONS = 10;
export const ACTIONS = ['link', 'store', 'ticket', 'role'];
const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

const parse = (r) => (r ? { ...r, data: JSON.parse(r.data) } : null);
export const getEmbed = (id) => parse(one('SELECT * FROM custom_embeds WHERE id = ?', Number(id)));
export const listEmbeds = () => all('SELECT * FROM custom_embeds ORDER BY updated_at DESC LIMIT 100').map(parse);

const str = (v, max) => String(v ?? '').slice(0, max);

/** Normaliza e valida os dados do embed. Lança Error com mensagem clara. */
export function normalizeEmbed(input) {
  const d = {
    title: str(input.title, 256).trim(),
    url: str(input.url, 500).trim(),
    description: str(input.description, 4000),
    color: input.color || '#f2f2f2',
    image: str(input.image, 500).trim(),
    thumbnail: str(input.thumbnail, 500).trim(),
    author: str(input.author, 256).trim(),
    footer: str(input.footer, 2048).trim(),
    timestamp: Boolean(input.timestamp),
    content: str(input.content, 2000),
    buttons: [],
  };
  if (!HEX.test(d.color)) throw new Error('Cor inválida. Use o formato #RRGGBB.');
  for (const k of ['url', 'image', 'thumbnail']) if (d[k] && !isUrl(d[k])) throw new Error(`O campo "${k === 'url' ? 'link do título' : k === 'image' ? 'imagem' : 'miniatura'}" precisa ser um link https://.`);
  if (!d.title && !d.description.trim() && !d.image) throw new Error('Preencha pelo menos o título, a descrição ou a imagem.');
  const buttons = Array.isArray(input.buttons) ? input.buttons : [];
  if (buttons.length > MAX_BUTTONS) throw new Error(`Use no máximo ${MAX_BUTTONS} botões.`);
  for (const b of buttons) {
    const label = str(b.label, 80).trim();
    const emoji = str(b.emoji, 64).trim();
    if (!label && !emoji) throw new Error('Todo botão precisa de texto ou emoji.');
    if (emoji && !parseEmoji(emoji)) throw new Error(`Emoji inválido no botão "${label}".`);
    const action = ACTIONS.includes(b.action) ? b.action : 'link';
    const value = str(b.value, 500).trim();
    if (action === 'link' && !isUrl(value)) throw new Error(`O botão "${label || emoji}" precisa de um link https://.`);
    if (action === 'role' && !/^\d{15,25}$/.test(value)) throw new Error(`Escolha o cargo do botão "${label || emoji}".`);
    d.buttons.push({ label, emoji, action, value: action === 'link' || action === 'role' ? value : '', style: action === 'link' ? 'link' : (STYLES[b.style] ? b.style : 'secondary') });
  }
  return d;
}

/** Monta a mensagem do Discord a partir dos dados normalizados. */
export function buildMessage(d) {
  const e = new EmbedBuilder().setColor(colorInt(d.color));
  if (d.title) e.setTitle(d.title);
  if (d.url && d.title) e.setURL(d.url);
  if (d.description.trim()) e.setDescription(d.description);
  if (d.image) e.setImage(d.image);
  if (d.thumbnail) e.setThumbnail(d.thumbnail);
  if (d.author) e.setAuthor({ name: d.author });
  if (d.footer) e.setFooter({ text: d.footer });
  if (d.timestamp) e.setTimestamp();
  const rows = [];
  d.buttons.forEach((b, idx) => {
    if (idx % 5 === 0) rows.push(new ActionRowBuilder());
    const btn = new ButtonBuilder();
    if (b.label) btn.setLabel(b.label);
    if (b.emoji) btn.setEmoji(parseEmoji(b.emoji));
    if (b.action === 'link') btn.setURL(b.value).setStyle(ButtonStyle.Link);
    else {
      btn.setStyle(STYLES[b.style] || ButtonStyle.Secondary)
        .setCustomId(b.action === 'role' ? `emb:role:${b.value}` : `emb:${b.action}:${idx}`);
    }
    rows[rows.length - 1].addComponents(btn);
  });
  return { content: d.content || undefined, embeds: [e], components: rows, allowedMentions: { parse: [] } };
}

/** Cargos que nunca podem ser distribuídos por botão (dariam poder de moderação). */
const DANGEROUS = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.MentionEveryone];

/** Confere se o cargo pode ser dado por botão. Retorna mensagem de erro ou null. */
export function roleProblem(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return 'Cargo não encontrado no servidor.';
  if (role.managed || role.id === guild.id) return `O cargo "${role.name}" não pode ser distribuído.`;
  if (DANGEROUS.some((p) => role.permissions.has(p))) return `O cargo "${role.name}" tem permissões de moderação e não pode ser dado por botão.`;
  const me = guild.members.me;
  if (me && me.roles.highest.comparePositionTo(role) <= 0) return `O cargo "${role.name}" está acima do cargo do bot.`;
  return null;
}

export function saveEmbed({ id = null, name, data, channelId = null, messageId = null }, actorId) {
  const t = Date.now();
  const n = str(name, 80).trim() || data.title || 'Embed sem nome';
  if (id) {
    run('UPDATE custom_embeds SET name = ?, data = ?, channel_id = COALESCE(?, channel_id), message_id = COALESCE(?, message_id), updated_at = ? WHERE id = ?',
      n, JSON.stringify(data), channelId, messageId, t, Number(id));
    audit(actorId, 'embed.editar', `#${id} ${n}`);
    return getEmbed(id);
  }
  const r = run('INSERT INTO custom_embeds(name, data, channel_id, message_id, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    n, JSON.stringify(data), channelId, messageId, actorId, t, t);
  audit(actorId, 'embed.criar', `#${r.lastInsertRowid} ${n}`);
  return getEmbed(Number(r.lastInsertRowid));
}

export const setEmbedMessage = (id, channelId, messageId) =>
  run('UPDATE custom_embeds SET channel_id = ?, message_id = ?, updated_at = ? WHERE id = ?', channelId, messageId, Date.now(), Number(id));

export function deleteEmbedRecord(id, actorId) {
  const r = run('DELETE FROM custom_embeds WHERE id = ?', Number(id));
  if (r.changes) audit(actorId, 'embed.apagar', `#${id}`);
  return r.changes === 1;
}

/**
 * Publica (ou atualiza) a mensagem do embed no canal.
 * Se o canal mudou ou a mensagem sumiu, envia uma nova.
 */
export async function publishEmbed(client, rec, channelId) {
  const target = channelId || rec.channel_id;
  if (!target) throw new Error('Escolha o canal.');
  const ch = await client.channels.fetch(target).catch(() => null);
  if (!ch?.isTextBased?.()) throw new Error('Canal não encontrado ou não é de texto.');
  const payload = buildMessage(rec.data);
  if (rec.message_id && rec.channel_id === target) {
    const msg = await ch.messages.fetch(rec.message_id).catch(() => null);
    if (msg) {
      await msg.edit({ ...payload, content: payload.content ?? null });
      return { edited: true, channelId: target, messageId: msg.id };
    }
  }
  const msg = await ch.send(payload);
  setEmbedMessage(rec.id, target, msg.id);
  return { edited: false, channelId: target, messageId: msg.id };
}

/**
 * Formato rápido de botões para o Discord (uma linha por botão):
 *   Texto | https://link       → botão de link
 *   Texto | loja               → abre a loja
 *   Texto | ticket             → abre o suporte
 *   Texto | cargo NomeOuID     → dá/tira o cargo
 */
export function parseButtonLines(text, guild = null) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [labelRaw, targetRaw = ''] = line.split('|').map((s) => s.trim());
    const target = targetRaw.toLowerCase();
    let emoji = '';
    let label = labelRaw;
    const em = /^(<a?:\w+:\d+>|\p{Extended_Pictographic}️?)\s*/u.exec(labelRaw);
    if (em) { emoji = em[1]; label = labelRaw.slice(em[0].length); }
    if (isUrl(targetRaw)) return { label, emoji, action: 'link', value: targetRaw };
    if (target === 'loja' || target === 'store') return { label, emoji, action: 'store', value: '', style: 'primary' };
    if (target === 'ticket' || target === 'suporte') return { label, emoji, action: 'ticket', value: '', style: 'secondary' };
    const roleMatch = /^(?:cargo|role)\s+(.+)$/i.exec(targetRaw);
    if (roleMatch) {
      const ref = roleMatch[1].replace(/[<@&>]/g, '').trim();
      const role = /^\d+$/.test(ref) ? guild?.roles.cache.get(ref) : guild?.roles.cache.find((r) => r.name.toLowerCase() === ref.toLowerCase());
      if (!role) throw new Error(`Cargo "${ref}" não encontrado (linha: ${line}).`);
      return { label, emoji, action: 'role', value: role.id, style: 'success' };
    }
    throw new Error(`Não entendi o botão: "${line}". Use "Texto | link", "Texto | loja", "Texto | ticket" ou "Texto | cargo Nome".`);
  });
}

/** Volta os botões para o formato de texto (para editar pelo Discord). */
export function buttonsToLines(buttons, guild = null) {
  return buttons.map((b) => {
    const lbl = `${b.emoji ? `${b.emoji} ` : ''}${b.label}`.trim();
    if (b.action === 'link') return `${lbl} | ${b.value}`;
    if (b.action === 'store') return `${lbl} | loja`;
    if (b.action === 'ticket') return `${lbl} | ticket`;
    return `${lbl} | cargo ${guild?.roles.cache.get(b.value)?.name || b.value}`;
  }).join('\n');
}
