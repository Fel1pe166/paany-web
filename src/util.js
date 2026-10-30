import { randomBytes } from 'node:crypto';
import { config } from './config.js';

export const brl = (cents) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Converte "12,90" / "12.90" / "R$ 12,90" em centavos. Retorna null se inválido. */
export function parsePrice(input) {
  if (input == null) return null;
  let s = String(input).replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  return Math.round(n * 100);
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newOrderId() {
  const bytes = randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALPHA[b % ALPHA.length];
  return `CUT-${s}`;
}

export const now = () => Date.now();
export const ts = (ms) => `<t:${Math.floor(ms / 1000)}:f>`;
export const rel = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

export const isAdmin = (userId) => config.adminIds.includes(userId);

/** Membro da equipe: admin ou quem tem o cargo de staff. */
export function isStaff(member) {
  if (!member) return false;
  if (isAdmin(member.id ?? member.user?.id)) return true;
  if (!config.staffRoleId) return false;
  const roles = member.roles?.cache ?? member.roles;
  return Array.isArray(roles) ? roles.includes(config.staffRoleId) : Boolean(roles?.has?.(config.staffRoleId));
}

// Anti-spam simples por usuário e ação
const hits = new Map();
export function cooldown(userId, key, ms) {
  const k = `${userId}:${key}`;
  const last = hits.get(k) || 0;
  const t = Date.now();
  if (t - last < ms) return Math.ceil((ms - (t - last)) / 1000);
  hits.set(k, t);
  if (hits.size > 5000) for (const [kk, v] of hits) if (t - v > 600000) hits.delete(kk);
  return 0;
}

export const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

export const isHttpUrl = (s) => {
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
};
