import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { config } from './config.js';

// Identidade visual preto e branco, igual ao logo do gatinho.
export const COLORS = {
  main: 0xf2f2f2,   // barra branca
  muted: 0x8a8a8a,  // pendente / informativo
  dark: 0x1a1a1a,   // neutro escuro
};

export const ICON = {
  dot: '◆',
  arrow: '▸',
  ok: '✔',
  no: '✖',
  wait: '◌',
};

export const STATUS_LABEL = {
  aguardando_pagamento: '◌ Aguardando pagamento',
  em_analise: '◌ Em análise pela equipe',
  pago: '✔ Pagamento confirmado',
  processando: '▸ Em processamento',
  entregue: '✔ Entregue',
  falha_entrega: '✖ Falha na entrega (equipe avisada)',
  cancelado: '✖ Cancelado',
  expirado: '✖ Expirado',
  reembolso_solicitado: '◌ Reembolso solicitado',
  reembolsado: '↺ Reembolsado',
};

export const CATEGORIES = {
  vip: 'VIPs e áreas exclusivas',
  ae: 'After Effects (CCs e efeitos)',
  alight: 'Alight Motion (presets)',
  node: 'Node (gráficos e recursos)',
  capcut: 'CapCut',
  cursos: 'Cursos e materiais',
  personalizado: 'Produtos personalizados',
};

export const logoFile = () => new AttachmentBuilder('assets/logo.png', { name: 'logo.png' });
export const bannerFile = () => new AttachmentBuilder('assets/banner.png', { name: 'banner.png' });

/** Embed padrão da Paany. Lembre de anexar logoFile() na mensagem. */
export function baseEmbed(title, { color = COLORS.main, thumb = true } = {}) {
  const e = new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: `${config.botName} • ${config.storeName}`, iconURL: 'attachment://logo.png' })
    .setTimestamp();
  if (title) e.setTitle(title);
  if (thumb) e.setThumbnail('attachment://logo.png');
  return e;
}

/** Resposta curta (erro/sucesso) sem imagens. */
export function notice(text, kind = 'info') {
  const prefix = kind === 'ok' ? `${ICON.ok} ` : kind === 'error' ? `${ICON.no} ` : '';
  return new EmbedBuilder()
    .setColor(kind === 'error' ? COLORS.dark : COLORS.main)
    .setDescription(prefix + text);
}
