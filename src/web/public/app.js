// Painel da Paany — app de página única, sem frameworks e sem build.
// Regras: todo texto vindo do banco passa por esc(); todo texto da interface passa por t().
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const view = $('#view');
  const drawer = $('#drawer');
  const drawerBody = $('#drawer-body');
  let ME = null;

  /* ============================== Preferências ============================== */

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
  };
  const DICT = window.PAANY_I18N || {};
  const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };
  const guessLang = () => {
    const n = (navigator.language || 'pt').slice(0, 2);
    return DICT[n] ? n : 'pt';
  };
  let LANG = store.get('paany_lang', null) || guessLang();
  if (!DICT[LANG]) LANG = 'pt';

  /** Texto traduzido. {chave} no texto é trocado por vars.chave. */
  function t(key, vars = {}) {
    const s = DICT[LANG]?.[key] ?? DICT.pt?.[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  }
  const plural = (n, one, many) => t(n === 1 ? one : many, { n: fmtNum(n) });

  function setLang(l) {
    if (!DICT[l]) return;
    LANG = l;
    store.set('paany_lang', l);
    document.cookie = `paany_lang=${l}; Path=/; Max-Age=31536000; SameSite=Lax`;
    applyChrome();
    route();
  }

  const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  let THEME = store.get('paany_theme', null) || (prefersDark() ? 'dark' : 'light');
  function setTheme(th) {
    THEME = th;
    store.set('paany_theme', th);
    document.documentElement.dataset.theme = th;
    $('#theme-btn').innerHTML = icon(th === 'dark' ? 'sun' : 'moon');
    $('#theme-btn').setAttribute('aria-label', t(th === 'dark' ? 'theme.light' : 'theme.dark'));
    $('#theme-btn').title = t(th === 'dark' ? 'theme.light' : 'theme.dark');
  }
  document.documentElement.dataset.theme = THEME;

  /* ============================== Formatação ============================== */

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const loc = () => LOCALES[LANG];
  const brl = (c) => ((c || 0) / 100).toLocaleString(loc(), { style: 'currency', currency: 'BRL', currencyDisplay: 'narrowSymbol' });
  const brlShort = (c) => {
    const v = (c || 0) / 100;
    return v >= 10000 ? v.toLocaleString(loc(), { style: 'currency', currency: 'BRL', currencyDisplay: 'narrowSymbol', notation: 'compact', maximumFractionDigits: 1 }) : brl(c);
  };
  const fmtNum = (n) => Number(n || 0).toLocaleString(loc());
  const pct = (x, digits = 0) => (x == null ? '—' : (x).toLocaleString(loc(), { style: 'percent', maximumFractionDigits: digits }));
  const dt = (ms) => (ms ? new Date(ms).toLocaleString(loc(), { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const dshort = (ms) => (ms ? new Date(ms).toLocaleDateString(loc(), { day: '2-digit', month: 'short' }) : '—');
  const ago = (ms) => {
    if (!ms) return '—';
    const s = Math.round((Date.now() - ms) / 1000);
    const f = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
    const a = Math.abs(s);
    if (a < 60) return f.format(-s, 'second');
    if (a < 3600) return f.format(-Math.round(s / 60), 'minute');
    if (a < 86400) return f.format(-Math.round(s / 3600), 'hour');
    if (a < 86400 * 30) return f.format(-Math.round(s / 86400), 'day');
    return dt(ms);
  };
  const until = (ms) => {
    const s = Math.round((ms - Date.now()) / 1000);
    const f = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
    if (Math.abs(s) < 3600) return f.format(Math.round(s / 60), 'minute');
    if (Math.abs(s) < 86400) return f.format(Math.round(s / 3600), 'hour');
    return f.format(Math.round(s / 86400), 'day');
  };
  const duration = (sec) => {
    const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  };
  const bytes = (b) => (b == null ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  const statusLabel = (s) => t(`status.${s}`);
  const methodLabel = (m) => t(`method.${m}`);
  const catLabel = (c) => t(`cat.${c}`);
  const who = (id, name) => (name ? esc(name) : `<span class="mono">${esc(id || '—')}</span>`);
  const initials = (name) => esc((name || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase());
  // Sem nome conhecido, mostra um ícone em vez de dígitos do ID
  const avatarDot = (name) => `<span class="av" aria-hidden="true">${name && initials(name) ? initials(name) : icon('users')}</span>`;
  const STATUS_KIND = {
    entregue: 'ok', pago: 'ok', aguardando_pagamento: 'wait', em_analise: 'warn', processando: 'wait', reembolso_solicitado: 'warn',
    falha_entrega: 'bad', cancelado: 'off', expirado: 'off', reembolsado: 'off',
  };
  const pill = (status) => `<span class="pill ${STATUS_KIND[status] || ''}"><i></i>${esc(statusLabel(status))}</span>`;

  /* ============================== Ícones ============================== */

  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    box: '<path d="m3 7 9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.6 5.2"/>',
    coupon: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="m9.5 14.5 5-5"/><circle cx="9.5" cy="9.5" r=".6"/><circle cx="14.5" cy="14.5" r=".6"/>',
    crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    ticket: '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.4A8.5 8.5 0 1 1 21 12z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    play: '<path d="M7 5v14l12-7z"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.7 5.7 3.7 9s-1.2 6.3-3.7 9c-2.5-2.7-3.7-5.7-3.7-9S9.5 5.7 12 3z"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 20h8M10 17h4v3h-4z"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  /* ============================== Infra ============================== */

  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `${icon(kind === 'err' ? 'alert' : 'check')}<span></span>`;
    el.querySelector('span').textContent = msg;
    $('#toasts').append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, kind === 'err' ? 6500 : 3500);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'X-Lang': LANG };
    if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': ME?.csrf || '' });
    let res;
    try {
      res = await fetch(`/api/${path}`, { method, credentials: 'same-origin', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error(t('err.network'));
    }
    if (res.status === 401) { location.href = '/login'; throw new Error(t('err.session')); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${t('err.generic')} (${res.status})`);
    return data;
  }

  function setTitle(key, actions = '') {
    $('#page-title').textContent = t(key);
    $('#top-actions').innerHTML = actions;
    $('#top-actions').hidden = !actions;
    document.title = `${PENDING ? `(${PENDING}) ` : ''}${t(key)} • ${ME?.store.name || 'Cutify'}`;
  }
  const skel = (n = 4, cls = 'kpi') => `<div class="grid ${cls === 'kpi' ? 'kpis' : ''}">${'<div class="skeleton"></div>'.repeat(n)}</div>`;
  const loading = () => { view.innerHTML = skel(); };
  const failed = (e) => { view.innerHTML = emptyState('alert', t('err.load'), esc(e.message), `<button class="btn" data-act="reload">${t('act.retry')}</button>`); };
  const emptyState = (ic, title, text = '', action = '') =>
    `<div class="empty">${icon(ic, 'big')}<strong>${title}</strong>${text ? `<p>${text}</p>` : ''}${action}</div>`;

  function openDrawer(html) {
    drawerBody.innerHTML = html;
    if (!drawer.open) drawer.showModal();
    drawerBody.scrollTop = 0;
  }
  const closeDrawer = () => drawer.open && drawer.close();
  for (const d of ['#drawer', '#sheet', '#modal', '#palette']) {
    $(d).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  }
  const drawerHead = (eyebrow, title) => `<div class="drawer-head"><div>${eyebrow ? `<div class="eyebrow mono">${eyebrow}</div>` : ''}<h2>${title}</h2></div>
    <button class="icon-btn" data-act="close" aria-label="${t('act.close')}">${icon('x')}</button></div>`;

  /** Diálogo de confirmação (substitui o confirm() do navegador). */
  function ask({ title, body = '', confirm = t('act.confirm'), danger = false, input = null }) {
    const m = $('#modal');
    $('#modal-body').innerHTML = `<h3>${title}</h3>${body ? `<p>${body}</p>` : ''}
      ${input ? `<label class="field">${input.label}<${input.multiline ? 'textarea' : 'input'} id="modal-input" maxlength="${input.max || 300}" ${input.required ? 'required' : ''}>${input.multiline ? '</textarea>' : ''}</label>` : ''}
      <div class="actions end"><button class="btn" value="cancel" type="submit">${t('act.cancel')}</button>
      <button class="btn ${danger ? 'danger solid' : 'primary'}" value="ok" type="submit">${confirm}</button></div>`;
    m.returnValue = '';
    m.showModal();
    $('#modal-input')?.focus();
    return new Promise((resolve) => {
      m.addEventListener('close', () => {
        if (m.returnValue !== 'ok') return resolve(input ? null : false);
        return resolve(input ? ($('#modal-input')?.value.trim() ?? '') : true);
      }, { once: true });
    });
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast(t('msg.copied')); } catch { toast(text); }
  }

  /* ============================== Gráficos ============================== */

  /** Gráfico de área com tooltip ao passar o mouse/dedo. */
  function areaChart(series, key = 'total') {
    const W = 760; const H = 240; const P = { l: 6, r: 6, t: 16, b: 26 };
    const vals = series.map((s) => s[key]);
    const max = Math.max(...vals, key === 'total' ? 1000 : 4) * 1.1;
    const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(series.length - 1, 1);
    const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
    const pts = series.map((s, i) => [x(i), y(s[key])]);
    const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
    const area = `${line}L${x(series.length - 1).toFixed(1)},${H - P.b}L${x(0).toFixed(1)},${H - P.b}Z`;
    const step = Math.ceil(series.length / 7);
    const labels = series.map((s, i) => (i % step === 0 || i === series.length - 1
      ? `<text class="axis" x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}">${dshort(Date.parse(`${s.day}T12:00:00`))}</text>` : '')).join('');
    const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line class="gridline" x1="${P.l}" x2="${W - P.r}" y1="${y(max * f / 1.1).toFixed(1)}" y2="${y(max * f / 1.1).toFixed(1)}"/>`).join('');
    const yl = [0.5, 1].map((f) => `<text class="axis" x="${P.l + 2}" y="${(y(max * f / 1.1) - 5).toFixed(1)}">${key === 'total' ? brlShort(max * f / 1.1) : Math.round(max * f / 1.1)}</text>`).join('');
    return `<div class="chart-wrap" data-chart='${esc(JSON.stringify({ pts: pts.map(([a, b]) => [a / W, b / H]), series, key }))}'>
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('home.revenue')}">
        <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
        ${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${labels}${yl}
      </svg><div class="chart-cursor" hidden><i></i><div class="tip"></div></div></div>`;
  }
  function bindCharts(root = view) {
    $$('.chart-wrap', root).forEach((wrap) => {
      const data = JSON.parse(wrap.dataset.chart);
      const cur = $('.chart-cursor', wrap);
      const move = (clientX) => {
        const r = wrap.getBoundingClientRect();
        const fx = (clientX - r.left) / r.width;
        let best = 0;
        data.pts.forEach(([px], i) => { if (Math.abs(px - fx) < Math.abs(data.pts[best][0] - fx)) best = i; });
        const s = data.series[best];
        const [px, py] = data.pts[best];
        cur.hidden = false;
        cur.style.left = `${px * 100}%`;
        $('i', cur).style.top = `${py * 100}%`;
        $('.tip', cur).innerHTML = `<b>${dshort(Date.parse(`${s.day}T12:00:00`))}</b><span>${brl(s.total)}</span><small>${plural(s.orders, 'n.sale', 'n.sales')}</small>`;
        $('.tip', cur).classList.toggle('left', px > 0.7);
      };
      wrap.addEventListener('pointermove', (e) => move(e.clientX));
      wrap.addEventListener('pointerdown', (e) => move(e.clientX));
      wrap.addEventListener('pointerleave', () => { cur.hidden = true; });
    });
  }
  function sparkline(vals) {
    if (!vals.length) return '';
    const W = 100; const H = 28; const max = Math.max(...vals, 1);
    const d = vals.map((v, i) => `${i ? 'L' : 'M'}${((i * W) / Math.max(vals.length - 1, 1)).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  function delta(cur, prev) {
    if (!prev) return cur ? `<span class="delta up">${icon('up')}${t('home.new')}</span>` : '';
    const d = (cur - prev) / prev;
    if (Math.abs(d) < 0.005) return '<span class="delta">0%</span>';
    return `<span class="delta ${d > 0 ? 'up' : 'down'}">${icon(d > 0 ? 'up' : 'down')}${pct(Math.abs(d))}</span>`;
  }
  const hbars = (rows) => {
    const max = Math.max(...rows.map((r) => r.value), 1);
    return `<div class="hbars">${rows.map((r) => `<div class="hbar"><div class="hbar-top"><span>${esc(r.label)}</span><span class="mono">${r.text}</span></div>
      <div class="hbar-track"><i style="width:${Math.max((r.value / max) * 100, 2).toFixed(1)}%"></i></div></div>`).join('')}</div>`;
  };

  /* ============================== Visão geral ============================== */

  let homeDays = Number(store.get('paany_days', 30)) || 30;
  async function pageHome() {
    setTitle('nav.home', `<a class="btn" href="/api/export.csv?days=${homeDays}">${icon('download')}<span>${t('act.export')}</span></a>`);
    loading();
    const d = await api(`dashboard?days=${homeDays}`);
    const p = d.period;
    const avg = p.vendas ? Math.round(p.bruto / p.vendas) : 0;
    const prevAvg = d.previous.vendas ? Math.round(d.previous.bruto / d.previous.vendas) : 0;
    const methods = d.byMethod.reduce((m, r) => ((m[r.method] = r), m), {});
    const methodTotal = d.byMethod.reduce((s, r) => s + r.t, 0) || 1;
    view.innerHTML = `
      ${(d.total.review || d.total.failures || d.lowStock.length) ? `<div class="alerts">
        ${d.total.review ? `<a class="alert warn" href="#/pedidos?status=em_analise">${icon('alert')}<span>${plural(d.total.review, 'home.alert.review1', 'home.alert.reviewN')}</span><b>${t('act.review')} →</b></a>` : ''}
        ${d.total.failures ? `<a class="alert bad" href="#/pedidos?status=falha_entrega">${icon('alert')}<span>${plural(d.total.failures, 'home.alert.fail1', 'home.alert.failN')}</span><b>${t('act.fix')} →</b></a>` : ''}
        ${d.lowStock.map((s) => `<a class="alert" href="#/produtos" data-product="${s.id}">${icon('box')}<span>${t('home.alert.stock', { name: esc(s.name), n: s.stock })}</span><b>${t('act.edit')} →</b></a>`).join('')}
      </div>` : ''}
      <div class="grid kpis">
        <div class="card kpi"><div class="kpi-top"><span class="label">${t('home.revenue.period', { n: d.days })}</span>${delta(p.bruto, d.previous.bruto)}</div>
          <div class="value">${brl(p.bruto)}</div>${sparkline(d.series.map((s) => s.total))}<div class="sub">${t('home.vs.prev', { v: brl(d.previous.bruto) })}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="label">${t('home.sales')}</span>${delta(p.vendas, d.previous.vendas)}</div>
          <div class="value">${fmtNum(p.vendas)}</div>${sparkline(d.series.map((s) => s.orders))}<div class="sub">${t('home.today', { v: brl(d.today.bruto), n: d.today.vendas })}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="label">${t('home.avg')}</span>${delta(avg, prevAvg)}</div>
          <div class="value">${brl(avg)}</div><div class="sub">${plural(d.customers, 'home.customers1', 'home.customersN')}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="label">${t('home.conversion')}</span></div>
          <div class="value">${pct(d.conversion)}</div><div class="sub">${t('home.conversion.sub', { n: fmtNum(d.created) })}</div></div>
      </div>

      <div class="grid two">
        <section class="card">
          <div class="card-head"><h2>${t('home.revenue')}</h2>
            <div class="seg" role="group">${[7, 30, 90].map((n) => `<button data-days="${n}" class="${n === d.days ? 'on' : ''}" aria-pressed="${n === d.days}">${t('home.days', { n })}</button>`).join('')}</div></div>
          ${areaChart(d.series)}
        </section>
        <section class="card">
          <div class="card-head"><h2>${t('home.top')}</h2></div>
          ${p.top.length ? `<ol class="rank">${p.top.map((x, i) => `<li><span class="rank-n mono">${String(i + 1).padStart(2, '0')}</span>
            <div class="grow"><div class="title">${esc(x.name)}</div><div class="meta">${plural(x.qtd, 'n.sale', 'n.sales')}</div></div><span class="mono">${brl(x.total)}</span></li>`).join('')}</ol>`
            : emptyState('box', t('home.nosales'))}
        </section>
      </div>

      <div class="grid three">
        <section class="card">
          <div class="card-head"><h2>${t('home.methods')}</h2></div>
          ${d.byMethod.length ? `<div class="split">${['mercadopago', 'pix_manual'].filter((m) => methods[m]).map((m) => `<i class="m-${m}" style="flex:${methods[m].t}"></i>`).join('')}</div>
          <ul class="legend">${['mercadopago', 'pix_manual'].map((m) => `<li><i class="m-${m}"></i><span>${methodLabel(m)}</span>
            <span class="mono">${pct((methods[m]?.t || 0) / methodTotal)}</span></li>`).join('')}</ul>` : emptyState('orders', t('home.nosales'))}
        </section>
        <section class="card">
          <div class="card-head"><h2>${t('home.categories')}</h2></div>
          ${d.byCategory.length ? hbars(d.byCategory.map((c) => ({ label: catLabel(c.category), value: c.t, text: brl(c.t) }))) : emptyState('box', t('home.nosales'))}
        </section>
        <section class="card stats-mini">
          <div class="card-head"><h2>${t('home.store')}</h2></div>
          <dl class="mini">
            <div><dt>${t('home.total')}</dt><dd class="mono">${brl(d.total.bruto)}</dd></div>
            <div><dt>${t('home.refunds')}</dt><dd class="mono">${brl(d.total.refunds.total)}</dd></div>
            <div><dt>${t('nav.vips')}</dt><dd class="mono"><a href="#/vips">${fmtNum(d.vipsActive)}</a></dd></div>
            <div><dt>${t('home.tickets')}</dt><dd class="mono"><a href="#/tickets">${fmtNum(d.ticketsOpen)}</a></dd></div>
            <div><dt>${t('home.rating')}</dt><dd class="mono"><a href="#/avaliacoes">${d.rating.n ? `${d.rating.avg.toFixed(1)} ★` : '—'}</a></dd></div>
            <div><dt>${t('home.open')}</dt><dd class="mono"><a href="#/pedidos?status=abertos">${fmtNum(d.total.pending)}</a></dd></div>
          </dl>
        </section>
      </div>

      <section class="card">
        <div class="card-head"><h2>${t('home.recent')}</h2><a class="link" href="#/pedidos">${t('act.seeall')} →</a></div>
        <div class="list">${d.recent.length ? d.recent.map(orderRow).join('') : emptyState('orders', t('orders.none'))}</div>
      </section>`;
    $$('[data-days]', view).forEach((b) => b.addEventListener('click', () => { homeDays = Number(b.dataset.days); store.set('paany_days', homeDays); pageHome().catch(failed); }));
    bindCharts();
  }

  const orderRow = (o) => `
    <button class="row" data-order="${esc(o.id)}" type="button">
      ${avatarDot(o.userName, o.userId)}
      <div class="grow"><div class="title">${esc(o.product)}</div><div class="meta"><span class="mono">${esc(o.id)}</span> · ${who(o.userId, o.userName)} · ${ago(o.createdAt)}</div></div>
      <div class="right"><div class="mono strong">${brl(o.total)}</div>${pill(o.status)}</div>
    </button>`;

  /* ============================== Pedidos ============================== */

  const ordersState = { status: '', q: '', offset: 0 };
  const ORDER_FILTERS = ['', 'abertos', 'em_analise', 'pagos', 'falha_entrega', 'reembolsado', 'cancelado', 'expirado'];
  async function pageOrders(params) {
    if (params.has('status')) ordersState.status = params.get('status');
    if (params.has('q')) ordersState.q = params.get('q');
    setTitle('nav.orders', `<a class="btn" href="/api/export.csv?days=3650">${icon('download')}<span>${t('act.exportall')}</span></a>`);
    view.innerHTML = `
      <div class="toolbar">
        <label class="search">${icon('search')}<input id="q" type="search" placeholder="${t('orders.search')}" value="${esc(ordersState.q)}" aria-label="${t('act.search')}"></label>
      </div>
      <div class="chips" role="tablist">${ORDER_FILTERS.map((v) => `<button class="chip ${v === ordersState.status ? 'on' : ''}" data-status="${v}" role="tab" aria-selected="${v === ordersState.status}">${t(`filter.${v || 'all'}`)}</button>`).join('')}</div>
      <div id="orders-table">${skel(1, 'x')}</div>`;
    let timer;
    $('#q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { ordersState.q = e.target.value.trim(); ordersState.offset = 0; loadOrders(); }, 250); });
    $$('[data-status]', view).forEach((b) => b.addEventListener('click', () => {
      ordersState.status = b.dataset.status; ordersState.offset = 0;
      $$('[data-status]', view).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      loadOrders();
    }));
    await loadOrders();
  }

  async function loadOrders() {
    const box = $('#orders-table');
    if (!box) return;
    try {
      const qs = new URLSearchParams({ status: ordersState.status, q: ordersState.q, offset: ordersState.offset, limit: 30 });
      const d = await api(`orders?${qs}`);
      if (!d.items.length) { box.innerHTML = emptyState('orders', t('orders.none'), ordersState.q ? t('orders.none.search') : ''); return; }
      box.innerHTML = `
        <div class="table-wrap"><table class="rtable">
          <thead><tr><th>${t('col.order')}</th><th>${t('col.product')}</th><th>${t('col.customer')}</th><th class="num">${t('col.value')}</th><th>${t('col.payment')}</th><th>${t('col.status')}</th><th>${t('col.created')}</th></tr></thead>
          <tbody>${d.items.map((o) => `
            <tr data-order="${esc(o.id)}" tabindex="0">
              <td class="mono" data-label="${t('col.order')}">${esc(o.id)}</td>
              <td class="strong" data-label="${t('col.product')}">${esc(o.product)}</td>
              <td data-label="${t('col.customer')}">${who(o.userId, o.userName)}</td>
              <td class="mono num" data-label="${t('col.value')}">${brl(o.total)}</td>
              <td data-label="${t('col.payment')}">${methodLabel(o.method)}</td>
              <td data-label="${t('col.status')}">${pill(o.status)}</td>
              <td class="muted" data-label="${t('col.created')}" title="${dt(o.createdAt)}">${ago(o.createdAt)}</td>
            </tr>`).join('')}</tbody>
        </table></div>
        ${pager(d, 'orders')}`;
    } catch (e) { box.innerHTML = emptyState('alert', t('err.load'), esc(e.message)); }
  }

  const pager = (d, kind) => `<div class="pager"><span class="muted">${t('pager', { a: fmtNum(d.offset + 1), b: fmtNum(d.offset + d.items.length), n: fmtNum(d.total) })}</span>
    <span class="actions"><button class="btn small" data-page="-1" data-kind="${kind}" ${d.offset === 0 ? 'disabled' : ''}>${t('act.prev')}</button>
    <button class="btn small" data-page="1" data-kind="${kind}" ${d.offset + d.items.length >= d.total ? 'disabled' : ''}>${t('act.next')}</button></span></div>`;

  async function showOrder(id) {
    openDrawer(`<div class="skeleton tall"></div>`);
    try {
      const d = await api(`orders/${encodeURIComponent(id)}`);
      const o = d.order;
      const discord = (ch) => `https://discord.com/channels/${d.guildId}/${ch}`;
      const canApprove = o.method !== 'mercadopago' && ['em_analise', 'aguardando_pagamento', 'expirado', 'cancelado'].includes(o.status);
      const canReject = ['em_analise', 'aguardando_pagamento'].includes(o.status);
      const canRedeliver = ['pago', 'falha_entrega', 'entregue'].includes(o.status);
      const canRefund = ['pago', 'processando', 'entregue', 'falha_entrega', 'reembolso_solicitado'].includes(o.status);
      const steps = [
        ['step.created', o.createdAt],
        ...(o.method === 'pix_manual' ? [['step.review', ['em_analise', 'pago', 'processando', 'entregue', 'falha_entrega', 'reembolsado'].includes(o.status) ? o.createdAt : null]] : []),
        ['step.paid', o.paidAt],
        ['step.delivered', o.deliveredAt],
      ];
      openDrawer(`
        ${drawerHead(`${esc(o.id)} <button class="mini-btn" data-copy="${esc(o.id)}" aria-label="${t('act.copy')}">${icon('copy')}</button>`, esc(o.product))}
        <div class="row-gap">${pill(o.status)}<span class="mono big">${brl(o.total)}</span></div>
        <ol class="stepper">${steps.map(([k, at]) => `<li class="${at ? 'done' : ''}"><i></i><span>${t(k)}</span><small>${at ? dt(at) : '—'}</small></li>`).join('')}</ol>
        <dl class="kv">
          <dt>${t('col.customer')}</dt><dd><a href="#" data-customer="${esc(o.userId)}">${who(o.userId, o.userName)}</a>${o.userName ? ` <span class="muted mono">${esc(o.userId)}</span>` : ''}</dd>
          <dt>${t('col.payment')}</dt><dd>${methodLabel(o.method)}${o.mpPaymentId ? ` <span class="muted mono">#${esc(o.mpPaymentId)}</span>` : ''}</dd>
          ${o.discount ? `<dt>${t('order.discount')}</dt><dd class="mono">−${brl(o.discount)} <span class="muted">(${esc(o.coupon)})</span></dd>` : ''}
          ${o.expiresAt && o.status === 'aguardando_pagamento' ? `<dt>${t('order.expires')}</dt><dd>${until(o.expiresAt)}</dd>` : ''}
          ${o.reviewedBy ? `<dt>${t('order.approvedby')}</dt><dd>${who(o.reviewedBy, d.reviewerName)}</dd>` : ''}
          ${o.attempts ? `<dt>${t('order.attempts')}</dt><dd>${o.attempts}</dd>` : ''}
          ${o.lastError ? `<dt>${t('order.error')}</dt><dd class="bad-text">${esc(o.lastError)}</dd>` : ''}
          ${o.note ? `<dt>${t('order.note')}</dt><dd>${esc(o.note)}</dd>` : ''}
          ${d.review ? `<dt>${t('nav.reviews')}</dt><dd><span class="stars">${stars(d.review.rating)}</span> ${esc(d.review.comment || '')}</dd>` : ''}
        </dl>
        ${o.ticketChannelId ? `<a class="btn block" href="${discord(o.ticketChannelId)}" target="_blank" rel="noopener">${icon('external')}<span>${t('order.proof')}</span></a>` : ''}
        ${canApprove ? `
          <div class="box accent"><h3>${t('order.approve.title')}</h3>
            <p class="hint">${t('order.approve.hint', { v: `<strong>${brl(o.total)}</strong>` })}</p>
            <label class="field"><span>${t('order.approve.type', { id: `<span class="mono">${esc(o.id)}</span>` })}</span><input id="confirm-id" autocomplete="off" spellcheck="false" autocapitalize="characters"></label>
            <button class="btn primary block" data-do="approve" disabled>${icon('check')}<span>${t('order.approve.btn')}</span></button></div>` : ''}
        <div class="actions">
          ${canRedeliver ? `<button class="btn" data-do="redeliver">${t(o.status === 'entregue' ? 'order.resend' : 'order.retry')}</button>` : ''}
          ${canReject ? `<button class="btn danger" data-open="reject-box">${t('order.reject')}</button>` : ''}
          ${canRefund ? `<button class="btn danger" data-open="refund-box">${t('order.refund')}</button>` : ''}
        </div>
        ${canReject ? `<div class="box" id="reject-box" hidden><h3>${t('order.reject.title')}</h3>
            <label class="field">${t('order.reject.reason')}<textarea id="reject-reason" maxlength="500" placeholder="${t('order.reject.ph')}"></textarea></label>
            <div class="actions"><button class="btn danger solid" data-do="reject">${t('order.reject.btn')}</button><button class="btn" data-close-box>${t('act.back')}</button></div></div>` : ''}
        ${canRefund ? `<div class="box" id="refund-box" hidden><h3>${t('order.refund.title', { v: brl(o.total) })}</h3>
            <p class="hint">${t(o.method === 'mercadopago' ? 'order.refund.mp' : 'order.refund.manual')}</p>
            <label class="check"><input type="checkbox" id="refund-role" checked><span>${t('order.refund.role')}</span></label>
            <label class="field">${t('order.refund.reason')}<input id="refund-reason" maxlength="300"></label>
            <div class="actions"><button class="btn danger solid" data-do="refund">${t('order.refund.btn')}</button><button class="btn" data-close-box>${t('act.back')}</button></div></div>` : ''}
        ${(d.events.length || d.history.length) ? `<details class="box" open><summary>${t('order.history')}</summary><ul class="timeline">
          ${d.events.map((e) => `<li><time>${dt(e.created_at)}</time><span>${t('order.ev.payment', { p: esc(e.provider), v: brl(e.amount_cents) })}</span></li>`).join('')}
          ${d.history.map((h) => `<li><time>${dt(h.created_at)}</time><span><code>${esc(h.action)}</code>${h.actor_id ? ` · ${who(h.actor_id, d.names?.[h.actor_id])}` : ''}</span></li>`).join('')}
        </ul></details>` : ''}`);

      const confirmInput = $('#confirm-id');
      confirmInput?.addEventListener('input', () => {
        drawerBody.querySelector('[data-do=approve]').disabled = confirmInput.value.trim().toUpperCase() !== o.id;
      });
      $$('[data-open]', drawerBody).forEach((b) => b.addEventListener('click', () => {
        $$('#reject-box,#refund-box', drawerBody).forEach((x) => { x.hidden = x.id !== b.dataset.open; });
        $(`#${b.dataset.open} textarea, #${b.dataset.open} input:not([type=checkbox])`)?.focus();
      }));
      $$('[data-close-box]', drawerBody).forEach((b) => b.addEventListener('click', () => { b.closest('.box').hidden = true; }));
      $$('[data-do]', drawerBody).forEach((b) => b.addEventListener('click', async () => {
        const action = b.dataset.do;
        const body = {};
        if (action === 'approve') body.confirm = confirmInput.value;
        if (action === 'reject') {
          body.reason = $('#reject-reason').value.trim();
          if (!body.reason) { toast(t('order.reject.need'), 'err'); $('#reject-reason').focus(); return; }
        }
        if (action === 'refund') { body.removeRole = $('#refund-role').checked; body.reason = $('#refund-reason').value.trim(); }
        b.disabled = true;
        b.classList.add('busy');
        try {
          const endpoint = action === 'reject' && o.status === 'aguardando_pagamento' && o.method === 'mercadopago' ? 'cancel' : action;
          const r = await api(`orders/${encodeURIComponent(o.id)}/${endpoint}`, { method: 'POST', body });
          toast(r.message, r.ok ? 'ok' : 'err');
          pollCounts();
          await showOrder(o.id);
          if (location.hash.startsWith('#/pedidos')) loadOrders();
        } catch (e) { toast(e.message, 'err'); b.disabled = false; b.classList.remove('busy'); }
      }));
    } catch (e) { openDrawer(`${drawerHead('', t('err.load'))}<p>${esc(e.message)}</p>`); }
  }

  /* ============================== Produtos ============================== */

  const prodState = { q: '', cat: '' };
  let PRODS = [];
  let renderProducts = () => {};
  async function pageProducts() {
    setTitle('nav.products', `<button class="btn primary" data-act="new-product">${icon('plus')}<span>${t('products.new')}</span></button>`);
    loading();
    const list = await api('products');
    PRODS = list;
    const cats = [...new Set(list.map((p) => p.category))];
    const render = () => {
      const q = prodState.q.toLowerCase();
      const items = list.filter((p) => (!prodState.cat || p.category === prodState.cat) && (!q || p.name.toLowerCase().includes(q)));
      $('#prod-grid').innerHTML = items.length ? items.map((p) => `
        <article class="card product ${p.active ? '' : 'off'}">
          <button class="product-hit" data-product="${p.id}" aria-label="${t('act.edit')} ${esc(p.name)}"></button>
          <div class="img" ${p.imageUrl ? `style="background-image:url('${esc(p.imageUrl).replace(/'/g, '%27')}')"` : ''}>${p.imageUrl ? '' : icon('box', 'big')}
            <span class="tag">${esc(catLabel(p.category))}</span></div>
          <div class="info">
            <div class="title">${esc(p.name)}</div>
            <div class="price-row"><span class="price mono">${brl(p.price)}</span>
              <span class="pill ${p.stock != null && p.stock <= 3 ? (p.stock === 0 ? 'bad' : 'warn') : ''}"><i></i>${p.stock == null ? t('products.unlimited') : p.stock > 0 ? t('products.units', { n: p.stock }) : t('products.soldout')}</span></div>
            <div class="meta">${plural(p.sold, 'products.sold1', 'products.soldN')}${p.roleId ? ` · VIP ${p.vipDays ? t('products.days', { n: p.vipDays }) : t('products.permanent')}` : ''}</div>
            <div class="product-foot">
              <label class="switch" title="${t('products.visible')}"><input type="checkbox" data-toggle-product="${p.id}" ${p.active ? 'checked' : ''}><i></i><span>${t(p.active ? 'products.on' : 'products.off')}</span></label>
              <button class="mini-btn" data-duplicate="${p.id}" title="${t('products.duplicate')}" aria-label="${t('products.duplicate')}">${icon('copy')}</button>
            </div>
          </div>
        </article>`).join('') : `<div class="span-all">${emptyState('box', t(list.length ? 'products.none.filter' : 'products.none'), list.length ? '' : t('products.none.hint'))}</div>`;
    };
    view.innerHTML = `
      <div class="toolbar"><label class="search">${icon('search')}<input id="pq" type="search" placeholder="${t('products.search')}" value="${esc(prodState.q)}"></label></div>
      ${cats.length > 1 ? `<div class="chips"><button class="chip ${prodState.cat ? '' : 'on'}" data-cat="">${t('filter.all')}</button>${cats.map((c) => `<button class="chip ${prodState.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(catLabel(c))}</button>`).join('')}</div>` : ''}
      <div class="grid products" id="prod-grid"></div>`;
    renderProducts = render;
    render();
    $('#pq').addEventListener('input', (e) => { prodState.q = e.target.value; render(); });
    $$('[data-cat]', view).forEach((b) => b.addEventListener('click', () => {
      prodState.cat = b.dataset.cat; $$('[data-cat]', view).forEach((x) => x.classList.toggle('on', x === b)); render();
    }));
  }

  async function productForm(id) {
    openDrawer('<div class="skeleton tall"></div>');
    try {
      const [p, roles] = await Promise.all([id ? api(`products/${id}`) : Promise.resolve(null), api('roles').catch(() => [])]);
      const v = p || { name: '', price: '', category: 'vip', deliveryType: 'link', description: '', rules: '', deliveryContent: '', imageUrl: '', roleId: '', vipDays: '', stock: '', active: true };
      const priceTxt = p ? (v.price / 100).toLocaleString(loc(), { minimumFractionDigits: 2 }) : '';
      openDrawer(`
        ${drawerHead(p ? `#${p.id} · ${plural(p.sold, 'products.sold1', 'products.soldN')}` : '', t(p ? 'products.edit' : 'products.new'))}
        <form class="form" id="pform" novalidate>
          <div class="img-pick full">
            <div class="img-prev" id="img-prev" ${v.imageUrl ? `style="background-image:url('${esc(v.imageUrl).replace(/'/g, '%27')}')"` : ''}>${v.imageUrl ? '' : icon('box', 'big')}</div>
            <div class="grow">
              <label class="field">${t('pf.image')}<input name="imageUrl" placeholder="https://..." value="${esc(v.imageUrl || '')}"></label>
              <div class="row-gap"><label class="btn small">${icon('download')}<span>${t('pf.upload')}</span><input type="file" id="upload" accept="image/png,image/jpeg,image/gif,image/webp" hidden></label>
                <span class="hint">${t('pf.upload.hint')}</span></div>
            </div>
          </div>
          <label class="field full">${t('pf.name')}<input name="name" required maxlength="80" value="${esc(v.name)}"></label>
          <label class="field">${t('pf.price')}<div class="affix"><span>R$</span><input name="price" inputmode="decimal" required placeholder="8,00" value="${esc(priceTxt)}"></div></label>
          <label class="field">${t('pf.category')}<select name="category">${Object.keys(ME.categories).map((k) => `<option value="${k}" ${k === v.category ? 'selected' : ''}>${esc(catLabel(k))}</option>`).join('')}</select></label>
          <label class="field full">${t('pf.description')}<textarea name="description" maxlength="2000" rows="3">${esc(v.description)}</textarea></label>
          <fieldset class="full fs"><legend>${t('pf.delivery')}</legend>
            <div class="seg wide" role="radiogroup">${['cargo', 'link', 'arquivo', 'texto'].map((k) => `<label class="${k === v.deliveryType ? 'on' : ''}"><input type="radio" name="deliveryType" value="${k}" ${k === v.deliveryType ? 'checked' : ''}><span>${t(`dt.${k}`)}</span></label>`).join('')}</div>
            <div class="form inner">
              <label class="field">${t('pf.role')}<select name="roleId"><option value="">${t('pf.none')}</option>
                ${roles.map((r) => `<option value="${esc(r.id)}" ${r.id === v.roleId ? 'selected' : ''} ${r.assignable ? '' : 'disabled'}>${esc(r.name)}${r.assignable ? '' : ` (${t('pf.role.above')})`}</option>`).join('')}
              </select></label>
              <label class="field">${t('pf.vipdays')}<input name="vipDays" type="number" min="0" max="3650" placeholder="${t('pf.vipdays.ph')}" value="${v.vipDays ?? ''}"></label>
              <label class="field full">${t('pf.content')}<textarea name="deliveryContent" maxlength="1000" rows="3" placeholder="${t('pf.content.ph')}">${esc(v.deliveryContent || '')}</textarea>
                <span class="hint">${icon('alert')} ${t('pf.content.hint')}</span></label>
            </div>
          </fieldset>
          <label class="field">${t('pf.stock')}<input name="stock" type="number" min="0" placeholder="${t('pf.stock.ph')}" value="${v.stock ?? ''}"></label>
          <label class="field switch-field"><span>${t('products.visible')}</span><span class="switch"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}><i></i></span></label>
          <label class="field full">${t('pf.rules')}<textarea name="rules" maxlength="1000" rows="2">${esc(v.rules)}</textarea></label>
          <div class="actions full sticky-actions"><button class="btn primary" type="submit">${t(p ? 'act.save' : 'products.create')}</button>
            ${p ? `<button class="btn" type="button" data-duplicate="${p.id}">${icon('copy')}<span>${t('products.duplicate')}</span></button>` : ''}
            <button class="btn ghost" type="button" data-act="close">${t('act.cancel')}</button></div>
        </form>`);

      const form = $('#pform');
      const prev = $('#img-prev');
      const setPrev = (u) => { prev.style.backgroundImage = u ? `url('${u.replace(/'/g, '%27')}')` : ''; prev.innerHTML = u ? '' : icon('box', 'big'); };
      form.imageUrl.addEventListener('change', () => setPrev(form.imageUrl.value.trim()));
      $$('.seg.wide input', form).forEach((r) => r.addEventListener('change', () => $$('.seg.wide label', form).forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked))));
      $('#upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) { toast(t('pf.upload.big'), 'err'); return; }
        const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
        try {
          const { url } = await api('upload', { method: 'POST', body: { data } });
          form.imageUrl.value = url; setPrev(url); toast(t('pf.upload.ok'));
        } catch (err) { toast(err.message, 'err'); }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const body = Object.fromEntries(f.entries());
        body.active = f.get('active') === 'on';
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true; btn.classList.add('busy');
        try {
          await api(p ? `products/${p.id}` : 'products', { method: p ? 'PUT' : 'POST', body });
          toast(t(p ? 'products.saved' : 'products.created'));
          closeDrawer();
          if (location.hash.startsWith('#/produtos')) pageProducts().catch(failed);
        } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.classList.remove('busy'); }
      });
    } catch (e) { openDrawer(`${drawerHead('', t('err.load'))}<p>${esc(e.message)}</p>`); }
  }

  async function duplicateProduct(id) {
    if (!await ask({ title: t('products.duplicate.q'), body: t('products.duplicate.body') })) return;
    try {
      const r = await api(`products/${id}/duplicate`, { method: 'POST', body: {} });
      toast(r.message);
      productForm(r.product.id);
      if (location.hash.startsWith('#/produtos')) pageProducts().catch(failed);
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ============================== Clientes ============================== */

  const custState = { q: '', sort: 'recent', offset: 0 };
  async function pageCustomers() {
    setTitle('nav.customers');
    view.innerHTML = `
      <div class="toolbar">
        <label class="search">${icon('search')}<input id="cq" type="search" placeholder="${t('customers.search')}" value="${esc(custState.q)}"></label>
        <div class="seg">${['recent', 'spent', 'orders'].map((s) => `<button data-sort="${s}" class="${custState.sort === s ? 'on' : ''}">${t(`customers.sort.${s}`)}</button>`).join('')}</div>
      </div>
      <div id="cust-table">${skel(1, 'x')}</div>`;
    let timer;
    $('#cq').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { custState.q = e.target.value.trim(); custState.offset = 0; loadCustomers(); }, 250); });
    $$('[data-sort]', view).forEach((b) => b.addEventListener('click', () => {
      custState.sort = b.dataset.sort; custState.offset = 0; $$('[data-sort]', view).forEach((x) => x.classList.toggle('on', x === b)); loadCustomers();
    }));
    await loadCustomers();
  }
  async function loadCustomers() {
    const box = $('#cust-table');
    if (!box) return;
    try {
      const d = await api(`customers?${new URLSearchParams({ q: custState.q, sort: custState.sort, offset: custState.offset, limit: 30 })}`);
      if (!d.items.length) { box.innerHTML = emptyState('users', t('customers.none'), custState.q ? t('customers.none.search') : ''); return; }
      box.innerHTML = `<div class="table-wrap"><table class="rtable">
        <thead><tr><th>${t('col.customer')}</th><th class="num">${t('col.spent')}</th><th class="num">${t('col.orders')}</th><th>${t('col.last')}</th><th></th></tr></thead>
        <tbody>${d.items.map((c) => `<tr data-customer="${esc(c.userId)}" tabindex="0">
          <td data-label="${t('col.customer')}"><span class="who">${avatarDot(c.userName, c.userId)}<span><b>${who(c.userId, c.userName)}</b>${c.userName ? `<small class="mono muted">${esc(c.userId)}</small>` : ''}</span></span></td>
          <td class="mono num strong" data-label="${t('col.spent')}">${brl(c.spent)}</td>
          <td class="mono num" data-label="${t('col.orders')}">${c.paid}<span class="muted">/${c.orders}</span></td>
          <td class="muted" data-label="${t('col.last')}">${ago(c.lastAt)}</td>
          <td data-label="">${c.vip ? '<span class="pill ok"><i></i>VIP</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
        ${pager(d, 'customers')}`;
    } catch (e) { box.innerHTML = emptyState('alert', t('err.load'), esc(e.message)); }
  }
  async function showCustomer(userId) {
    openDrawer('<div class="skeleton tall"></div>');
    try {
      const c = await api(`customers/${encodeURIComponent(userId)}`);
      openDrawer(`
        ${drawerHead(`<span class="mono">${esc(c.userId)}</span> <button class="mini-btn" data-copy="${esc(c.userId)}" aria-label="${t('act.copy')}">${icon('copy')}</button>`, who(c.userId, c.userName))}
        <div class="grid mini3">
          <div class="stat"><span>${t('col.spent')}</span><b class="mono">${brl(c.spent)}</b></div>
          <div class="stat"><span>${t('customers.purchases')}</span><b class="mono">${c.paidCount}</b></div>
          <div class="stat"><span>${t('customers.since')}</span><b>${dshort(c.firstAt)}</b></div>
        </div>
        ${c.vips.length ? `<div class="box"><h3>VIP</h3>${c.vips.map((v) => `<div class="row-gap between"><span>${esc(v.product || '—')}</span>
          ${v.active ? (v.expiresAt ? `<span class="pill ${v.expiresAt - Date.now() < 3 * 864e5 ? 'warn' : 'ok'}"><i></i>${t('vips.until', { d: dt(v.expiresAt) })}</span>` : `<span class="pill ok"><i></i>${t('products.permanent')}</span>`) : `<span class="pill off"><i></i>${t('vips.ended')}</span>`}</div>`).join('')}</div>` : ''}
        <div class="box"><h3>${t('nav.orders')}</h3><div class="list compact">${c.orders.map(orderRow).join('')}</div></div>
        ${c.reviews.length ? `<div class="box"><h3>${t('nav.reviews')}</h3>${c.reviews.map((r) => `<p><span class="stars">${stars(r.rating)}</span> <span class="muted">${esc(r.product || '')}</span><br>${esc(r.comment || '')}</p>`).join('')}</div>` : ''}
        ${c.tickets.length ? `<div class="box"><h3>${t('nav.tickets')}</h3>${c.tickets.map((tk) => `<div class="row-gap between"><span>#${tk.id} · ${esc(t(`reason.${tk.reason}`))}</span>
          ${tk.status === 'aberto' && tk.channel_id ? `<a class="link" href="https://discord.com/channels/${c.guildId}/${tk.channel_id}" target="_blank" rel="noopener">${t('tickets.open')} ↗</a>` : `<span class="muted">${ago(tk.created_at)}</span>`}</div>`).join('')}</div>` : ''}`);
    } catch (e) { openDrawer(`${drawerHead('', t('err.load'))}<p>${esc(e.message)}</p>`); }
  }

  /* ============================== Cupons ============================== */

  async function pageCoupons() {
    setTitle('nav.coupons', `<button class="btn primary" data-act="new-coupon">${icon('plus')}<span>${t('coupons.new')}</span></button>`);
    loading();
    renderCoupons(await api('coupons'));
  }
  function couponState(c) {
    const n = Date.now();
    if (!c.active) return ['off', 'coupons.st.off'];
    if (c.expiresAt && c.expiresAt < n) return ['off', 'coupons.st.expired'];
    if (c.maxUses != null && c.uses >= c.maxUses) return ['off', 'coupons.st.used'];
    if (c.startsAt && c.startsAt > n) return ['wait', 'coupons.st.scheduled'];
    return ['ok', 'coupons.st.on'];
  }
  function renderCoupons(list) {
    if (!location.hash.startsWith('#/cupons')) return;
    view.innerHTML = list.length ? `<div class="grid coupons">${list.map((c) => {
      const [kind, label] = couponState(c);
      const usePct = c.maxUses ? Math.min(c.uses / c.maxUses, 1) : null;
      return `<article class="card coupon ${kind === 'off' ? 'dim' : ''}">
        <div class="coupon-top"><button class="code mono" data-copy="${esc(c.code)}" title="${t('act.copy')}">${esc(c.code)} ${icon('copy')}</button><span class="pill ${kind}"><i></i>${t(label)}</span></div>
        <div class="coupon-val mono">${c.type === 'percent' ? `${c.value}%` : brl(c.value)} <small>${t('coupons.off')}</small></div>
        <div class="meter"><i style="width:${usePct == null ? 0 : (usePct * 100).toFixed(0)}%"></i></div>
        <div class="meta">${t('coupons.uses', { a: c.uses, b: c.maxUses ?? '∞' })}${c.onePerUser ? ` · ${t('coupons.oneper')}` : ''}</div>
        <div class="meta">${c.startsAt ? `${t('coupons.from', { d: dt(c.startsAt) })} · ` : ''}${c.expiresAt ? t('coupons.to', { d: dt(c.expiresAt) }) : t('coupons.noend')}</div>
        <div class="coupon-foot"><label class="switch"><input type="checkbox" data-toggle-coupon="${esc(c.code)}" ${c.active ? 'checked' : ''}><i></i><span>${t(c.active ? 'coupons.active' : 'coupons.inactive')}</span></label></div>
      </article>`;
    }).join('')}</div>` : emptyState('coupon', t('coupons.none'), t('coupons.none.hint'), `<button class="btn primary" data-act="new-coupon">${icon('plus')}<span>${t('coupons.new')}</span></button>`);
  }
  async function couponForm() {
    const products = await api('products').catch(() => []);
    openDrawer(`
      ${drawerHead('', t('coupons.new'))}
      <form class="form" id="cform">
        <label class="field full">${t('cf.code')}<div class="affix"><input name="code" required maxlength="32" placeholder="CUTIFY10" class="upper mono">
          <button class="btn small" type="button" id="gen-code">${t('cf.generate')}</button></div></label>
        <fieldset class="full fs"><legend>${t('cf.type')}</legend><div class="seg wide">
          <label class="on"><input type="radio" name="type" value="percent" checked><span>${t('cf.percent')}</span></label>
          <label><input type="radio" name="type" value="fixed"><span>${t('cf.fixed')}</span></label></div></fieldset>
        <label class="field">${t('cf.value')}<input name="value" required inputmode="decimal" placeholder="10"></label>
        <label class="field">${t('cf.max')}<input name="maxUses" type="number" min="1" placeholder="${t('cf.unlimited')}"></label>
        <label class="field">${t('cf.start')}<input name="startsAt" type="datetime-local"></label>
        <label class="field">${t('cf.end')}<input name="expiresAt" type="datetime-local"></label>
        <label class="field">${t('cf.product')}<select name="productId"><option value="">${t('cf.allproducts')}</option>${products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field">${t('cf.min')}<input name="minimum" inputmode="decimal" placeholder="${t('cf.optional')}"></label>
        <label class="check full"><input type="checkbox" name="onePerUser" checked><span>${t('cf.oneper')}</span></label>
        <div class="actions full sticky-actions"><button class="btn primary" type="submit">${t('coupons.create')}</button><button class="btn ghost" type="button" data-act="close">${t('act.cancel')}</button></div>
      </form>`);
    const form = $('#cform');
    $$('.seg.wide input', form).forEach((r) => r.addEventListener('change', () => {
      $$('.seg.wide label', form).forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked));
      form.value.placeholder = r.value === 'percent' ? '10' : '2,50';
    }));
    $('#gen-code').addEventListener('click', () => {
      const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const rnd = crypto.getRandomValues(new Uint8Array(6));
      form.code.value = `CUT${[...rnd].map((b) => a[b % a.length]).join('')}`;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const body = Object.fromEntries(f.entries());
      body.onePerUser = f.get('onePerUser') === 'on';
      for (const k of ['startsAt', 'expiresAt']) body[k] = body[k] ? new Date(body[k]).toISOString() : '';
      try { const list = await api('coupons', { method: 'POST', body }); toast(t('coupons.created')); closeDrawer(); renderCoupons(list); } catch (err) { toast(err.message, 'err'); }
    });
  }

  /* ============================== VIPs ============================== */

  async function pageVips() {
    setTitle('nav.vips');
    loading();
    const list = await api('vips');
    const soon = Date.now() + 3 * 864e5;
    const expiring = list.filter((v) => v.expiresAt && v.expiresAt < soon).length;
    const perm = list.filter((v) => !v.expiresAt).length;
    view.innerHTML = `
      <div class="grid kpis small">
        <div class="card kpi"><span class="label">${t('vips.active')}</span><div class="value">${fmtNum(list.length)}</div></div>
        <div class="card kpi"><span class="label">${t('vips.expiring')}</span><div class="value">${fmtNum(expiring)}</div></div>
        <div class="card kpi"><span class="label">${t('products.permanent')}</span><div class="value">${fmtNum(perm)}</div></div>
      </div>
      ${list.length ? `<div class="table-wrap"><table class="rtable">
        <thead><tr><th>${t('col.member')}</th><th>${t('col.plan')}</th><th>${t('col.expires')}</th><th>${t('col.order')}</th></tr></thead>
        <tbody>${list.map((v) => `<tr data-customer="${esc(v.userId)}" tabindex="0">
          <td data-label="${t('col.member')}"><span class="who">${avatarDot(v.userName, v.userId)}<b>${who(v.userId, v.userName)}</b></span></td>
          <td data-label="${t('col.plan')}">${esc(v.product || '—')}</td>
          <td data-label="${t('col.expires')}">${v.expiresAt ? `<span class="pill ${v.expiresAt < soon ? 'warn' : ''}"><i></i>${until(v.expiresAt)}</span>` : `<span class="pill ok"><i></i>${t('products.permanent')}</span>`}</td>
          <td class="mono muted" data-label="${t('col.order')}">${esc(v.orderId || t('vips.manual'))}</td></tr>`).join('')}</tbody></table></div>`
        : emptyState('crown', t('vips.none'))}`;
  }

  /* ============================== Tickets ============================== */

  let ticketTab = 'aberto';
  const TICKET_TABS = ['aberto', 'fechado', 'notas', 'personalizar'];
  async function pageTickets(params) {
    if (params?.has('tab') && TICKET_TABS.includes(params.get('tab'))) ticketTab = params.get('tab');
    setTitle('nav.tickets');
    loading();
    const tabs = (counts = {}) => `<div class="chips" role="tablist">
      <button class="chip ${ticketTab === 'aberto' ? 'on' : ''}" data-ttab="aberto">${t('tickets.tab.open')}${counts.aberto != null ? ` <b>${counts.aberto}</b>` : ''}</button>
      <button class="chip ${ticketTab === 'fechado' ? 'on' : ''}" data-ttab="fechado">${t('tickets.tab.closed')}${counts.fechado != null ? ` <b>${counts.fechado}</b>` : ''}</button>
      <button class="chip ${ticketTab === 'notas' ? 'on' : ''}" data-ttab="notas">${icon('star')}<span>${t('tickets.tab.ratings')}</span></button>
      <button class="chip ${ticketTab === 'personalizar' ? 'on' : ''}" data-ttab="personalizar">${icon('edit')}<span>${t('tickets.tab.customize')}</span></button></div>`;
    const bindTabs = () => $$('[data-ttab]', view).forEach((b) => b.addEventListener('click', () => { ticketTab = b.dataset.ttab; pageTickets().catch(failed); }));

    if (ticketTab === 'notas' || ticketTab === 'personalizar') {
      const [cfg, channels] = await Promise.all([api('ticket-config'), ticketTab === 'personalizar' ? api('channels').catch(() => []) : Promise.resolve([])]);
      view.innerHTML = tabs() + '<div id="tk-body"></div>';
      bindTabs();
      if (ticketTab === 'notas') renderTicketRatings(cfg);
      else renderTicketCustomize(cfg, channels);
      return;
    }

    const d = await api(`tickets?status=${ticketTab}`);
    view.innerHTML = `${tabs(d.counts)}
      ${d.items.length ? `<div class="card"><div class="list">${d.items.map((tk) => `
        <div class="row static">
          ${avatarDot(tk.userName, tk.userId)}
          <div class="grow"><div class="title">#${tk.id} · ${esc(tk.reasonLabel || t(`reason.${tk.reason}`))}</div>
            <div class="meta"><a href="#" data-customer="${esc(tk.userId)}">${who(tk.userId, tk.userName)}</a>${tk.orderId ? ` · <a href="#" data-order="${esc(tk.orderId)}" class="mono">${esc(tk.orderId)}</a>` : ''} · ${ticketTab === 'aberto' ? ago(tk.createdAt) : t('tickets.closedby', { w: who(tk.closedBy, tk.closedByName), d: ago(tk.closedAt) })}</div></div>
          ${ticketTab === 'aberto' && tk.channelId ? `<a class="btn small" href="https://discord.com/channels/${d.guildId}/${tk.channelId}" target="_blank" rel="noopener">${icon('external')}<span>${t('tickets.open')}</span></a>` : ''}
        </div>`).join('')}</div></div>` : emptyState('ticket', t(ticketTab === 'aberto' ? 'tickets.none.open' : 'tickets.none.closed'))}`;
    bindTabs();
  }

  function renderTicketRatings(cfg) {
    const r = cfg.ratings;
    const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: r.recent.filter((x) => x.rating === n).length }));
    $('#tk-body').innerHTML = r.count ? `
      <div class="grid two rev">
        <section class="card rating-card"><div class="big-rating mono">${r.avg.toFixed(1)}</div><div class="stars lg">${stars(Math.round(r.avg))}</div>
          <div class="muted">${plural(r.count, 'reviews.count1', 'reviews.countN')}</div>
          <div class="dist">${dist.map((x) => `<div class="dist-row"><span>${x.n}★</span><div class="hbar-track"><i style="width:${r.recent.length ? (x.c / r.recent.length) * 100 : 0}%"></i></div><span class="mono">${x.c}</span></div>`).join('')}</div>
          ${r.byStaff.length ? `<div class="staff-rank"><h3>${t('tickets.staff')}</h3>${r.byStaff.map((x, i) => `<div class="row-gap between"><span><span class="mono muted">${i + 1}.</span> ${who(x.staffId, x.staffName)}</span><span class="mono">${x.avg.toFixed(1)} ★ <small class="muted">(${x.n})</small></span></div>`).join('')}</div>` : ''}
        </section>
        <section class="card"><div class="list">${r.recent.map((x) => `
          <div class="row static">
            <div class="grow"><div><span class="stars">${stars(x.rating)}</span> <span class="muted">· ${esc(x.reason)} · #${x.ticketId}</span></div>
              <div class="quote">${x.comment ? `“${esc(x.comment)}”` : `<span class="muted">${t('reviews.nocomment')}</span>`}</div>
              <div class="meta"><a href="#" data-customer="${esc(x.userId)}">${who(x.userId, x.userName)}</a>${x.staffId ? ` → ${who(x.staffId, x.staffName)}` : ''} · ${ago(x.createdAt)}</div></div>
          </div>`).join('')}</div></section>
      </div>` : emptyState('star', t('tickets.ratings.none'), t('tickets.ratings.hint'));
  }

  /* ----------- Prévia no estilo Discord (painel de tickets e embeds) ----------- */

  function md(text) {
    let h = esc(text || '');
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<u>$1</u>').replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^### (.*)$/gm, '<strong class="h3">$1</strong>').replace(/^## (.*)$/gm, '<strong class="h2">$1</strong>').replace(/^# (.*)$/gm, '<strong class="h1">$1</strong>')
      .replace(/&lt;@&amp;?(\d+)&gt;/g, '<span class="mention">@$1</span>').replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#canal</span>')
      .replace(/\{(usuario|motivo|servidor)\}/g, '<span class="mention">{$1}</span>');
    return h.replace(/\n/g, '<br>');
  }
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '');
  const emojiHtml = (e) => (!e ? '' : /^<a?:\w+:(\d+)>$/.test(e) ? `<img class="emj" src="https://cdn.discordapp.com/emojis/${e.match(/(\d+)>$/)[1]}.webp?size=32" alt="">` : `<span class="emj">${esc(e)}</span>`);

  function discordPreview(d, { select = null, buttons = [], botName = ME?.store.bot || 'Paany', content = '' } = {}) {
    const color = /^#[0-9a-f]{6}$/i.test(d.color || '') ? d.color : '#f2f2f2';
    const btnRows = [];
    buttons.forEach((b, i) => { if (i % 5 === 0) btnRows.push([]); btnRows[btnRows.length - 1].push(b); });
    return `<div class="dc">
      <img class="dc-av" src="/painel/logo.png" alt="">
      <div class="dc-main">
        <div class="dc-head"><b>${esc(botName)}</b><span class="dc-bot">BOT</span><small>${t('preview.today')}</small></div>
        ${content ? `<div class="dc-content">${md(content)}</div>` : ''}
        <div class="dc-embed" style="border-color:${color}">
          <div class="dc-embed-body">
            ${d.author ? `<div class="dc-author">${esc(d.author)}</div>` : ''}
            ${d.title ? `<div class="dc-title">${d.url ? `<a href="${safeUrl(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>` : esc(d.title)}</div>` : ''}
            ${d.description ? `<div class="dc-desc">${md(d.description)}</div>` : ''}
            ${d.image ? `<img class="dc-image" src="${safeUrl(d.image)}" alt="" loading="lazy">` : ''}
            ${d.footer || d.timestamp ? `<div class="dc-footer">${d.footerIcon ? '<img src="/painel/logo.png" alt="">' : ''}${esc(d.footer || '')}${d.footer && d.timestamp ? ' • ' : ''}${d.timestamp ? t('preview.today') : ''}</div>` : ''}
          </div>
          ${d.thumbnail ? `<img class="dc-thumb" src="${d.thumbnail === 'logo' ? '/painel/logo.png' : safeUrl(d.thumbnail)}" alt="">` : ''}
        </div>
        ${select ? `<div class="dc-select"><span>${esc(select.placeholder)}</span>${icon('down')}</div>
          <div class="dc-options">${select.options.map((o) => `<div class="dc-opt">${emojiHtml(o.emoji)}<div><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</div></div>`).join('')}</div>` : ''}
        ${btnRows.map((row) => `<div class="dc-btns">${row.map((b) => `<span class="dc-btn ${b.action === 'link' ? 'link' : b.style || 'secondary'}">${emojiHtml(b.emoji)}${esc(b.label)}${b.action === 'link' ? icon('external') : ''}</span>`).join('')}</div>`).join('')}
      </div></div>`;
  }

  const channelOptions = (channels, selected, { placeholder = t('ch.choose'), allowEmpty = true } = {}) =>
    `${allowEmpty ? `<option value="">${esc(placeholder)}</option>` : ''}${channels.filter((c) => c.type === 'text').map((c) =>
      `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''} ${c.canSend === false ? 'disabled' : ''}>#${esc(c.name)}${c.parent ? ` · ${esc(c.parent)}` : ''}${c.canSend === false ? ` (${t('ch.noperm')})` : ''}</option>`).join('')}`;

  async function uploadInto(inputEl, onDone) {
    const pick = document.createElement('input');
    pick.type = 'file'; pick.accept = 'image/png,image/jpeg,image/gif,image/webp';
    pick.addEventListener('change', async () => {
      const file = pick.files[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) { toast(t('pf.upload.big'), 'err'); return; }
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
      try {
        const { url } = await api('upload', { method: 'POST', body: { data } });
        inputEl.value = url; inputEl.dispatchEvent(new Event('input', { bubbles: true })); toast(t('pf.upload.ok')); onDone?.();
      } catch (e) { toast(e.message, 'err'); }
    });
    pick.click();
  }

  /* ----------------------------- Personalizar tickets ----------------------------- */

  function renderTicketCustomize(data, channels) {
    const c = JSON.parse(JSON.stringify(data.config));
    let previewTab = 'panel';
    const box = $('#tk-body');
    box.innerHTML = `
      <div class="builder">
        <form class="builder-form" id="tkform" novalidate>
          <section class="card"><div class="card-head"><h2>${t('tc.panel')}</h2></div>
            <div class="form">
              <label class="field full">${t('tc.title')}<input data-k="panel.title" maxlength="256" value="${esc(c.panel.title)}"></label>
              <label class="field full">${t('tc.description')}<textarea data-k="panel.description" rows="5" maxlength="4000">${esc(c.panel.description)}</textarea>
                <span class="hint">${t('tc.md')}</span></label>
              <label class="field full">${t('tc.banner')}<div class="affix"><input data-k="panel.banner" placeholder="https://..." value="${esc(c.panel.banner)}"><button class="btn small" type="button" data-up="panel.banner">${icon('download')}<span>${t('pf.upload')}</span></button></div>
                <span class="hint">${t('tc.banner.hint')}</span></label>
              <label class="field">${t('tc.color')}<div class="affix color"><input type="color" data-k="panel.color" value="${esc(c.panel.color)}"><input data-k="panel.color" class="mono" maxlength="7" value="${esc(c.panel.color)}"></div></label>
              <label class="field">${t('tc.placeholder')}<input data-k="panel.placeholder" maxlength="150" value="${esc(c.panel.placeholder)}"></label>
              <label class="field">${t('tc.footer')}<input data-k="panel.footer" maxlength="200" placeholder="${esc(ME.store.bot)} • ${esc(ME.store.name)}" value="${esc(c.panel.footer)}"></label>
              <label class="field switch-field"><span>${t('tc.thumb')}</span><span class="switch"><input type="checkbox" data-k="panel.thumbnail" ${c.panel.thumbnail ? 'checked' : ''}><i></i></span></label>
            </div>
          </section>

          <section class="card"><div class="card-head"><h2>${t('tc.options')}</h2><span class="muted mono" id="opt-count"></span></div>
            <p class="hint">${t('tc.options.hint')}</p>
            <div class="opt-list" id="opt-list"></div>
            <button class="btn small" type="button" id="opt-add">${icon('plus')}<span>${t('tc.options.add')}</span></button>
          </section>

          <section class="card"><div class="card-head"><h2>${t('tc.welcome')}</h2></div>
            <div class="form">
              <label class="field full">${t('tc.welcome.title')}<input data-k="welcome.title" maxlength="200" value="${esc(c.welcome.title)}"></label>
              <label class="field full">${t('tc.welcome.message')}<textarea data-k="welcome.message" rows="4" maxlength="2000">${esc(c.welcome.message)}</textarea>
                <span class="hint">${t('tc.vars')} <code>{usuario}</code> <code>{motivo}</code> <code>{servidor}</code></span></label>
            </div>
          </section>

          <section class="card"><div class="card-head"><h2>${t('tc.rating')}</h2></div>
            <p class="hint">${t('tc.rating.hint')}</p>
            <div class="form">
              <label class="field switch-field full"><span>${t('tc.rating.on')}</span><span class="switch"><input type="checkbox" data-k="rating.enabled" ${c.rating.enabled ? 'checked' : ''}><i></i></span></label>
              <label class="field full">${t('tc.rating.message')}<textarea data-k="rating.message" rows="3" maxlength="1000">${esc(c.rating.message)}</textarea></label>
              <label class="field full">${t('tc.rating.channel')}<select id="rating-ch">${channelOptions(channels, data.ratingChannelId, { placeholder: data.reviewsChannelId ? t('tc.rating.channel.fallback') : t('ch.choose') })}</select></label>
            </div>
          </section>

          <div class="builder-actions">
            <button class="btn primary" type="submit">${icon('check')}<span>${t('act.save')}</span></button>
            <button class="btn ghost" type="button" id="tk-reset">${t('tc.reset')}</button>
          </div>

          <section class="card"><div class="card-head"><h2>${t('tc.publish')}</h2>${data.published.channelId ? `<span class="pill ok"><i></i>${t('tc.published')}</span>` : `<span class="pill off"><i></i>${t('tc.notpublished')}</span>`}</div>
            <p class="hint">${data.published.channelId ? t('tc.publish.auto') : t('tc.publish.hint')}</p>
            <div class="row-gap"><select id="pub-ch" style="flex:1;min-width:200px">${channelOptions(channels, data.published.channelId)}</select>
              <button class="btn" type="button" id="tk-publish">${icon('external')}<span>${t('tc.publish.btn')}</span></button>
              ${data.published.channelId && data.published.messageId ? `<a class="btn ghost" href="https://discord.com/channels/${data.guildId}/${data.published.channelId}/${data.published.messageId}" target="_blank" rel="noopener">${t('community.open.discord')}</a>` : ''}</div>
          </section>
        </form>

        <aside class="builder-preview">
          <div class="seg wide" role="tablist">
            <button type="button" data-pv="panel" class="on">${t('tc.pv.panel')}</button>
            <button type="button" data-pv="welcome">${t('tc.pv.welcome')}</button>
            <button type="button" data-pv="rating">${t('tc.pv.rating')}</button>
          </div>
          <div class="preview-surface" id="tk-preview"></div>
          <p class="hint">${t('preview.hint')}</p>
        </aside>
      </div>`;

    const get = (path) => path.split('.').reduce((o, k) => o[k], c);
    const set = (path, v) => { const ks = path.split('.'); ks.slice(0, -1).reduce((o, k) => o[k], c)[ks.at(-1)] = v; };
    const firstEnabled = () => c.options.find((o) => o.enabled) || { label: '—' };
    const renderPreview = () => {
      const el = $('#tk-preview');
      if (previewTab === 'panel') {
        el.innerHTML = discordPreview({ title: c.panel.title, description: c.panel.description, color: c.panel.color, image: c.panel.banner, thumbnail: c.panel.thumbnail ? 'logo' : '', footer: c.panel.footer || `${ME.store.bot} • ${ME.store.name}`, footerIcon: true },
          { select: { placeholder: c.panel.placeholder, options: c.options.filter((o) => o.enabled) } });
      } else if (previewTab === 'welcome') {
        const fill = (s) => s.replace(/\{motivo\}/g, firstEnabled().label).replace(/\{servidor\}/g, ME.store.name);
        el.innerHTML = discordPreview({ title: fill(c.welcome.title).replace(/\{usuario\}/g, ME.name), description: fill(c.welcome.message).replace(/\{usuario\}/g, `@${ME.name}`), color: c.panel.color, thumbnail: 'logo', footer: `${ME.store.bot} • ${ME.store.name}`, footerIcon: true },
          { content: `@${ME.name}`, buttons: [{ label: t('tc.btn.claim'), style: 'secondary' }, { label: t('tc.btn.call'), style: 'secondary' }, { label: t('tc.btn.close'), style: 'danger' }] });
      } else {
        el.innerHTML = c.rating.enabled ? discordPreview({ title: t('tc.rating.title'), description: c.rating.message, color: c.panel.color, thumbnail: 'logo', footer: `${ME.store.name} • ${t('tc.rating.footer')}`, footerIcon: true },
          { buttons: [1, 2, 3, 4, 5].map((n) => ({ label: `${n} ★`, style: n >= 4 ? 'success' : n <= 2 ? 'danger' : 'secondary' })) })
          : emptyState('star', t('tc.rating.off'));
      }
    };
    const renderOptions = () => {
      $('#opt-count').textContent = `${c.options.length}/20`;
      $('#opt-list').innerHTML = c.options.map((o, i) => `
        <div class="opt ${o.enabled ? '' : 'off'}" data-i="${i}">
          <input class="opt-emoji" data-o="emoji" maxlength="64" placeholder="🙂" value="${esc(o.emoji)}" aria-label="${t('tc.opt.emoji')}">
          <div class="opt-text"><input data-o="label" maxlength="100" placeholder="${t('tc.opt.label')}" value="${esc(o.label)}">
            <input data-o="description" maxlength="100" placeholder="${t('tc.opt.desc')}" value="${esc(o.description)}"></div>
          <div class="opt-tools">
            <label class="switch" title="${t('tc.opt.enabled')}"><input type="checkbox" data-o="enabled" ${o.enabled ? 'checked' : ''}><i></i></label>
            <button class="mini-btn" type="button" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="↑">${icon('up')}</button>
            <button class="mini-btn" type="button" data-move="1" ${i === c.options.length - 1 ? 'disabled' : ''} aria-label="↓">${icon('down')}</button>
            <button class="mini-btn danger" type="button" data-del aria-label="${t('tc.opt.remove')}">${icon('x')}</button>
          </div>
        </div>`).join('');
      $('#opt-add').disabled = c.options.length >= 20;
    };
    renderOptions();
    renderPreview();

    const form = $('#tkform');
    form.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (k) {
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        set(k, v);
        if (k === 'panel.color') $$(`[data-k="panel.color"]`, form).forEach((x) => { if (x !== e.target && /^#[0-9a-f]{6}$/i.test(v)) x.value = v; });
      }
      const row = e.target.closest('.opt');
      if (row && e.target.dataset.o) {
        const o = c.options[Number(row.dataset.i)];
        o[e.target.dataset.o] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (e.target.dataset.o === 'enabled') row.classList.toggle('off', !e.target.checked);
      }
      renderPreview();
    });
    form.addEventListener('change', (e) => { if (e.target.type === 'checkbox') form.dispatchEvent(new Event('input', { bubbles: true })); });
    $('#opt-list').addEventListener('click', (e) => {
      const row = e.target.closest('.opt');
      if (!row) return;
      const i = Number(row.dataset.i);
      const mv = e.target.closest('[data-move]');
      if (mv) { const j = i + Number(mv.dataset.move); [c.options[i], c.options[j]] = [c.options[j], c.options[i]]; renderOptions(); renderPreview(); }
      if (e.target.closest('[data-del]')) { c.options.splice(i, 1); renderOptions(); renderPreview(); }
    });
    $('#opt-add').addEventListener('click', () => {
      c.options.push({ value: '', label: '', description: '', emoji: '', enabled: true });
      renderOptions(); renderPreview();
      $$('#opt-list .opt').at(-1)?.querySelector('[data-o="label"]').focus();
    });
    $$('[data-up]', form).forEach((b) => b.addEventListener('click', () => uploadInto(form.querySelector(`input[data-k="${b.dataset.up}"]`))));
    $$('[data-pv]', box).forEach((b) => b.addEventListener('click', () => { previewTab = b.dataset.pv; $$('[data-pv]', box).forEach((x) => x.classList.toggle('on', x === b)); renderPreview(); }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; btn.classList.add('busy');
      try {
        const r = await api('ticket-config', { method: 'PUT', body: { ...c, ratingChannelId: $('#rating-ch').value } });
        toast(r.message);
        renderTicketCustomize(r.data, channels);
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.classList.remove('busy'); }
    });
    $('#tk-publish').addEventListener('click', async () => {
      const ch = $('#pub-ch').value;
      if (!ch) { toast(t('ch.choose'), 'err'); return; }
      try {
        await api('ticket-config', { method: 'PUT', body: { ...c, ratingChannelId: $('#rating-ch').value } });
        const r = await api('ticket-config/publish', { method: 'POST', body: { channelId: ch } });
        toast(r.message); renderTicketCustomize(r.data, channels);
      } catch (err) { toast(err.message, 'err'); }
    });
    $('#tk-reset').addEventListener('click', async () => {
      if (!await ask({ title: t('tc.reset.q'), body: t('tc.reset.body'), confirm: t('tc.reset'), danger: true })) return;
      try { const r = await api('ticket-config/reset', { method: 'POST', body: {} }); toast(r.message); renderTicketCustomize(r.data, channels); } catch (err) { toast(err.message, 'err'); }
    });
  }

  /* ============================== Embeds ============================== */

  const EMBED_TEMPLATES = {
    blank: { title: '', description: '', color: '#f2f2f2', buttons: [] },
    rules: { title: '📜 Regras do servidor', description: '**1.** Respeite todos os membros.\n**2.** Sem spam ou divulgação sem permissão.\n**3.** Conteúdos pagos são pessoais: não compartilhe.\n**4.** Dúvidas? Abra um ticket.', color: '#f2f2f2', footer: 'A equipe agradece!', buttons: [{ label: 'Abrir ticket', emoji: '🎫', action: 'ticket', style: 'secondary' }] },
    welcome: { title: 'Bem-vindo(a) à Cutify!', description: 'Aqui você encontra **VIPs, CCs, presets e cursos** de edição.\n\nComece pela loja e fique de olho nos anúncios.', color: '#f2f2f2', image: '', buttons: [{ label: 'Abrir loja', emoji: '🛒', action: 'store', style: 'primary' }, { label: 'Suporte', emoji: '💬', action: 'ticket', style: 'secondary' }] },
    announce: { title: '📢 Novidade na loja', description: 'Chegou um pack novo! Confira na loja com **10% de desconto** usando o cupom `CUTIFY10`.', color: '#f2f2f2', timestamp: true, buttons: [{ label: 'Ver na loja', emoji: '🛒', action: 'store', style: 'success' }] },
    roles: { title: 'Escolha seus cargos', description: 'Clique para receber (ou tirar) o cargo de notificações.', color: '#f2f2f2', buttons: [] },
  };

  async function pageEmbeds(params) {
    const id = params.get('id');
    if (id) return embedBuilder(id === 'new' ? null : Number(id), params.get('tpl'));
    setTitle('nav.embeds', `<a class="btn primary" href="#/embeds?id=new">${icon('plus')}<span>${t('emb.new')}</span></a>`);
    loading();
    const list = await api('embeds');
    view.innerHTML = `
      <section class="card"><div class="card-head"><h2>${t('emb.templates')}</h2></div>
        <div class="tpl-grid">${Object.keys(EMBED_TEMPLATES).map((k) => `<a class="tpl" href="#/embeds?id=new&tpl=${k}">${icon(k === 'blank' ? 'plus' : k === 'roles' ? 'crown' : k === 'rules' ? 'orders' : k === 'announce' ? 'alert' : 'home')}<span>${t(`emb.tpl.${k}`)}</span></a>`).join('')}</div>
      </section>
      ${list.length ? `<div class="grid emb-grid">${list.map((r) => `
        <article class="card emb-card">
          <a class="emb-hit" href="#/embeds?id=${r.id}" aria-label="${t('act.edit')} ${esc(r.name)}"></a>
          <div class="emb-mini" style="border-color:${/^#[0-9a-f]{6}$/i.test(r.data.color) ? r.data.color : '#f2f2f2'}">
            ${r.data.title ? `<b>${esc(r.data.title)}</b>` : ''}<p>${esc((r.data.description || '').slice(0, 140))}</p>
            ${r.data.image ? `<img src="${safeUrl(r.data.image)}" alt="" loading="lazy">` : ''}
          </div>
          <div class="emb-foot"><div class="grow"><div class="title">${esc(r.name)}</div><div class="meta">${r.channelId ? t('emb.published') : t('emb.draft')} · ${plural(r.data.buttons.length, 'emb.btn1', 'emb.btnN')} · ${ago(r.updatedAt)}</div></div>
            ${r.channelId && r.messageId ? `<a class="mini-btn" href="https://discord.com/channels/${ME.guildId}/${r.channelId}/${r.messageId}" target="_blank" rel="noopener" aria-label="${t('community.open.discord')}">${icon('external')}</a>` : ''}</div>
        </article>`).join('')}</div>` : emptyState('layers', t('emb.none'), t('emb.none.hint'))}`;
  }

  async function embedBuilder(id, tpl) {
    setTitle(id ? 'emb.edit' : 'emb.new', `<a class="btn ghost" href="#/embeds">← ${t('act.back')}</a>`);
    loading();
    const [list, channels, roles] = await Promise.all([id ? api('embeds') : Promise.resolve([]), api('channels').catch(() => []), api('roles').catch(() => [])]);
    const rec = id ? list.find((x) => x.id === id) : null;
    if (id && !rec) { view.innerHTML = emptyState('alert', t('emb.notfound'), '', `<a class="btn" href="#/embeds">${t('act.back')}</a>`); return; }
    const base = rec ? rec.data : (EMBED_TEMPLATES[tpl] || EMBED_TEMPLATES.blank);
    const d = { title: '', url: '', description: '', color: '#f2f2f2', image: '', thumbnail: '', author: '', footer: '', timestamp: false, content: '', ...JSON.parse(JSON.stringify(base)) };
    d.buttons = (d.buttons || []).map((b) => ({ label: '', emoji: '', action: 'link', value: '', style: 'secondary', ...b }));
    let name = rec?.name || '';
    const assignable = roles.filter((r) => r.assignable);

    view.innerHTML = `
      <div class="builder">
        <form class="builder-form" id="embform" novalidate>
          <section class="card"><div class="form">
            <label class="field">${t('emb.name')}<input id="emb-name" maxlength="80" placeholder="${t('emb.name.ph')}" value="${esc(name)}"></label>
            <label class="field">${t('emb.channel')}<select id="emb-ch">${channelOptions(channels, rec?.channelId)}</select></label>
          </div></section>
          <section class="card"><div class="card-head"><h2>${t('emb.content')}</h2></div><div class="form">
            <label class="field full">${t('emb.text')}<textarea data-k="content" rows="2" maxlength="2000" placeholder="${t('emb.text.ph')}">${esc(d.content)}</textarea></label>
            <label class="field">${t('emb.author')}<input data-k="author" maxlength="256" value="${esc(d.author)}"></label>
            <label class="field">${t('tc.color')}<div class="affix color"><input type="color" data-k="color" value="${esc(d.color)}"><input data-k="color" class="mono" maxlength="7" value="${esc(d.color)}"></div></label>
            <label class="field full">${t('tc.title')}<input data-k="title" maxlength="256" value="${esc(d.title)}"></label>
            <label class="field full">${t('emb.url')}<input data-k="url" placeholder="https://..." value="${esc(d.url)}"></label>
            <label class="field full">${t('tc.description')}<textarea data-k="description" rows="7" maxlength="4000">${esc(d.description)}</textarea>
              <span class="hint"><span id="desc-count"></span> · ${t('tc.md')}</span></label>
            <label class="field full">${t('emb.image')}<div class="affix"><input data-k="image" placeholder="https://..." value="${esc(d.image)}"><button class="btn small" type="button" data-up="image">${icon('download')}<span>${t('pf.upload')}</span></button></div></label>
            <label class="field full">${t('emb.thumb')}<div class="affix"><input data-k="thumbnail" placeholder="https://..." value="${esc(d.thumbnail)}"><button class="btn small" type="button" data-up="thumbnail">${icon('download')}<span>${t('pf.upload')}</span></button></div></label>
            <label class="field">${t('tc.footer')}<input data-k="footer" maxlength="2048" value="${esc(d.footer)}"></label>
            <label class="field switch-field"><span>${t('emb.timestamp')}</span><span class="switch"><input type="checkbox" data-k="timestamp" ${d.timestamp ? 'checked' : ''}><i></i></span></label>
          </div></section>
          <section class="card"><div class="card-head"><h2>${t('emb.buttons')}</h2><span class="muted mono" id="btn-count"></span></div>
            <p class="hint">${t('emb.buttons.hint')}</p>
            <div class="btn-list" id="btn-list"></div>
            <button class="btn small" type="button" id="btn-add">${icon('plus')}<span>${t('emb.buttons.add')}</span></button>
          </section>
          <div class="builder-actions">
            <button class="btn primary" type="submit" data-publish="1">${icon('external')}<span>${t(rec?.channelId ? 'emb.update' : 'emb.publish')}</span></button>
            <button class="btn" type="submit" data-publish="0">${t('emb.saveonly')}</button>
            ${rec ? `<button class="btn danger" type="button" id="emb-del">${t('emb.delete')}</button>` : ''}
          </div>
        </form>
        <aside class="builder-preview"><div class="preview-surface" id="emb-preview"></div><p class="hint">${t('preview.hint')}</p></aside>
      </div>`;

    const form = $('#embform');
    const renderPreview = () => {
      $('#emb-preview').innerHTML = discordPreview(d, { buttons: d.buttons, content: d.content });
      $('#desc-count').textContent = `${d.description.length}/4000`;
    };
    const renderButtons = () => {
      $('#btn-count').textContent = `${d.buttons.length}/10`;
      $('#btn-list').innerHTML = d.buttons.map((b, i) => `
        <div class="ebtn" data-i="${i}">
          <div class="ebtn-row">
            <input class="opt-emoji" data-b="emoji" maxlength="64" placeholder="🙂" value="${esc(b.emoji)}" aria-label="${t('tc.opt.emoji')}">
            <input data-b="label" maxlength="80" placeholder="${t('emb.btn.label')}" value="${esc(b.label)}">
            <select data-b="action">${['link', 'store', 'ticket', 'role'].map((a) => `<option value="${a}" ${b.action === a ? 'selected' : ''}>${t(`emb.act.${a}`)}</option>`).join('')}</select>
          </div>
          <div class="ebtn-row">
            ${b.action === 'link' ? `<input data-b="value" placeholder="https://..." value="${esc(b.value)}">` : ''}
            ${b.action === 'role' ? `<select data-b="value"><option value="">${t('emb.btn.role')}</option>${assignable.map((r) => `<option value="${esc(r.id)}" ${r.id === b.value ? 'selected' : ''}>@${esc(r.name)}</option>`).join('')}</select>` : ''}
            ${b.action !== 'link' ? `<select data-b="style">${['primary', 'secondary', 'success', 'danger'].map((st) => `<option value="${st}" ${b.style === st ? 'selected' : ''}>${t(`emb.style.${st}`)}</option>`).join('')}</select>` : ''}
            <span class="grow"></span>
            <button class="mini-btn" type="button" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="↑">${icon('up')}</button>
            <button class="mini-btn" type="button" data-move="1" ${i === d.buttons.length - 1 ? 'disabled' : ''} aria-label="↓">${icon('down')}</button>
            <button class="mini-btn danger" type="button" data-del aria-label="${t('tc.opt.remove')}">${icon('x')}</button>
          </div>
          ${b.action === 'role' && !assignable.length ? `<p class="hint">${t('emb.btn.norole')}</p>` : ''}
        </div>`).join('');
      $('#btn-add').disabled = d.buttons.length >= 10;
    };
    renderButtons();
    renderPreview();

    form.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (k) {
        d[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (k === 'color') $$('[data-k="color"]', form).forEach((x) => { if (x !== e.target && /^#[0-9a-f]{6}$/i.test(d.color)) x.value = d.color; });
      }
      const row = e.target.closest('.ebtn');
      if (row && e.target.dataset.b) {
        const b = d.buttons[Number(row.dataset.i)];
        b[e.target.dataset.b] = e.target.value;
        if (e.target.dataset.b === 'action') { b.value = ''; if (b.action === 'store') b.style = 'primary'; if (b.action === 'role') b.style = 'success'; renderButtons(); }
      }
      renderPreview();
    });
    form.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') form.dispatchEvent(new Event('input', { bubbles: true })); });
    $('#emb-name').addEventListener('input', (e) => { name = e.target.value; });
    $('#btn-list').addEventListener('click', (e) => {
      const row = e.target.closest('.ebtn');
      if (!row) return;
      const i = Number(row.dataset.i);
      const mv = e.target.closest('[data-move]');
      if (mv) { const j = i + Number(mv.dataset.move); [d.buttons[i], d.buttons[j]] = [d.buttons[j], d.buttons[i]]; renderButtons(); renderPreview(); }
      if (e.target.closest('[data-del]')) { d.buttons.splice(i, 1); renderButtons(); renderPreview(); }
    });
    $('#btn-add').addEventListener('click', () => {
      d.buttons.push({ label: '', emoji: '', action: tpl === 'roles' ? 'role' : 'link', value: '', style: tpl === 'roles' ? 'success' : 'secondary' });
      renderButtons(); renderPreview();
      $$('#btn-list .ebtn').at(-1)?.querySelector('[data-b="label"]').focus();
    });
    $$('[data-up]', form).forEach((b) => b.addEventListener('click', () => uploadInto(form.querySelector(`input[data-k="${b.dataset.up}"]`))));
    let publish = true;
    $$('[data-publish]', form).forEach((b) => b.addEventListener('click', () => { publish = b.dataset.publish === '1'; }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter || form.querySelector('[type=submit]');
      const body = { name: name || d.title, channelId: $('#emb-ch').value || null, data: d, publish };
      if (publish && !body.channelId) { toast(t('ch.choose'), 'err'); $('#emb-ch').focus(); return; }
      btn.disabled = true; btn.classList.add('busy');
      try {
        const r = await api(rec ? `embeds/${rec.id}` : 'embeds', { method: rec ? 'PUT' : 'POST', body });
        toast(r.message);
        if (!rec) { location.hash = `#/embeds?id=${r.embed.id}`; return; }
        embedBuilder(r.embed.id);
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.classList.remove('busy'); }
    });
    $('#emb-del')?.addEventListener('click', async () => {
      if (!await ask({ title: t('emb.delete.q'), body: t('emb.delete.body'), confirm: t('emb.delete'), danger: true })) return;
      try { const r = await api(`embeds/${rec.id}/delete`, { method: 'POST', body: {} }); toast(r.message); location.hash = '#/embeds'; } catch (err) { toast(err.message, 'err'); }
    });
  }

  /* ============================== Comunidade ============================== */

  const T_KIND = { inscricoes: 'wait', andamento: 'warn', finalizado: 'ok', cancelado: 'off' };
  async function pageCommunity() {
    setTitle('nav.community');
    loading();
    renderCommunity(await api('community'));
  }
  function renderCommunity(d) {
    if (!location.hash.startsWith('#/comunidade')) return;
    const link = (ch, msg) => (ch && msg ? `<a class="btn small" href="https://discord.com/channels/${d.guildId}/${ch}/${msg}" target="_blank" rel="noopener">${icon('external')}<span>${t('community.open.discord')}</span></a>` : '');
    const tCards = d.tournaments.map((x) => {
      const prog = x.matchesTotal ? x.matchesDone / x.matchesTotal : 0;
      return `<article class="card comm">
        <div class="comm-top"><h3>${esc(x.name)}</h3><span class="pill ${T_KIND[x.status]}"><i></i>${t(`community.t.${x.status}`)}</span></div>
        <div class="meta">${t('community.players', { a: x.players, b: x.maxPlayers })}${x.prize ? ` · ${t('community.prize')}: ${esc(x.prize)}` : ''}</div>
        ${x.status === 'andamento' || x.status === 'finalizado' ? `<div class="meter"><i style="width:${(prog * 100).toFixed(0)}%"></i></div>
          <div class="meta">${t('community.matches', { a: x.matchesDone, b: x.matchesTotal })}</div>` : ''}
        ${x.winnerId ? `<div class="champ">${icon('trophy')}<span>${t('community.champion')}: <b>${who(x.winnerId, x.winnerName)}</b></span></div>` : ''}
        <div class="actions">${link(x.channelId, x.messageId)}${['inscricoes', 'andamento'].includes(x.status) ? `<button class="btn small danger" data-cancel-t="${x.id}">${t('community.cancel')}</button>` : ''}</div>
      </article>`;
    }).join('');
    const pCards = d.polls.map((x) => {
      const open = x.status === 'aberta';
      return `<article class="card comm">
        <div class="comm-top"><h3>${esc(x.question)}</h3><span class="pill ${open ? 'wait' : 'off'}"><i></i>${t(open ? 'community.poll.open' : 'community.poll.closed')}</span></div>
        <div class="hbars">${x.options.map((o, k) => {
          const pctv = x.total ? x.counts[k] / x.total : 0;
          const win = !open && x.winners.includes(k);
          return `<div class="hbar ${win ? 'win' : ''}"><div class="hbar-top"><span>${String.fromCharCode(65 + k)}. ${esc(o)}${win ? ' ✔' : ''}</span><span class="mono">${pct(pctv)} · ${x.counts[k]}</span></div>
            <div class="hbar-track"><i style="width:${Math.max(pctv * 100, x.counts[k] ? 2 : 0).toFixed(1)}%"></i></div></div>`;
        }).join('')}</div>
        <div class="meta">${plural(x.total, 'community.votes1', 'community.votesN')}${open && x.endsAt ? ` · ${t('community.ends', { d: until(x.endsAt) })}` : ''}${x.hidden ? ` · ${t('community.hidden')}` : ''}</div>
        <div class="actions">${link(x.channelId, x.messageId)}${open ? `<button class="btn small" data-close-p="${x.id}">${t('community.close')}</button>` : ''}</div>
      </article>`;
    }).join('');
    const chip = (on) => `<span class="pill ${on ? 'ok' : 'off'}"><i></i>${t(on ? 'settings.on' : 'settings.off')}</span>`;
    view.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>${t('community.media')}</h2></div>
        <div class="grid media-st">
          <div class="stat row-gap between">${icon('film')}<span class="grow"><b>/video</b><br><small class="muted">${t('community.video')}</small></span>${chip(d.media.video)}</div>
          <div class="stat row-gap between">${icon('music')}<span class="grow"><b>/musica</b><br><small class="muted">${t('community.music')}</small></span>${chip(d.media.music)}</div>
        </div>
        <p class="hint">${t('community.media.hint')}</p>
      </section>
      <h2 class="section-title">${icon('trophy')} ${t('community.tournaments')}</h2>
      ${tCards ? `<div class="grid comm-grid">${tCards}</div>` : emptyState('trophy', t('community.none.t'), t('community.none.t.hint'))}
      <h2 class="section-title">${icon('orders')} ${t('community.polls')}</h2>
      ${pCards ? `<div class="grid comm-grid">${pCards}</div>` : emptyState('orders', t('community.none.p'), t('community.none.p.hint'))}`;
    $$('[data-cancel-t]', view).forEach((b) => b.addEventListener('click', async () => {
      if (!await ask({ title: t('community.cancel.q'), body: t('community.cancel.body'), confirm: t('community.cancel'), danger: true })) return;
      try { const r = await api(`community/tournaments/${b.dataset.cancelT}/cancel`, { method: 'POST', body: {} }); toast(r.message); renderCommunity(r.data); } catch (e) { toast(e.message, 'err'); }
    }));
    $$('[data-close-p]', view).forEach((b) => b.addEventListener('click', async () => {
      if (!await ask({ title: t('community.close.q'), confirm: t('community.close') })) return;
      try { const r = await api(`community/polls/${b.dataset.closeP}/close`, { method: 'POST', body: {} }); toast(r.message); renderCommunity(r.data); } catch (e) { toast(e.message, 'err'); }
    }));
  }

  /* ============================== Avaliações ============================== */

  async function pageReviews() {
    setTitle('nav.reviews');
    loading();
    renderReviews(await api('reviews'));
  }
  function renderReviews(list) {
    if (!location.hash.startsWith('#/avaliacoes')) return;
    const visible = list.filter((r) => !r.hidden);
    const avg = visible.length ? visible.reduce((s, r) => s + r.rating, 0) / visible.length : 0;
    const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: visible.filter((r) => r.rating === n).length }));
    view.innerHTML = list.length ? `
      <div class="grid two rev">
        <section class="card rating-card"><div class="big-rating mono">${avg.toFixed(1)}</div><div class="stars lg">${stars(Math.round(avg))}</div>
          <div class="muted">${plural(visible.length, 'reviews.count1', 'reviews.countN')}</div>
          <div class="dist">${dist.map((x) => `<div class="dist-row"><span>${x.n}★</span><div class="hbar-track"><i style="width:${visible.length ? (x.c / visible.length) * 100 : 0}%"></i></div><span class="mono">${x.c}</span></div>`).join('')}</div></section>
        <section class="card"><div class="list">${list.map((r) => `
          <div class="row static ${r.hidden ? 'dim' : ''}">
            <div class="grow"><div><span class="stars">${stars(r.rating)}</span> <span class="muted">· ${esc(r.product || '')}</span>${r.hidden ? ` <span class="pill off"><i></i>${t('reviews.hidden')}</span>` : ''}</div>
              <div class="quote">${r.comment ? `“${esc(r.comment)}”` : `<span class="muted">${t('reviews.nocomment')}</span>`}</div>
              <div class="meta"><a href="#" data-customer="${esc(r.userId)}">${who(r.userId, r.userName)}</a> · ${ago(r.createdAt)} · <a href="#" data-order="${esc(r.orderId)}" class="mono">${esc(r.orderId)}</a></div></div>
            <button class="btn small" data-toggle-review="${r.id}">${t(r.hidden ? 'reviews.show' : 'reviews.hide')}</button>
          </div>`).join('')}</div></section>
      </div>` : emptyState('star', t('reviews.none'), t('reviews.none.hint'));
  }

  /* ============================== Histórico ============================== */

  async function pageAudit(params) {
    setTitle('nav.history');
    const q = params.get('q') || '';
    view.innerHTML = `<div class="toolbar"><label class="search">${icon('search')}<input id="aq" type="search" placeholder="${t('history.search')}" value="${esc(q)}"></label></div><div id="audit-box">${skel(1, 'x')}</div>`;
    const load = async (qq) => {
      const list = await api(`audit?q=${encodeURIComponent(qq)}`);
      $('#audit-box').innerHTML = list.length ? `<div class="table-wrap"><table class="rtable">
        <thead><tr><th>${t('col.when')}</th><th>${t('col.who')}</th><th>${t('col.action')}</th><th>${t('col.details')}</th></tr></thead>
        <tbody>${list.map((a) => `<tr class="static"><td class="muted" data-label="${t('col.when')}" title="${dt(a.createdAt)}">${ago(a.createdAt)}</td>
          <td data-label="${t('col.who')}">${a.actorId ? who(a.actorId, a.actorName) : `<span class="muted">${t('history.system')}</span>`}</td>
          <td data-label="${t('col.action')}"><code>${esc(a.action)}</code></td><td class="muted wrap" data-label="${t('col.details')}">${esc(a.details || '')}</td></tr>`).join('')}</tbody></table></div>`
        : emptyState('history', t('history.none'));
    };
    let timer;
    $('#aq').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => load(e.target.value.trim()).catch(failed), 300); });
    await load(q);
  }

  /* ============================== Configurações ============================== */

  async function pageSettings() {
    setTitle('nav.settings');
    loading();
    const s = await api('settings');
    const chip = (ok, on, off) => `<span class="pill ${ok ? 'ok' : 'off'}"><i></i>${t(ok ? on : off)}</span>`;
    const ch = (c) => (c ? `<a class="link" href="https://discord.com/channels/${s.guildId}/${c.id}" target="_blank" rel="noopener">#${esc(c.name || c.id)}</a>` : `<span class="muted">${t('settings.notset')}</span>`);
    view.innerHTML = `
      <div class="grid settings">
        <section class="card">
          <div class="card-head"><h2>${t('settings.store')}</h2>${s.store.paused ? `<span class="pill warn"><i></i>${t('settings.paused')}</span>` : `<span class="pill ok"><i></i>${t('settings.open')}</span>`}</div>
          <p class="hint">${t('settings.pause.hint')}</p>
          <label class="field">${t('settings.pause.msg')}<input id="pause-msg" maxlength="300" placeholder="${t('settings.pause.ph')}" value="${esc(s.store.pausedMessage)}"></label>
          <div class="actions">${s.store.paused
            ? `<button class="btn primary" data-pause="0">${icon('play')}<span>${t('settings.reopen')}</span></button>`
            : `<button class="btn danger" data-pause="1">${icon('pause')}<span>${t('settings.pause')}</span></button>`}
            <button class="btn ghost" id="save-msg">${t('act.save')}</button></div>
        </section>

        <section class="card">
          <div class="card-head"><h2>${t('settings.appearance')}</h2></div>
          <label class="field">${t('settings.language')}<select id="set-lang">${['pt', 'en', 'es'].map((l) => `<option value="${l}" ${l === LANG ? 'selected' : ''}>${t(`lang.${l}`)}</option>`).join('')}</select></label>
          <div class="field"><span>${t('settings.theme')}</span><div class="seg wide">${['dark', 'light'].map((th) => `<button data-theme-set="${th}" class="${THEME === th ? 'on' : ''}">${icon(th === 'dark' ? 'moon' : 'sun')}<span>${t(`theme.${th}`)}</span></button>`).join('')}</div></div>
          <p class="hint">${t('settings.shortcuts')}</p>
        </section>

        <section class="card">
          <div class="card-head"><h2>${t('settings.payments')}</h2></div>
          <dl class="kv tight">
            <dt>${t('method.mercadopago')}</dt><dd>${chip(s.payments.mercadoPago, s.payments.mpTest ? 'settings.test' : 'settings.on', 'settings.off')}</dd>
            <dt>${t('settings.webhook')}</dt><dd>${s.payments.webhook ? chip(true, 'settings.on') : `<span class="pill"><i></i>${t('settings.polling', { n: s.payments.pollSeconds })}</span>`}</dd>
            <dt>${t('method.pix_manual')}</dt><dd>${chip(s.payments.pixManual, 'settings.on', 'settings.off')}</dd>
            <dt>${t('settings.expire')}</dt><dd>${t('settings.minutes', { n: s.payments.orderMinutes })}</dd>
          </dl>
        </section>

        <section class="card">
          <div class="card-head"><h2>${t('settings.channels')}</h2></div>
          <dl class="kv tight">
            ${['vendas', 'admin', 'erros', 'aprovacoes', 'avaliacoes', 'tickets'].map((k) => `<dt>${t(`ch.${k}`)}</dt><dd>${ch(s.channels[k])}</dd>`).join('')}
          </dl>
          <p class="hint">${t('settings.channels.hint')}</p>
        </section>

        <section class="card wide">
          <div class="card-head"><h2>${t('settings.terms')}</h2>${s.store.termsCustom ? '' : `<span class="pill"><i></i>${t('settings.default')}</span>`}</div>
          <textarea id="terms" rows="8" maxlength="3000">${esc(s.store.terms)}</textarea>
          <div class="actions"><button class="btn primary" id="save-terms">${t('act.save')}</button><span class="hint" id="terms-count"></span></div>
        </section>

        <section class="card wide">
          <div class="card-head"><h2>${icon('server')} ${t('settings.system')}</h2>${chip(s.system.botOnline, 'settings.online', 'settings.offline')}</div>
          <div class="grid sys">
            <div class="stat"><span>Bot</span><b>${esc(s.system.botTag || '—')}</b></div>
            <div class="stat"><span>${t('settings.ping')}</span><b class="mono">${s.system.ping != null ? `${s.system.ping} ms` : '—'}</b></div>
            <div class="stat"><span>${t('settings.uptime')}</span><b class="mono">${duration(s.system.uptime)}</b></div>
            <div class="stat"><span>${t('settings.memory')}</span><b class="mono">${s.system.memoryMb} MB</b></div>
            <div class="stat"><span>Node.js</span><b class="mono">${esc(s.system.node)}</b></div>
            <div class="stat"><span>${t('settings.db')}</span><b class="mono">${bytes(s.system.dbSize)}</b></div>
            <div class="stat"><span>${t('settings.backup.last')}</span><b>${s.system.backup ? ago(s.system.backup.at) : '—'}</b></div>
            <div class="stat"><span>${t('settings.admins')}</span><b class="mono">${s.system.admins}</b></div>
          </div>
          <div class="actions"><a class="btn" href="/api/backup">${icon('download')}<span>${t('settings.backup.dl')}</span></a>
            <span class="hint">${t('settings.backup.hint')}</span></div>
        </section>
      </div>`;

    const terms = $('#terms');
    const count = () => { $('#terms-count').textContent = `${terms.value.length}/3000`; };
    terms.addEventListener('input', count); count();
    const save = async (body, msg) => {
      try { const r = await api('settings', { method: 'PUT', body }); toast(msg || r.message); return r; } catch (e) { toast(e.message, 'err'); return null; }
    };
    $('#save-terms').addEventListener('click', () => save({ terms: terms.value }));
    $('#save-msg').addEventListener('click', () => save({ pausedMessage: $('#pause-msg').value }));
    $$('[data-pause]', view).forEach((b) => b.addEventListener('click', async () => {
      const pause = b.dataset.pause === '1';
      if (pause && !await ask({ title: t('settings.pause.q'), body: t('settings.pause.body'), confirm: t('settings.pause'), danger: true })) return;
      if (await save({ paused: pause, pausedMessage: $('#pause-msg').value }, t(pause ? 'settings.paused.ok' : 'settings.reopened.ok'))) {
        ME.paused = pause; applyPaused(); pageSettings().catch(failed);
      }
    }));
    $('#set-lang').addEventListener('change', (e) => setLang(e.target.value));
    $$('[data-theme-set]', view).forEach((b) => b.addEventListener('click', () => { setTheme(b.dataset.themeSet); $$('[data-theme-set]', view).forEach((x) => x.classList.toggle('on', x === b)); }));
  }

  /* ============================== Busca rápida (Ctrl+K) ============================== */

  const palette = $('#palette');
  const pq = $('#palette-q');
  let palIdx = 0;
  let palTimer;
  function openPalette() {
    pq.value = '';
    pq.placeholder = t('palette.ph');
    renderPalette({ orders: [], products: [], customers: [] });
    if (!palette.open) palette.showModal();
    pq.focus();
  }
  function renderPalette(r) {
    const q = pq.value.trim().toLowerCase();
    const nav = NAV.filter((n) => !q || t(n.key).toLowerCase().includes(q)).map((n) => ({ kind: 'nav', icon: n.icon, label: t(n.key), hint: t('palette.go'), href: `#/${n.path}` }));
    const actions = [
      { kind: 'act', icon: 'plus', label: t('products.new'), act: 'new-product' },
      { kind: 'act', icon: 'plus', label: t('coupons.new'), act: 'new-coupon' },
      { kind: 'act', icon: THEME === 'dark' ? 'sun' : 'moon', label: t(THEME === 'dark' ? 'theme.light' : 'theme.dark'), act: 'theme' },
      ...['pt', 'en', 'es'].filter((l) => l !== LANG).map((l) => ({ kind: 'act', icon: 'globe', label: t(`lang.${l}`), act: `lang:${l}` })),
    ].filter((a) => !q || a.label.toLowerCase().includes(q));
    const groups = [
      [t('nav.orders'), r.orders.map((o) => ({ kind: 'order', icon: 'orders', label: `${o.id} · ${o.product}`, hint: brl(o.total), id: o.id }))],
      [t('nav.products'), r.products.map((p) => ({ kind: 'product', icon: 'box', label: p.name, hint: brl(p.price), id: p.id }))],
      [t('nav.customers'), r.customers.map((c) => ({ kind: 'customer', icon: 'users', label: c.userName || c.userId, hint: c.userName ? c.userId : '', id: c.userId }))],
      [t('palette.pages'), nav],
      [t('palette.actions'), actions],
    ].filter(([, items]) => items.length);
    let i = 0;
    $('#palette-results').innerHTML = groups.length ? groups.map(([title, items]) => `<div class="pal-group"><div class="pal-title">${esc(title)}</div>
      ${items.map((it) => `<button class="pal-item" role="option" data-idx="${i++}" data-kind="${it.kind}" data-id="${esc(it.id ?? '')}" data-href="${esc(it.href ?? '')}" data-pact="${esc(it.act ?? '')}">
        ${icon(it.icon)}<span class="grow">${esc(it.label)}</span>${it.hint ? `<small class="mono muted">${esc(it.hint)}</small>` : ''}</button>`).join('')}</div>`).join('')
      : `<div class="pal-empty">${t('palette.none')}</div>`;
    palIdx = 0; highlight();
  }
  const highlight = () => $$('.pal-item').forEach((b) => b.classList.toggle('on', Number(b.dataset.idx) === palIdx));
  function runPal(b) {
    if (!b) return;
    palette.close();
    const { kind, id, href, pact } = b.dataset;
    if (kind === 'nav') location.hash = href;
    if (kind === 'order') showOrder(id);
    if (kind === 'product') productForm(id);
    if (kind === 'customer') showCustomer(id);
    if (kind === 'act') {
      if (pact === 'new-product') productForm(null);
      if (pact === 'new-coupon') { if (!location.hash.startsWith('#/cupons')) location.hash = '#/cupons'; couponForm(); }
      if (pact === 'theme') setTheme(THEME === 'dark' ? 'light' : 'dark');
      if (pact.startsWith('lang:')) setLang(pact.slice(5));
    }
  }
  pq.addEventListener('input', () => {
    clearTimeout(palTimer);
    renderPalette({ orders: [], products: [], customers: [] });
    const q = pq.value.trim();
    if (q.length < 2) return;
    palTimer = setTimeout(async () => { try { renderPalette(await api(`search?q=${encodeURIComponent(q)}`)); } catch { /* ignora */ } }, 180);
  });
  pq.addEventListener('keydown', (e) => {
    const items = $$('.pal-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, items.length - 1); highlight(); items[palIdx]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); highlight(); items[palIdx]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { e.preventDefault(); runPal(items[palIdx]); }
  });
  $('#palette-results').addEventListener('click', (e) => runPal(e.target.closest('.pal-item')));

  /* ============================== Navegação ============================== */

  const NAV = [
    { path: '', key: 'nav.home', icon: 'home', page: pageHome, tab: true },
    { path: 'pedidos', key: 'nav.orders', icon: 'orders', page: pageOrders, tab: true, badge: 'review' },
    { path: 'produtos', key: 'nav.products', icon: 'box', page: pageProducts, tab: true },
    { path: 'clientes', key: 'nav.customers', icon: 'users', page: pageCustomers, tab: true },
    { path: 'cupons', key: 'nav.coupons', icon: 'coupon', page: pageCoupons },
    { path: 'vips', key: 'nav.vips', icon: 'crown', page: pageVips },
    { path: 'tickets', key: 'nav.tickets', icon: 'ticket', page: pageTickets, badge: 'tickets' },
    { path: 'comunidade', key: 'nav.community', icon: 'trophy', page: pageCommunity },
    { path: 'embeds', key: 'nav.embeds', icon: 'layers', page: pageEmbeds },
    { path: 'avaliacoes', key: 'nav.reviews', icon: 'star', page: pageReviews },
    { path: 'historico', key: 'nav.history', icon: 'history', page: pageAudit },
    { path: 'configuracoes', key: 'nav.settings', icon: 'settings', page: pageSettings },
  ];
  const COUNTS = { review: 0, tickets: 0 };
  let PENDING = 0;
  const badge = (k) => (k && COUNTS[k] ? `<b class="badge">${COUNTS[k] > 99 ? '99+' : COUNTS[k]}</b>` : '');

  function renderNav() {
    const current = location.hash.replace(/^#\/?/, '').split('?')[0];
    const active = NAV.some((n) => n.path === current) ? current : '';
    $('#nav').innerHTML = NAV.map((n, i) => `${i === 4 ? `<div class="nav-sep">${t('nav.manage')}</div>` : ''}${i === 10 ? `<div class="nav-sep">${t('nav.system')}</div>` : ''}
      <a href="#/${n.path}" class="${n.path === active ? 'active' : ''}" ${n.path === active ? 'aria-current="page"' : ''}>${icon(n.icon)}<span>${t(n.key)}</span>${badge(n.badge)}</a>`).join('');
    const tabs = NAV.filter((n) => n.tab);
    const moreActive = !tabs.some((n) => n.path === active);
    const moreBadge = NAV.filter((n) => !n.tab && n.badge).reduce((s, n) => s + COUNTS[n.badge], 0);
    $('#tabbar').innerHTML = tabs.map((n) => `<a href="#/${n.path}" class="${n.path === active ? 'active' : ''}">${icon(n.icon)}<span>${t(n.key)}</span>${badge(n.badge)}</a>`).join('')
      + `<button type="button" class="${moreActive ? 'active' : ''}" data-act="more">${icon('more')}<span>${t('nav.more')}</span>${moreBadge ? `<b class="badge">${moreBadge}</b>` : ''}</button>`;
  }

  function openMore() {
    const sheet = $('#sheet');
    $('#sheet-body').innerHTML = `<div class="sheet-grip"></div>
      <div class="sheet-grid">${NAV.filter((n) => !n.tab).map((n) => `<a href="#/${n.path}">${icon(n.icon)}<span>${t(n.key)}</span>${badge(n.badge)}</a>`).join('')}</div>
      <div class="sheet-row"><label class="field">${t('settings.language')}<select id="sheet-lang">${['pt', 'en', 'es'].map((l) => `<option value="${l}" ${l === LANG ? 'selected' : ''}>${t(`lang.${l}`)}</option>`).join('')}</select></label>
        <button class="btn" data-act="theme">${icon(THEME === 'dark' ? 'sun' : 'moon')}<span>${t(THEME === 'dark' ? 'theme.light' : 'theme.dark')}</span></button></div>
      <div class="sheet-me">${$('#me').innerHTML}</div>`;
    $('#sheet-lang').addEventListener('change', (e) => { sheet.close(); setLang(e.target.value); });
    $$('a', $('#sheet-body')).forEach((a) => a.addEventListener('click', () => sheet.close()));
    sheet.showModal();
  }

  let routeToken = 0;
  async function route() {
    closeDrawer();
    for (const d of ['#sheet', '#palette']) if ($(d).open) $(d).close();
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const entry = NAV.find((n) => n.path === path) || NAV[0];
    renderNav();
    const token = ++routeToken;
    window.scrollTo(0, 0);
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    try { await entry.page(new URLSearchParams(qs || '')); } catch (e) { if (token === routeToken) failed(e); }
  }

  /* ============================== Ao vivo ============================== */

  let lastPoll = 0;
  async function pollCounts() {
    try {
      const [rev, tk] = await Promise.all([api('orders?status=em_analise&limit=1'), api('tickets?status=aberto')]);
      const before = COUNTS.review;
      COUNTS.review = rev.total;
      COUNTS.tickets = tk.counts.aberto || 0;
      PENDING = COUNTS.review;
      if (lastPoll && COUNTS.review > before) toast(plural(COUNTS.review, 'home.alert.review1', 'home.alert.reviewN'), 'warn');
      lastPoll = Date.now();
      renderNav();
      const title = document.title.replace(/^\(\d+\) /, '');
      document.title = `${PENDING ? `(${PENDING}) ` : ''}${title}`;
      $('#live').hidden = false;
      $('#live-text').textContent = t('live');
    } catch { $('#live').hidden = true; }
  }

  function applyPaused() {
    const b = $('#paused-banner');
    b.hidden = !ME?.paused;
    b.innerHTML = `${icon('pause')}<span>${t('banner.paused')}</span><a href="#/configuracoes">${t('banner.manage')} →</a>`;
  }

  /** Textos fixos da página (menu, busca, botões do topo). */
  function applyChrome() {
    document.documentElement.lang = LOCALES[LANG];
    $('.skip').textContent = t('skip');
    $('#search-label').textContent = t('act.search');
    $('#search-kbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
    $('#lang-label').textContent = t('settings.language');
    $('#lang-select').value = LANG;
    $('#brand-sub').textContent = t('brand.sub');
    setTheme(THEME);
    if (ME) {
      const avatar = ME.avatar ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(ME.id)}/${encodeURIComponent(ME.avatar)}.png?size=64` : '/painel/logo.png';
      $('#me').innerHTML = `<img src="${esc(avatar)}" alt=""><div><strong>${esc(ME.name)}</strong><small>${t('me.admin')}</small></div>
        <a class="icon-btn" href="/logout" title="${t('act.logout')}" aria-label="${t('act.logout')}">${icon('logout')}</a>`;
      $('#status-line').innerHTML = `<span class="dot ${ME.features.mercadoPago || ME.features.pixManual ? 'ok' : 'bad'}"></span>${t(ME.features.mercadoPago ? 'status.mp' : ME.features.pixManual ? 'status.manual' : 'status.nopay')}`;
      applyPaused();
    }
  }

  /* ============================== Eventos globais ============================== */

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-order],[data-product],[data-customer],[data-act],[data-toggle-review],[data-copy],[data-duplicate],[data-page]');
    if (!el) return;
    if (el.dataset.copy) { e.preventDefault(); e.stopPropagation(); copy(el.dataset.copy); return; }
    if (el.dataset.duplicate) { e.preventDefault(); duplicateProduct(el.dataset.duplicate); return; }
    if (el.dataset.page) {
      const st = el.dataset.kind === 'customers' ? custState : ordersState;
      st.offset = Math.max(0, st.offset + Number(el.dataset.page) * 30);
      (el.dataset.kind === 'customers' ? loadCustomers : loadOrders)();
      return;
    }
    if (el.dataset.order) { e.preventDefault(); showOrder(el.dataset.order); return; }
    if (el.dataset.customer) { e.preventDefault(); showCustomer(el.dataset.customer); return; }
    if (el.dataset.product) { e.preventDefault(); productForm(el.dataset.product); return; }
    if (el.dataset.toggleReview) {
      api(`reviews/${el.dataset.toggleReview}/toggle`, { method: 'POST', body: {} }).then(renderReviews).catch((err) => toast(err.message, 'err'));
      return;
    }
    const act = el.dataset.act;
    if (act === 'close') closeDrawer();
    if (act === 'reload') route();
    if (act === 'new-product') productForm(null);
    if (act === 'new-coupon') couponForm();
    if (act === 'more') openMore();
    if (act === 'theme') { setTheme(THEME === 'dark' ? 'light' : 'dark'); if ($('#sheet').open) $('#sheet').close(); }
  });
  view.addEventListener('change', async (e) => {
    const pid = e.target.dataset?.toggleProduct;
    if (pid) {
      try {
        await api(`products/${pid}`, { method: 'PUT', body: { active: e.target.checked } });
        toast(t(e.target.checked ? 'products.shown' : 'products.hidden'));
        const p = PRODS.find((x) => String(x.id) === pid);
        if (p) p.active = e.target.checked;
        renderProducts();
      } catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
      return;
    }
    const code = e.target.dataset?.toggleCoupon;
    if (!code) return;
    try { renderCoupons(await api(`coupons/${encodeURIComponent(code)}/toggle`, { method: 'POST', body: {} })); } catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
      const s = $('.toolbar input[type=search]', view);
      if (s) { e.preventDefault(); s.focus(); }
    }
    if (e.key === 'Enter' && !typing) {
      const row = e.target.closest?.('tr[data-order],tr[data-customer]');
      if (row) row.click();
    }
  });
  $('#open-palette').addEventListener('click', openPalette);
  $('#theme-btn').addEventListener('click', () => setTheme(THEME === 'dark' ? 'light' : 'dark'));
  $('#lang-select').addEventListener('change', (e) => setLang(e.target.value));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastPoll > 20000) pollCounts(); });

  async function boot() {
    applyChrome();
    try { ME = await api('me'); } catch (e) { view.innerHTML = emptyState('alert', t('err.load'), esc(e.message)); return; }
    $('#brand-name').textContent = ME.store.name;
    applyChrome();
    window.addEventListener('hashchange', route);
    await route();
    pollCounts();
    setInterval(() => { if (!document.hidden) pollCounts(); }, 30000);
  }
  boot();
})();
