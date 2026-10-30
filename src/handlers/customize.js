// Personalização pelo Discord: painel de tickets (/ticket) e embeds com botões (/embed).
import {
  ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { audit, setSetting } from '../db.js';
import { baseEmbed, logoFile, notice } from '../theme.js';
import { clip, isAdmin } from '../util.js';
import { sendLog } from '../services/logger.js';
import * as E from '../services/embeds.js';
import {
  BUILTIN_REASONS, getTicketConfig, MAX_OPTIONS, parseEmoji, resetTicketConfig, saveTicketConfig,
} from '../services/ticketConfig.js';
import { ticketRatingStats } from '../services/tickets.js';
import { publishSupportPanel, refreshSupportPanel, supportPanel } from '../ui/support.js';
import { storePanel } from '../ui/store.js';

const EPH = MessageFlags.Ephemeral;
const err = (text) => ({ embeds: [notice(text, 'error')], flags: EPH });
const ok = (text) => ({ embeds: [notice(text, 'ok')], flags: EPH });
const input = (id, label, { style = TextInputStyle.Short, value = '', max = 100, required = false, placeholder = '' } = {}) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
  if (value) t.setValue(String(value).slice(0, max));
  if (placeholder) t.setPlaceholder(placeholder.slice(0, 100));
  return new ActionRowBuilder().addComponents(t);
};
const guard = (i) => {
  if (isAdmin(i.user.id)) return false;
  audit(i.user.id, 'acesso.negado', i.commandName || i.customId);
  i.reply(err('Você não tem permissão para isso.')).catch(() => {});
  return true;
};

/** Prévia do painel de tickets só para quem está configurando. */
const previewPanel = (msg) => ({ ...supportPanel(), content: msg, flags: EPH });

/* ================================== /ticket ================================== */

export async function ticketCommand(i) {
  if (guard(i)) return null;
  const sub = i.options.getSubcommand();
  const cfg = getTicketConfig();

  if (sub === 'personalizar') {
    return i.showModal(new ModalBuilder().setCustomId('modal:tkpanel').setTitle('Painel de tickets').addComponents(
      input('title', 'Título', { value: cfg.panel.title, max: 256, required: true }),
      input('description', 'Descrição', { style: TextInputStyle.Paragraph, value: cfg.panel.description, max: 4000 }),
      input('banner', 'Banner (link da imagem, vazio = sem banner)', { value: cfg.panel.banner, max: 500, placeholder: 'https://i.imgur.com/....png' }),
      input('color', 'Cor da barra lateral (#RRGGBB)', { value: cfg.panel.color, max: 7, placeholder: '#F2F2F2' }),
      input('placeholder', 'Texto do menu', { value: cfg.panel.placeholder, max: 150 }),
    ));
  }
  if (sub === 'boas-vindas') {
    return i.showModal(new ModalBuilder().setCustomId('modal:tkwelcome').setTitle('Mensagem ao abrir o ticket').addComponents(
      input('title', 'Título ({motivo} = assunto escolhido)', { value: cfg.welcome.title, max: 200, required: true }),
      input('message', 'Mensagem ({usuario}, {motivo}, {servidor})', { style: TextInputStyle.Paragraph, value: cfg.welcome.message, max: 2000, required: true }),
    ));
  }
  if (sub === 'opcao') {
    const value = i.options.getString('opcao');
    const existing = value ? cfg.options.find((o) => o.value === value) : null;
    if (value && !existing) return i.reply(err('Opção não encontrada.'));
    if (i.options.getBoolean('remover')) {
      if (!existing) return i.reply(err('Escolha a opção que quer remover.'));
      try {
        saveTicketConfig({ options: cfg.options.filter((o) => o.value !== value) }, i.user.id);
      } catch (e) { return i.reply(err(e.message)); }
      await refreshSupportPanel(i.client);
      return i.reply(previewPanel(`Opção **${existing.label}** removida.`));
    }
    if (!existing && cfg.options.length >= MAX_OPTIONS) return i.reply(err(`O menu já tem ${MAX_OPTIONS} opções. Remova alguma antes.`));
    const ativa = i.options.getBoolean('ativa');
    return i.showModal(new ModalBuilder().setCustomId(`modal:tkopt:${existing ? existing.value : 'new'}:${ativa == null ? '-' : ativa ? '1' : '0'}`)
      .setTitle(existing ? clip(`Editar: ${existing.label}`, 45) : 'Nova opção do menu').addComponents(
        input('label', 'Nome', { value: existing?.label, max: 100, required: true, placeholder: 'Ex.: Parcerias' }),
        input('description', 'Descrição curta (aparece embaixo do nome)', { value: existing?.description, max: 100 }),
        input('emoji', 'Emoji (ex.: 🤝 ou <:nome:123456789>)', { value: existing?.emoji, max: 64 }),
      ));
  }
  if (sub === 'avaliacao') {
    const body = { rating: { enabled: i.options.getBoolean('ativa') } };
    if (i.options.getString('mensagem')) body.rating.message = i.options.getString('mensagem');
    saveTicketConfig(body, i.user.id);
    const ch = i.options.getChannel('canal');
    if (ch) setSetting('channel_ticket_reviews', ch.id);
    return i.reply(ok(`Pedido de avaliação ${body.rating.enabled ? '**ligado**' : '**desligado**'}.${ch ? ` As notas vão para ${ch}.` : ''}`));
  }
  if (sub === 'publicar') {
    const ch = i.options.getChannel('canal') || i.channel;
    try {
      await publishSupportPanel(i.client, ch.id);
    } catch (e) { return i.reply(err(e.message)); }
    audit(i.user.id, 'tickets.publicar', ch.id);
    return i.reply(ok(`Painel publicado em ${ch}. Mudanças futuras atualizam essa mensagem sozinhas.`));
  }
  if (sub === 'notas') {
    const s = ticketRatingStats(10);
    const e = baseEmbed('Avaliações do atendimento')
      .setDescription(s.count ? `**${s.avg.toFixed(2)} ★** de média em ${s.count} avaliação(ões).` : 'Nenhuma avaliação ainda.');
    if (s.byStaff.length) e.addFields({ name: 'Equipe', value: s.byStaff.map((x, n) => `${n + 1}. <@${x.staff_id}> — ${x.avg.toFixed(1)} ★ (${x.n})`).join('\n').slice(0, 1024) });
    if (s.recent.length) e.addFields({ name: 'Últimas', value: s.recent.map((r) => `${'★'.repeat(r.rating)} <@${r.user_id}>${r.comment ? ` — “${clip(r.comment, 60)}”` : ''}`).join('\n').slice(0, 1024) });
    return i.reply({ embeds: [e], files: [logoFile()], flags: EPH });
  }
  if (sub === 'restaurar') {
    resetTicketConfig(i.user.id);
    await refreshSupportPanel(i.client);
    return i.reply(previewPanel('Painel de tickets voltou ao padrão.'));
  }
  return null;
}

export async function ticketModalSubmit(i, kind, args) {
  if (guard(i)) return null;
  const f = (k) => i.fields.getTextInputValue(k);
  try {
    if (kind === 'tkpanel') {
      saveTicketConfig({ panel: { title: f('title'), description: f('description'), banner: f('banner').trim(), color: f('color').trim(), placeholder: f('placeholder') } }, i.user.id);
    } else if (kind === 'tkwelcome') {
      saveTicketConfig({ welcome: { title: f('title'), message: f('message') } }, i.user.id);
      return i.reply(ok('Mensagem de boas-vindas salva. Ela aparece nos próximos tickets.'));
    } else if (kind === 'tkopt') {
      const [value, ativa] = args;
      const cfg = getTicketConfig();
      const data = { label: f('label'), description: f('description'), emoji: f('emoji').trim() };
      if (data.emoji && !parseEmoji(data.emoji)) return i.reply(err('Emoji inválido. Use um emoji comum (🤝) ou personalizado (<:nome:id>).'));
      let options;
      if (value === 'new') options = [...cfg.options, { value: '', ...data, enabled: ativa !== '0' }];
      else options = cfg.options.map((o) => (o.value === value ? { ...o, ...data, enabled: ativa === '-' ? o.enabled : ativa === '1' } : o));
      saveTicketConfig({ options }, i.user.id);
    }
  } catch (e) {
    return i.reply(err(e.message));
  }
  const updated = await refreshSupportPanel(i.client);
  await sendLog('admin', { title: 'Painel de tickets personalizado', description: `por <@${i.user.id}>` });
  return i.reply(previewPanel(`Salvo! ${updated ? 'O painel publicado já foi atualizado.' : 'Use `/ticket publicar` para colocar o painel num canal.'} Prévia:`));
}

/* ================================== /embed ================================== */

function embedModal(customId, title, rec = null, guild = null) {
  const d = rec?.data || {};
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(
    input('title', 'Título', { value: d.title, max: 256 }),
    input('description', 'Descrição (aceita **negrito**, links, emojis)', { style: TextInputStyle.Paragraph, value: d.description, max: 4000 }),
    input('image', 'Imagem grande (link, opcional)', { value: d.image, max: 500, placeholder: 'https://i.imgur.com/....png' }),
    input('color', 'Cor (#RRGGBB)', { value: d.color || '#F2F2F2', max: 7 }),
    input('buttons', 'Botões: um por linha (veja o exemplo)', {
      style: TextInputStyle.Paragraph, value: rec ? E.buttonsToLines(d.buttons || [], guild) : '', max: 1500,
      placeholder: 'Site | https://cutify.com\nComprar | loja\nSuporte | ticket\nAvisos | cargo Notificações',
    }),
  );
}

export async function embedCommand(i) {
  if (guard(i)) return null;
  const sub = i.options.getSubcommand();
  if (sub === 'criar') {
    const ch = i.options.getChannel('canal') || i.channel;
    return i.showModal(embedModal(`modal:embed:new:${ch.id}`, 'Novo embed'));
  }
  if (sub === 'listar') {
    const list = E.listEmbeds();
    const e = baseEmbed('Embeds salvos').setDescription(list.length
      ? list.map((r) => `\`#${r.id}\` **${clip(r.name, 50)}** · ${r.channel_id ? `<#${r.channel_id}>` : 'não publicado'} · ${r.data.buttons.length} botão(ões)`).join('\n').slice(0, 4000)
      : 'Nenhum ainda. Use `/embed criar` ou o painel web.');
    return i.reply({ embeds: [e], files: [logoFile()], flags: EPH });
  }
  const rec = E.getEmbed(i.options.getString('embed'));
  if (!rec) return i.reply(err('Embed não encontrado.'));
  if (sub === 'editar') return i.showModal(embedModal(`modal:embed:edit:${rec.id}`, clip(`Editar: ${rec.name}`, 45), rec, i.guild));
  if (sub === 'reenviar') {
    await i.deferReply({ flags: EPH });
    try {
      const target = i.options.getChannel('canal')?.id || rec.channel_id || i.channelId;
      const r = await E.publishEmbed(i.client, rec, target);
      return i.editReply({ embeds: [notice(`${r.edited ? 'Mensagem atualizada' : 'Publicado'} em <#${r.channelId}>.`, 'ok')] });
    } catch (e) { return i.editReply({ embeds: [notice(e.message, 'error')] }); }
  }
  if (sub === 'apagar') {
    if (rec.channel_id && rec.message_id) {
      const ch = await i.client.channels.fetch(rec.channel_id).catch(() => null);
      await ch?.messages.fetch(rec.message_id).then((m) => m.delete()).catch(() => {});
    }
    E.deleteEmbedRecord(rec.id, i.user.id);
    return i.reply(ok(`Embed **${rec.name}** apagado.`));
  }
  return null;
}

export async function embedModalSubmit(i, args) {
  if (guard(i)) return null;
  const [mode, ref] = args;
  const f = (k) => i.fields.getTextInputValue(k);
  await i.deferReply({ flags: EPH });
  try {
    const prev = mode === 'edit' ? E.getEmbed(ref) : null;
    if (mode === 'edit' && !prev) throw new Error('Embed não encontrado.');
    const buttons = E.parseButtonLines(f('buttons'), i.guild);
    for (const b of buttons) if (b.action === 'role') { const p = E.roleProblem(i.guild, b.value); if (p) throw new Error(p); }
    const data = E.normalizeEmbed({ ...(prev?.data || {}), title: f('title'), description: f('description'), image: f('image').trim(), color: f('color').trim() || '#f2f2f2', buttons });
    const rec = E.saveEmbed({ id: prev?.id, name: prev?.name || data.title, data }, i.user.id);
    const r = await E.publishEmbed(i.client, rec, mode === 'new' ? ref : rec.channel_id || i.channelId);
    return i.editReply({ embeds: [notice(`${r.edited ? 'Embed atualizado' : 'Embed publicado'} em <#${r.channelId}> (#${rec.id}). Para editar depois: \`/embed editar\`.`, 'ok')] });
  } catch (e) {
    return i.editReply({ embeds: [notice(e.message, 'error')] });
  }
}

/** Cliques nos botões dos embeds personalizados. */
export async function embedButton(i, action, args) {
  if (action === 'store') return i.reply({ ...storePanel(), flags: EPH });
  if (action === 'ticket') return i.reply({ ...supportPanel(), flags: EPH });
  if (action === 'role') {
    if (!i.inGuild()) return i.reply(err('Use este botão dentro do servidor.'));
    const roleId = args[0];
    const problem = E.roleProblem(i.guild, roleId);
    if (problem) return i.reply(err(`${problem} Avise um administrador.`));
    const member = await i.guild.members.fetch(i.user.id);
    const has = member.roles.cache.has(roleId);
    try {
      if (has) await member.roles.remove(roleId, 'Botão de embed');
      else await member.roles.add(roleId, 'Botão de embed');
    } catch {
      return i.reply(err('Não consegui mudar o seu cargo. Avise um administrador.'));
    }
    return i.reply(ok(has ? `Cargo <@&${roleId}> removido.` : `Você recebeu o cargo <@&${roleId}>!`));
  }
  return null;
}

/* =============================== Autocomplete =============================== */

export function customizeAutocomplete(i) {
  const q = String(i.options.getFocused() || '').toLowerCase();
  if (!isAdmin(i.user.id)) return [];
  if (i.commandName === 'ticket') {
    return getTicketConfig().options.filter((o) => !q || o.label.toLowerCase().includes(q)).slice(0, 25)
      .map((o) => ({ name: clip(`${o.emoji ? `${o.emoji} ` : ''}${o.label}${o.enabled ? '' : ' (oculta)'}${BUILTIN_REASONS[o.value] ? '' : ' · personalizada'}`, 100), value: o.value }));
  }
  if (i.commandName === 'embed') {
    return E.listEmbeds().filter((r) => !q || r.name.toLowerCase().includes(q)).slice(0, 25)
      .map((r) => ({ name: clip(`#${r.id} ${r.name}`, 100), value: String(r.id) }));
  }
  return [];
}
