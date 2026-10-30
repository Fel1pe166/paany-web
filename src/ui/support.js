// Painel de suporte (menu de tickets), montado a partir da configuração do admin.
import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { logoFile } from '../theme.js';
import { colorInt, enabledOptions, getTicketConfig, parseEmoji } from '../services/ticketConfig.js';

export function supportPanel(cfg = getTicketConfig()) {
  const p = cfg.panel;
  const e = new EmbedBuilder().setColor(colorInt(p.color)).setTitle(p.title);
  if (p.description.trim()) e.setDescription(p.description);
  if (p.banner) e.setImage(p.banner);
  if (p.thumbnail) e.setThumbnail('attachment://logo.png');
  e.setFooter({ text: p.footer || `${config.botName} • ${config.storeName}`, iconURL: 'attachment://logo.png' });

  const menu = new StringSelectMenuBuilder().setCustomId('tk:reason').setPlaceholder(p.placeholder)
    .addOptions(enabledOptions().slice(0, 25).map((o) => {
      const opt = { label: o.label, value: o.value };
      if (o.description) opt.description = o.description;
      const em = parseEmoji(o.emoji);
      if (em) opt.emoji = em;
      return opt;
    }));
  return { embeds: [e], files: [logoFile()], components: [new ActionRowBuilder().addComponents(menu)] };
}

/** Publica o painel no canal e lembra onde ficou, para atualizar depois sem repostar. */
export async function publishSupportPanel(client, channelId) {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased?.()) throw new Error('Canal não encontrado ou não é de texto.');
  const msg = await ch.send(supportPanel());
  setSetting('ticket_panel_channel', ch.id);
  setSetting('ticket_panel_message', msg.id);
  return { channelId: ch.id, messageId: msg.id };
}

/** Atualiza o painel já publicado (depois de mudar título, banner, opções...). */
export async function refreshSupportPanel(client) {
  const channelId = getSetting('ticket_panel_channel');
  const messageId = getSetting('ticket_panel_message');
  if (!client || !channelId || !messageId) return false;
  try {
    const ch = await client.channels.fetch(channelId);
    const msg = await ch.messages.fetch(messageId);
    const view = supportPanel();
    await msg.edit({ ...view, attachments: [] });
    return true;
  } catch {
    return false;
  }
}
