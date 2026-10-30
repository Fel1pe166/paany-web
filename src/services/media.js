// Busca de vídeos e músicas de uso livre para editores.
//  - Vídeos: Pexels (preferido) ou Pixabay — banco de vídeos gratuitos
//  - Músicas: Jamendo — faixas Creative Commons, com download só quando o artista permite
// Não baixa nada de YouTube/TikTok/Spotify: isso viola os termos dessas plataformas.
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { one, run } from '../db.js';

const CACHE_MS = 24 * 3600_000; // Pixabay exige cache de 24h
export const mediaFeatures = () => ({
  video: Boolean(config.pexelsKey || config.pixabayKey),
  music: Boolean(config.jamendoClientId),
});

const keyOf = (kind, q, extra = '') => createHash('sha1').update(`${kind}|${q.toLowerCase()}|${extra}`).digest('hex').slice(0, 16);

export function cached(key) {
  const row = one('SELECT * FROM media_cache WHERE key = ?', key);
  if (!row || Date.now() - row.created_at > CACHE_MS) return null;
  return { key, query: row.query, kind: row.kind, items: JSON.parse(row.data) };
}
function store(key, kind, query, items) {
  run(`INSERT INTO media_cache(key, query, kind, data, created_at) VALUES(?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`, key, query, kind, JSON.stringify(items), Date.now());
  // Limpeza simples dos antigos
  run('DELETE FROM media_cache WHERE created_at < ?', Date.now() - CACHE_MS * 2);
}

async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.status === 429) throw new Error('Limite de buscas da API atingido. Tente daqui a pouco.');
    if (!res.ok) throw new Error(`A API respondeu ${res.status}.`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------- Vídeos --------------------------------- */

/** Escolhe o arquivo mais próximo de Full HD (bom para edição e não gigante). */
function bestFile(files) {
  const mp4 = files.filter((f) => !f.file_type || f.file_type === 'video/mp4');
  const list = (mp4.length ? mp4 : files).filter((f) => f.link);
  list.sort((a, b) => Math.abs((a.height || 0) - 1080) - Math.abs((b.height || 0) - 1080));
  return list[0] || null;
}

export function mapPexels(data) {
  return (data.videos || []).map((v) => {
    const f = bestFile(v.video_files || []);
    return f && {
      id: `px${v.id}`, source: 'Pexels', page: v.url, author: v.user?.name || 'Pexels', authorUrl: v.user?.url || v.url,
      duration: v.duration || null, width: f.width, height: f.height, download: f.link, thumb: v.image || null, title: null,
    };
  }).filter(Boolean);
}

export function mapPixabay(data) {
  return (data.hits || []).map((v) => {
    const f = v.videos?.large?.url ? v.videos.large : v.videos?.medium;
    return f?.url && {
      id: `pb${v.id}`, source: 'Pixabay', page: v.pageURL, author: v.user || 'Pixabay', authorUrl: `https://pixabay.com/users/${encodeURIComponent(v.user)}-${v.user_id}/`,
      duration: v.duration || null, width: f.width, height: f.height, download: f.url, thumb: f.thumbnail || v.videos?.medium?.thumbnail || null,
      title: v.tags ? v.tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(', ') : null,
    };
  }).filter(Boolean);
}

export async function searchVideos(query, { orientation = null } = {}) {
  const q = String(query).trim().slice(0, 100);
  const key = keyOf('video', q, orientation || '');
  const hit = cached(key);
  if (hit) return hit;
  let items;
  if (config.pexelsKey) {
    const url = new URL('https://api.pexels.com/v1/videos/search');
    url.search = new URLSearchParams({ query: q, per_page: '15', ...(orientation ? { orientation } : {}) }).toString();
    items = mapPexels(await getJson(url, { Authorization: config.pexelsKey }));
  } else if (config.pixabayKey) {
    const url = new URL('https://pixabay.com/api/videos/');
    url.search = new URLSearchParams({ key: config.pixabayKey, q, per_page: '15', safesearch: 'true' }).toString();
    items = mapPixabay(await getJson(url));
    if (orientation === 'portrait') items = items.filter((v) => v.height > v.width);
    if (orientation === 'landscape') items = items.filter((v) => v.width >= v.height);
  } else {
    throw new Error('Busca de vídeos não configurada.');
  }
  store(key, 'video', q, items);
  return { key, query: q, kind: 'video', items };
}

/* --------------------------------- Músicas --------------------------------- */

/** "https://creativecommons.org/licenses/by-nc-sa/3.0/" → "CC BY-NC-SA 3.0" */
export function licenseLabel(url) {
  const m = /licenses\/([a-z-]+)\/(\d\.\d)/i.exec(url || '');
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : 'Creative Commons';
}
export const isNonCommercial = (url) => /-nc/i.test(url || '');

export function mapJamendo(data) {
  return (data.results || []).map((t) => ({
    id: `jm${t.id}`, source: 'Jamendo', title: t.name, author: t.artist_name, duration: Number(t.duration) || null,
    page: t.shareurl, stream: t.audio, download: t.audiodownload_allowed && t.audiodownload ? t.audiodownload : null,
    thumb: t.image || t.album_image || null, license: licenseLabel(t.license_ccurl), licenseUrl: t.license_ccurl || null,
    nonCommercial: isNonCommercial(t.license_ccurl),
  }));
}

export async function searchMusic(query) {
  const q = String(query).trim().slice(0, 100);
  const key = keyOf('music', q);
  const hit = cached(key);
  if (hit) return hit;
  if (!config.jamendoClientId) throw new Error('Busca de músicas não configurada.');
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.search = new URLSearchParams({
    client_id: config.jamendoClientId, format: 'json', limit: '15', search: q, audioformat: 'mp32', include: 'licenses', order: 'popularity_total',
  }).toString();
  const data = await getJson(url);
  if (data.headers?.status === 'failed') throw new Error(data.headers.error_message || 'A API do Jamendo recusou a busca.');
  const items = mapJamendo(data);
  store(key, 'music', q, items);
  return { key, query: q, kind: 'music', items };
}

export const fmtDuration = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—');
