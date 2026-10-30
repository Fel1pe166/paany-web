// Aparência e opções do painel de tickets, editáveis pelo admin (Discord ou painel web).
import { audit, getSetting, setSetting } from '../db.js';

export const BUILTIN_REASONS = {
  duvida: { label: 'Dúvidas sobre produtos', description: 'Antes de comprar, tire suas dúvidas', emoji: '❔' },
  pagamento: { label: 'Problemas com pagamento', description: 'Pix, cobrança ou valor', emoji: '💳' },
  nao_recebido: { label: 'Produto não recebido', description: 'Paguei e não chegou', emoji: '📦' },
  reembolso: { label: 'Solicitação de reembolso', description: 'Pedir o dinheiro de volta', emoji: '↩️' },
  vip: { label: 'Problemas com VIP', description: 'Cargo, acesso ou vencimento', emoji: '👑' },
  outros: { label: 'Outros assuntos', description: 'Qualquer outra coisa', emoji: '💬' },
};
// Motivo interno (canal do comprovante de Pix manual): nunca aparece no menu
export const INTERNAL_REASONS = { comprovante: 'Comprovante de Pix manual' };
export const MAX_OPTIONS = 20;

export const DEFAULT_TICKET_CONFIG = {
  panel: {
    title: 'Central de suporte',
    description: 'Precisa de ajuda? Escolha o assunto abaixo e um canal privado será aberto com a equipe.\n\nTenha em mãos o **ID do pedido** (ex.: `CUT-ABCD1234`), se houver.',
    color: '#f2f2f2',
    banner: '',
    thumbnail: true,
    placeholder: 'Sobre o que você precisa de ajuda?',
    footer: '',
  },
  welcome: {
    title: 'Atendimento • {motivo}',
    message: 'Olá {usuario}! Explique o que aconteceu e a equipe vai te responder aqui.\nNunca envie senhas ou dados de cartão. A equipe **nunca** pede pagamento por fora da loja.',
  },
  rating: {
    enabled: true,
    message: 'Seu atendimento foi encerrado. Como a equipe se saiu? Sua nota ajuda a melhorar o suporte.',
  },
  options: Object.entries(BUILTIN_REASONS).map(([value, o]) => ({ value, ...o, enabled: true })),
};

const clone = (o) => JSON.parse(JSON.stringify(o));
export const HEX = /^#[0-9a-f]{6}$/i;
export const isUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
export const colorInt = (hex, fallback = 0xf2f2f2) => (HEX.test(hex || '') ? parseInt(hex.slice(1), 16) : fallback);

/** Emoji Unicode ("🎫") ou personalizado ("<:nome:123>") → formato da API do Discord. */
export function parseEmoji(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const custom = /^<(a?):(\w{2,32}):(\d{15,25})>$/.exec(s);
  if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === 'a' };
  if (s.length <= 16 && !/[\w\s<>:]/.test(s)) return { name: s };
  return null;
}

export function getTicketConfig() {
  const raw = getSetting('ticket_config');
  if (!raw) return clone(DEFAULT_TICKET_CONFIG);
  try {
    const saved = JSON.parse(raw);
    const d = clone(DEFAULT_TICKET_CONFIG);
    return {
      panel: { ...d.panel, ...saved.panel },
      welcome: { ...d.welcome, ...saved.welcome },
      rating: { ...d.rating, ...saved.rating },
      options: Array.isArray(saved.options) && saved.options.length ? saved.options : d.options,
    };
  } catch {
    return clone(DEFAULT_TICKET_CONFIG);
  }
}

const str = (v, max) => String(v ?? '').slice(0, max);

/**
 * Valida e salva (mescla com o que já existe). Lança Error com mensagem clara se algo estiver errado.
 */
export function saveTicketConfig(input, actorId) {
  const cur = getTicketConfig();
  const next = clone(cur);
  if (input.panel) {
    const p = input.panel;
    if (p.title !== undefined) next.panel.title = str(p.title, 256).trim() || DEFAULT_TICKET_CONFIG.panel.title;
    if (p.description !== undefined) next.panel.description = str(p.description, 4000);
    if (p.color !== undefined) {
      if (p.color && !HEX.test(p.color)) throw new Error('Cor inválida. Use o formato #RRGGBB.');
      next.panel.color = p.color || DEFAULT_TICKET_CONFIG.panel.color;
    }
    if (p.banner !== undefined) {
      const b = str(p.banner, 500).trim();
      if (b && !isUrl(b)) throw new Error('O banner precisa ser um link https://.');
      next.panel.banner = b;
    }
    if (p.thumbnail !== undefined) next.panel.thumbnail = Boolean(p.thumbnail);
    if (p.placeholder !== undefined) next.panel.placeholder = str(p.placeholder, 150).trim() || DEFAULT_TICKET_CONFIG.panel.placeholder;
    if (p.footer !== undefined) next.panel.footer = str(p.footer, 200);
  }
  if (input.welcome) {
    if (input.welcome.title !== undefined) next.welcome.title = str(input.welcome.title, 200).trim() || DEFAULT_TICKET_CONFIG.welcome.title;
    if (input.welcome.message !== undefined) next.welcome.message = str(input.welcome.message, 2000).trim() || DEFAULT_TICKET_CONFIG.welcome.message;
  }
  if (input.rating) {
    if (input.rating.enabled !== undefined) next.rating.enabled = Boolean(input.rating.enabled);
    if (input.rating.message !== undefined) next.rating.message = str(input.rating.message, 1000).trim() || DEFAULT_TICKET_CONFIG.rating.message;
  }
  if (input.options) {
    if (!Array.isArray(input.options)) throw new Error('Lista de opções inválida.');
    if (input.options.length > MAX_OPTIONS) throw new Error(`Use no máximo ${MAX_OPTIONS} opções.`);
    const used = new Set();
    let n = 0;
    next.options = input.options.map((o) => {
      const label = str(o.label, 100).trim();
      if (!label) throw new Error('Toda opção precisa de um nome.');
      let value = String(o.value || '').trim();
      if (!value || (!BUILTIN_REASONS[value] && !/^c\d{1,3}$/.test(value)) || used.has(value)) {
        do { n += 1; value = `c${n}`; } while (used.has(value) || input.options.some((x) => x.value === value && x !== o));
      }
      used.add(value);
      const emoji = str(o.emoji, 64).trim();
      if (emoji && !parseEmoji(emoji)) throw new Error(`Emoji inválido em "${label}". Use um emoji comum ou <:nome:id>.`);
      return { value, label, description: str(o.description, 100).trim(), emoji, enabled: o.enabled !== false };
    });
    if (!next.options.some((o) => o.enabled)) throw new Error('Deixe pelo menos uma opção ativa.');
  }
  setSetting('ticket_config', JSON.stringify(next));
  audit(actorId, 'tickets.personalizar', Object.keys(input).join(', '));
  return next;
}

export const resetTicketConfig = (actorId) => {
  setSetting('ticket_config', null);
  audit(actorId, 'tickets.restaurar', 'padrão');
  return getTicketConfig();
};

/** Nome do motivo (inclui motivos internos e opções que foram removidas depois). */
export function reasonLabel(key) {
  if (INTERNAL_REASONS[key]) return INTERNAL_REASONS[key];
  const o = getTicketConfig().options.find((x) => x.value === key);
  return o?.label || BUILTIN_REASONS[key]?.label || key;
}
export const enabledOptions = () => getTicketConfig().options.filter((o) => o.enabled);

/** Troca {usuario}, {motivo} e {servidor} nos textos de boas-vindas. */
export const fillTemplate = (text, vars) => String(text).replace(/\{(usuario|motivo|servidor)\}/g, (_, k) => vars[k] ?? '');
