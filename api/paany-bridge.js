// Ponte da Vercel → bot na Discloud.
// A Vercel entrega as telas do painel (arquivos estáticos) e esta função repassa
// login, API, imagens e webhook para o bot. Assim navegador e painel ficam no mesmo
// domínio (cookies de sessão e proteção CSRF funcionam normalmente).
//
// Variáveis de ambiente na Vercel:
//   BOT_URL        → endereço do bot na Discloud, ex.: https://paany.discloud.app
//   BRIDGE_SECRET  → a mesma senha configurada no .env do bot

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'proxy-authorization',
  'te', 'trailer', 'host', 'content-length', 'accept-encoding', 'x-paany-bridge',
]);
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'set-cookie']);
const FIXED_ROUTES = new Set(['/login', '/logout', '/auth/callback', '/webhook/mercadopago']);
const INTERNAL_PARAMS = ['bridgepath', 'base', 'to'];

function failure(request, status, title, message) {
  const wantsJson = new URL(request.url).searchParams.get('base') === 'api';
  if (wantsJson) {
    return new Response(JSON.stringify({ error: `${title}. ${message}` }), {
      status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/painel/app.css"></head><body class="center-page">
<main class="login-card"><img src="/painel/logo.png" alt="" width="72" height="72"><h1>${esc(title)}</h1><p>${esc(message)}</p>
<a class="btn primary" href="/painel">Tentar de novo</a></main></body></html>`, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Descobre o caminho original a partir dos parâmetros colocados pelos rewrites do vercel.json. */
export function targetPath(url) {
  const base = url.searchParams.get('base');
  const p = url.searchParams.get('bridgepath') || '';
  const to = url.searchParams.get('to');
  if (to && FIXED_ROUTES.has(to)) return to;
  if (base === 'img' && /^[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(p)) return `/img/${p}`;
  if (base === 'api' && /^[\w./%-]*$/.test(p) && !p.includes('..')) return `/api/${p}`;
  return null;
}

export async function handle(request) {
  const botUrl = (process.env.BOT_URL || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(botUrl)) {
    return failure(request, 500, 'Painel sem conexão configurada', 'Defina a variável BOT_URL na Vercel com o endereço do bot na Discloud.');
  }
  const url = new URL(request.url);
  const path = targetPath(url);
  if (!path) return failure(request, 404, 'Não encontrado', 'Essa página não existe.');

  const query = new URLSearchParams(url.search);
  for (const k of INTERNAL_PARAMS) query.delete(k);
  const qs = query.toString();

  const headers = new Headers();
  for (const [k, v] of request.headers) if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  const clientIp = (request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '').split(',')[0].trim();
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', 'https');
  if (process.env.BRIDGE_SECRET) headers.set('x-paany-bridge', process.env.BRIDGE_SECRET);

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  let upstream;
  try {
    upstream = await fetch(`${botUrl}${path}${qs ? `?${qs}` : ''}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    const timeout = e?.name === 'TimeoutError';
    return failure(request, timeout ? 504 : 502, timeout ? 'O bot demorou para responder' : 'O bot está offline',
      timeout ? 'Tente de novo em instantes.' : 'Não consegui falar com o bot na Discloud. Confira se ele está ligado e se BOT_URL está certo.');
  }

  const out = new Headers();
  for (const [k, v] of upstream.headers) if (!DROP_RESPONSE.has(k.toLowerCase())) out.set(k, v);
  for (const c of upstream.headers.getSetCookie?.() || []) out.append('set-cookie', c);
  return new Response(request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304 ? null : upstream.body, {
    status: upstream.status, headers: out,
  });
}

export default { fetch: handle };
