// Petites fonctions partagées par les scripts (aucune dépendance externe).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GPX_DIR = path.join(ROOT, 'gpx');
export const BLOG_GPX_DIR = path.join(GPX_DIR, 'blog');
// Résumés audio publiés sur le blog (lus par le lecteur de la fiche rando)
export const BLOG_AUDIO_DIR = path.join(ROOT, 'audio', 'blog');
export const DATA_DIR = path.join(ROOT, 'data');
export const CACHE_DIR = path.join(ROOT, '.cache');

export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJSON(file, data, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 2 : 0));
}

export function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function slugify(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        ...opts,
        headers: { 'User-Agent': 'RandoTheque-GerardMartine/1.0', ...(opts.headers || {}) },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

// Exécute fn sur chaque élément avec une concurrence limitée.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export function listGpxFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // ex. gpx/.corbeille
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listGpxFiles(p));
    else if (/\.gpx$/i.test(entry.name)) out.push(p);
  }
  return out.sort();
}
