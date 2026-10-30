// Servidor HTTP da Paany: painel web, API, imagens dos produtos e webhook do Mercado Pago.
// Sem dependências externas (node:http + node:zlib).
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { config, features } from '../config.js';
import { audit } from '../db.js';
import { isAdmin } from '../util.js';
import { makeBackup } from '../services/backup.js';
import { logError } from '../services/logger.js';
import { handleMpWebhook } from '../services/webhook.js';
import {
  checkCsrf, clearSession, clearState, createSession, finishLogin, loginRedirect, readSession,
} from './auth.js';
import { exportCsv, HttpError, routeApi, UPLOAD_DIR } from './api.js';
import { langOf, tr } from './i18n.js';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const ASSETS_DIR = fileURLToPath(new URL('../../assets/', import.meta.url));

const STATIC = {
  '/painel/app.js': [PUBLIC_DIR, 'app.js', 'text/javascript; charset=utf-8'],
  '/painel/i18n.js': [PUBLIC_DIR, 'i18n.js', 'text/javascript; charset=utf-8'],
  '/painel/app.css': [PUBLIC_DIR, 'app.css', 'text/css; charset=utf-8'],
  '/painel/manifest.webmanifest': [PUBLIC_DIR, 'manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/painel/logo.png': [ASSETS_DIR, 'logo.png', 'image/png'],
};
const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const COMPRESSIBLE = /^(text\/|application\/(json|manifest|javascript)|image\/svg)/;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
const PANEL_CSP = "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const isHttps = () => (config.publicUrl || '').startsWith('https://');

/** Envia a resposta, comprimindo com gzip quando o navegador aceita e vale a pena. */
function send(req, res, status, body, headers = {}) {
  const h = { ...SECURITY_HEADERS, ...headers };
  if (isHttps()) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  let buf = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const type = String(h['Content-Type'] || '');
  if (buf.length > 1024 && COMPRESSIBLE.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = gzipSync(buf, { level: 6 });
    h['Content-Encoding'] = 'gzip';
    h.Vary = 'Accept-Encoding';
  }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

/** Traduz os campos de mensagem antes de responder. */
function json(req, res, status, data, extra = {}) {
  const lang = langOf(req);
  let out = data;
  if (data && typeof data === 'object' && !Array.isArray(data) && (data.error || data.message)) {
    out = { ...data };
    if (out.error) out.error = tr(out.error, lang);
    if (out.message) out.message = tr(out.message, lang);
  }
  return send(req, res, status, JSON.stringify(out), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
}
const redirect = (req, res, to, cookies = []) => send(req, res, 302, '', { Location: to, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(req, title, message, link = null) {
  const L = langOf(req);
  const t = (s) => escHtml(tr(s, L));
  return `<!doctype html><html lang="${L === 'pt' ? 'pt-BR' : L}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><title>${t(title)}</title><link rel="stylesheet" href="/painel/app.css"></head><body class="center-page">
<main class="login-card"><img src="/painel/logo.png" alt="" width="72" height="72"><h1>${t(title)}</h1><p>${t(message)}</p>
${link ? `<a class="btn primary" href="${escHtml(link.href)}">${t(link.label)}</a>` : ''}</main></body></html>`;
}
const html = (req, res, status, body, extra = {}) => send(req, res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra });

/** Lê o corpo com limite de tamanho. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Conteúdo grande demais.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Limite de requisições por IP e por minuto (proteção simples contra abuso)
const hits = new Map();
const clientIp = (req) => (process.env.TRUST_PROXY !== 'false' && req.headers['x-forwarded-for']
  ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
  : req.socket.remoteAddress || '');
function rateLimited(req, max = 300, scope = 'all') {
  const minute = Math.floor(Date.now() / 60000);
  const key = `${scope}:${clientIp(req)}:${minute}`;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 10000) for (const k of hits.keys()) if (!k.endsWith(`:${minute}`)) hits.delete(k);
  return n > max;
}

// Arquivos do painel em memória, com ETag (o navegador só baixa de novo quando mudam)
const staticCache = new Map();
function serveStatic(req, res, [dir, file, type]) {
  const full = join(dir, file);
  const mtime = statSync(full).mtimeMs;
  let entry = staticCache.get(full);
  if (!entry || entry.mtime !== mtime) {
    const body = readFileSync(full);
    entry = { body, mtime, etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 16)}"` };
    staticCache.set(full, entry);
  }
  if (req.headers['if-none-match'] === entry.etag) return send(req, res, 304, null, { ETag: entry.etag });
  return send(req, res, 200, entry.body, { 'Content-Type': type, ETag: entry.etag, 'Cache-Control': 'no-cache' });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const isGet = req.method === 'GET' || req.method === 'HEAD';

  if (rateLimited(req)) return json(req, res, 429, { error: 'Muitas requisições. Aguarde um minuto.' });

  // Saúde e webhook
  if (isGet && (path === '/' || path === '/healthz')) {
    if (path === '/' && features.panel) return redirect(req, res, '/painel');
    return send(req, res, 200, `${config.botName} online`, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (req.method === 'POST' && path === '/webhook/mercadopago') {
    const body = await readBody(req, 64 * 1024);
    return handleMpWebhook(req, res, url, body);
  }

  // Imagens enviadas pelo painel (públicas, para aparecerem nas mensagens do Discord)
  const img = path.match(/^\/img\/([a-f0-9]{24})\.(png|jpg|gif|webp)$/);
  if (isGet && img) {
    const file = join(UPLOAD_DIR(), `${img[1]}.${img[2]}`);
    if (!existsSync(file)) return send(req, res, 404, '');
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': IMG_TYPES[img[2]], 'Content-Length': statSync(file).size, 'Cache-Control': 'public, max-age=31536000, immutable' });
    return req.method === 'HEAD' ? res.end() : createReadStream(file).pipe(res);
  }

  // Arquivos estáticos do painel (não contêm dados)
  if (isGet && STATIC[path]) return serveStatic(req, res, STATIC[path]);

  if (!features.panel) {
    if (path.startsWith('/painel') || path.startsWith('/api') || path === '/login') {
      return html(req, res, 503, page(req, 'Painel desligado', 'Configure PUBLIC_URL, DISCORD_CLIENT_SECRET e PANEL_SECRET no .env para ligar o painel.'));
    }
    return send(req, res, 404, '');
  }

  // Login com Discord
  if (isGet && path === '/login') {
    if (rateLimited(req, 20, 'login')) return html(req, res, 429, page(req, 'Não deu certo', 'Muitas tentativas de login.'));
    const { url: to, cookie } = loginRedirect();
    return redirect(req, res, to, [cookie]);
  }
  if (isGet && path === '/auth/callback') {
    if (url.searchParams.get('error')) return redirect(req, res, '/login');
    try {
      const user = await finishLogin(req, url);
      if (!isAdmin(user.id)) {
        audit(user.id, 'painel.acesso_negado', user.username);
        return html(req, res, 403, page(req, 'Acesso negado', 'Sua conta do Discord não está na lista de administradores da loja.'), { 'Set-Cookie': [clearState()] });
      }
      audit(user.id, 'painel.login', user.username);
      return redirect(req, res, '/painel', [createSession(user), clearState()]);
    } catch (e) {
      return html(req, res, 400, page(req, 'Não deu certo', e.message, { href: '/login', label: 'Tentar de novo' }));
    }
  }
  if (path === '/logout') return redirect(req, res, '/', [clearSession()]);

  const session = readSession(req);

  // Página do painel (app de página única)
  if (isGet && (path === '/painel' || path.startsWith('/painel/'))) {
    if (!session) return redirect(req, res, '/login');
    return html(req, res, 200, readFileSync(join(PUBLIC_DIR, 'index.html')), { 'Content-Security-Policy': PANEL_CSP });
  }

  // API
  if (path.startsWith('/api/')) {
    if (!session) return json(req, res, 401, { error: 'Sessão expirada. Entre de novo.' });
    if (isGet && path === '/api/export.csv') {
      audit(session.id, 'painel.exportar', url.search);
      return send(req, res, 200, exportCsv(url.searchParams), {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="vendas-cutify.csv"', 'Cache-Control': 'no-store',
      });
    }
    if (isGet && path === '/api/backup') {
      if (rateLimited(req, 5, 'backup')) return json(req, res, 429, { error: 'Muitas requisições. Aguarde um minuto.' });
      const file = makeBackup();
      audit(session.id, 'backup.gerar', `${basename(file)} (painel web)`);
      return send(req, res, 200, readFileSync(file), {
        'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${basename(file)}"`, 'Cache-Control': 'no-store',
      });
    }
    let body = {};
    if (!isGet) {
      if (!checkCsrf(req, session)) return json(req, res, 403, { error: 'Requisição bloqueada (CSRF). Recarregue a página.' });
      if (!String(req.headers['content-type'] || '').includes('application/json')) return json(req, res, 415, { error: 'Use JSON.' });
      const raw = await readBody(req, path === '/api/upload' ? 5 * 1024 * 1024 : 200 * 1024);
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json(req, res, 400, { error: 'JSON inválido.' }); }
    }
    const data = await routeApi(req.method === 'HEAD' ? 'GET' : req.method, path, url.searchParams, body, session);
    return json(req, res, 200, data);
  }

  return html(req, res, 404, page(req, 'Não encontrado', 'Essa página não existe.', { href: '/painel', label: 'Ir para o painel' }));
}

export function startWebServer() {
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) logError(`painel ${req.method} ${req.url}`, e);
      if (res.headersSent) return res.end();
      return json(req, res, status, { error: status === 500 ? 'Erro interno. A equipe foi avisada nos logs.' : e.message });
    });
  });
  server.keepAliveTimeout = 65_000;
  server.requestTimeout = 30_000;
  server.listen(config.port, () => console.log(`[web] porta ${config.port}${features.panel ? ` • painel em ${config.publicUrl}/painel` : ''}`));
  server.on('error', (e) => console.warn('[web] servidor HTTP não iniciou:', e.message));
  return server;
}
