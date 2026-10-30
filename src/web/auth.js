// Login do painel com Discord (OAuth2) e sessão em cookie assinado.
// Só entra quem está em ADMIN_IDS — e isso é conferido em TODA requisição.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { isAdmin } from '../util.js';

const SESSION_COOKIE = 'paany_s';
const STATE_COOKIE = 'paany_st';
const SESSION_HOURS = 12;

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
const sign = (data) => createHmac('sha256', config.panelSecret).update(data).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const secure = () => (config.publicUrl || '').startsWith('https://');
export function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure() ? '; Secure' : ''}`;
}

/* -------------------------------- Sessão -------------------------------- */

export function createSession(user) {
  const payload = b64(JSON.stringify({
    u: user.id, n: user.global_name || user.username, a: user.avatar || null, exp: Date.now() + SESSION_HOURS * 3600_000,
  }));
  return cookie(SESSION_COOKIE, `${payload}.${sign(payload)}`, SESSION_HOURS * 3600);
}

export const clearSession = () => cookie(SESSION_COOKIE, '', 0);

/** Lê e valida a sessão. Retorna null se inválida, expirada ou se não é mais admin. */
export function readSession(req) {
  const raw = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!raw || !raw.includes('.')) return null;
  const [payload, sig] = raw.split('.');
  if (!safeEqual(sig, sign(payload))) return null;
  let data;
  try { data = JSON.parse(unb64(payload)); } catch { return null; }
  if (!data?.u || data.exp < Date.now() || !isAdmin(data.u)) return null;
  return { id: data.u, name: data.n, avatar: data.a, csrf: sign(`csrf:${payload}`) };
}

/** Proteção contra CSRF: header com token da sessão + mesma origem. */
export function checkCsrf(req, session) {
  const token = req.headers['x-csrf-token'];
  if (!token || !safeEqual(token, session.csrf)) return false;
  const origin = req.headers.origin;
  if (origin && config.publicUrl && origin !== new URL(config.publicUrl).origin) return false;
  return true;
}

/* -------------------------------- OAuth2 -------------------------------- */

const redirectUri = () => `${config.publicUrl}/auth/callback`;

export function loginRedirect() {
  const state = randomBytes(16).toString('hex');
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: 'identify', state, prompt: 'none',
  }).toString();
  return { url: url.toString(), cookie: cookie(STATE_COOKIE, state, 600) };
}

/** Troca o código pelo usuário do Discord. Lança erro se algo não bater. */
export async function finishLogin(req, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
  if (!code || !state || !expected || !safeEqual(state, expected)) throw new Error('Sessão de login inválida. Tente de novo.');

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri(),
    }),
  });
  if (!tokenRes.ok) throw new Error('O Discord recusou o login. Confira o Client Secret e o Redirect.');
  const { access_token: accessToken } = await tokenRes.json();

  const meRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!meRes.ok) throw new Error('Não consegui ler sua conta do Discord.');
  return meRes.json();
}

export const clearState = () => cookie(STATE_COOKIE, '', 0);
