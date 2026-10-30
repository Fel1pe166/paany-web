import { EmbedBuilder } from 'discord.js';
import { getSetting } from '../db.js';
import { COLORS } from '../theme.js';

let client = null;
export const setClient = (c) => { client = c; };
export const getClient = () => client;

/**
 * Envia um registro para um canal configurado em /configurar canais.
 * kind: 'vendas' | 'admin' | 'erros' | 'aprovacoes'
 */
export async function sendLog(kind, { title, description, fields = [], color = COLORS.muted, components, files, content } = {}) {
  const line = `[${kind}] ${title || ''} ${description ? `— ${String(description).replace(/\s+/g, ' ').slice(0, 300)}` : ''}`;
  if (kind === 'erros') console.error(line); else console.log(line);

  const key = kind === 'aprovacoes' ? 'channel_approvals' : `channel_logs_${kind}`;
  const channelId = getSetting(key) || getSetting('channel_logs_admin');
  if (!client || !channelId) return null;
  try {
    const ch = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder().setColor(color).setTimestamp();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(String(description).slice(0, 4000));
    if (fields.length) embed.addFields(fields.slice(0, 25));
    return await ch.send({ content, embeds: [embed], components, files });
  } catch (e) {
    console.error(`[logger] não consegui enviar log "${kind}":`, e.message);
    return null;
  }
}

export const logError = (where, err) =>
  sendLog('erros', { title: `Erro em ${where}`, description: `\`\`\`${String(err?.stack || err).slice(0, 1500)}\`\`\``, color: COLORS.dark });
