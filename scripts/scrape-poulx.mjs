#!/usr/bin/env node
// Récupère les randos du blog « Poulx Rando Pédestre » (club voisin) pour la recherche
// « Chercher aussi sur » et leur fiche dans la randothèque (carte, profil, survol 3D).
//
//   node scripts/scrape-poulx.mjs            (au plus 60 nouveaux GPX par passage)
//   node scripts/scrape-poulx.mjs --max=300
//
// Ces randos ne sont PAS les nôtres : tout est rangé dans externes/poulx/, jamais
// dans gpx/, data/randos.* ou le compteur. On ne garde pas les GPX eux-mêmes (ils restent
// sur le Google Drive du blog) mais seulement une trace simplifiée pour la carte et le profil.
// Le blog a plus de 1 200 articles : les GPX sont récupérés petit à petit, à chaque mise à jour.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, decodeEntities, fetchWithRetry, readJSON, writeJSON, sleep, pool } from './lib/util.mjs';
import { parseGpx, flatten, elevationStats, estimateDurationMin, simplifyTo, bbox, haversine } from './lib/gpx.mjs';

const BLOG = 'https://poulxrandopedestre.blogspot.com';
const DIR = path.join(ROOT, 'externes', 'poulx');
const TRACKS = path.join(DIR, 'tracks');
const STATE_FILE = path.join(DIR, 'etat.json');     // suivi interne (articles vus, essais de téléchargement)
const PUBLIC_FILE = path.join(DIR, 'poulx.json');   // lu par la page (assets/ailleurs.js)
const GEO_FILE = path.join(DIR, 'communes.json');
const MAX_NEW = Number((process.argv.find((a) => a.startsWith('--max=')) || '').slice(6)) || 60;
const FULL_SCAN_EVERY_H = 24;   // relecture complète du blog (articles modifiés, anciens articles)
const RETRY_FAILED_DAYS = 7;    // un GPX introuvable est retenté une semaine plus tard

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const htmlText = (h) => decodeEntities(String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const idOf = (s) => `px${crypto.createHash('sha1').update(s).digest('hex').slice(0, 10)}`;

function frenchDate(s) {
  const m = norm(s).match(/(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})/);
  return m ? `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// ---------------------------------------------------------------- Lecture du blog
async function feedPage(start, max) {
  const url = `${BLOG}/feeds/posts/default?alt=json&start-index=${start}&max-results=${max}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`flux du blog : HTTP ${res.status}`);
  return (await res.json()).feed;
}

function parsePost(e) {
  const url = (e.link || []).find((l) => l.rel === 'alternate')?.href;
  const html = e.content?.$t || e.summary?.$t || '';
  const text = htmlText(html);
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: decodeEntities(m[1]), text: htmlText(m[2]) }));
  const gpx = links.filter((l) => /\bgpx\b/i.test(l.text) && /drive\.google\.com/.test(l.href))
    .map((l) => (l.href.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{20,})/) || [])[1])
    .filter(Boolean);
  // Première ligne du type « UZES 8km +190m Animateur : Sergio »
  const flat = text.replace(/\n/g, ' ');
  const m = flat.match(/^(.*?)(\d+(?:[.,]\d+)?)\s*km/i);
  const place = m ? m[1].replace(/[\s\-–:]+$/, '').trim() : '';
  const anim = flat.match(/Animat(?:eur|rice)s?\s*:?\s*(.+?)(?=\s*(?:Nous sommes|Indice|Format|Toutes les|Relive|$))/i)?.[1];
  const ffr = flat.match(/Indice\s+FFR\s*:?\s*(VERT|BLEU|JAUNE|ORANGE|ROUGE|NOIR)/i)?.[1];
  const img = html.match(/<img\b[^>]*src="([^"]+)"/i)?.[1] || null;
  return {
    url,
    title: e.title?.$t || '',
    // Date du titre (« Vendredi 17 octobre 2025 »), sauf faute de frappe (« 5015 ») : date de publication
    date: (() => {
      const d = frenchDate(e.title?.$t), pub = (e.published?.$t || '').slice(0, 10);
      return d && Math.abs(+d.slice(0, 4) - +pub.slice(0, 4)) <= 1 ? d : pub;
    })(),
    place: place.length > 1 && place.length < 90 ? place : '',
    km: m ? parseFloat(m[2].replace(',', '.')) : null,
    dplus: Number(flat.match(/\+\s*(\d+)\s*m\b/i)?.[1]) || null,
    animateurs: anim ? anim.replace(/\s+/g, ' ').trim().slice(0, 80) : null,
    ffr: ffr ? ffr.toLowerCase() : null,
    image: img ? img.replace(/\/s\d+(-[a-z0-9-]+)?\//, '/s640/').replace(/=s\d+(-[a-z0-9-]+)?$/, '=s640') : null,
    relive: links.find((l) => /relive\.c(om|c)/.test(l.href))?.href || null,
    photos: links.find((l) => /photos\.(app\.goo\.gl|google\.com)/.test(l.href))?.href || null,
    gpx,
  };
}

// ---------------------------------------------------------------- Traces
const geo = readJSON(GEO_FILE, {});
async function commune(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (key in geo) return geo[key];
  try {
    const res = await fetchWithRetry(`https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,codeDepartement,departement&format=json`);
    const c = res.ok ? (await res.json())[0] : null;
    geo[key] = c ? { commune: c.nom, deptCode: c.codeDepartement, deptName: c.departement?.nom || null } : null;
  } catch { return null; }
  return geo[key];
}

async function fetchTrack(driveId) {
  const res = await fetchWithRetry(`https://drive.google.com/uc?export=download&id=${driveId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer()).toString('utf8');
  if (!/<gpx[\s>]/i.test(raw.slice(0, 4000))) throw new Error('pas un GPX (lien privé ou supprimé ?)');
  const gpx = parseGpx(raw);
  const pts = flatten(gpx.segments);
  if (pts.length < 2) throw new Error('trace trop courte');
  const ele = elevationStats(pts);
  const distanceKm = +(pts[pts.length - 1].d / 1000).toFixed(2);
  const start = pts[0], end = pts[pts.length - 1];
  const where = await commune(start.lat, start.lon);
  const track = simplifyTo(pts, 800, 4).map((p) => [
    +p.lat.toFixed(5), +p.lon.toFixed(5), p.ele == null ? null : Math.round(p.ele), +(p.d / 1000).toFixed(3),
  ]);
  return {
    track,
    stats: {
      distanceKm,
      dplus: ele ? ele.dplus : null, dminus: ele ? ele.dminus : null,
      altMin: ele ? ele.altMin : null, altMax: ele ? ele.altMax : null,
      durationMin: estimateDurationMin(distanceKm, ele ? ele.dplus : 0, ele ? ele.dminus : 0),
      loop: haversine(start, end) < Math.max(250, distanceKm * 30),
      start: [+start.lat.toFixed(5), +start.lon.toFixed(5)],
      bbox: bbox(pts),
      commune: where?.commune || null, deptCode: where?.deptCode || null, deptName: where?.deptName || null,
    },
  };
}

// ---------------------------------------------------------------- Programme principal
const state = readJSON(STATE_FILE, { fullScanAt: null, posts: {} });
const now = new Date();
const fullScan = !state.fullScanAt || (now - new Date(state.fullScanAt)) / 36e5 >= FULL_SCAN_EVERY_H;

let entries = [];
try {
  const first = await feedPage(1, 150);
  entries = first.entry || [];
  const total = Number(first.openSearch$totalResults?.$t) || entries.length;
  if (fullScan) {
    for (let start = 151; start <= total; start += 150) {
      await sleep(400);
      entries.push(...((await feedPage(start, 150)).entry || []));
    }
    state.fullScanAt = now.toISOString();
  }
  console.log(`Poulx : ${entries.length} article(s) lus${fullScan ? ' (relecture complète)' : ''} sur ${total}`);
} catch (e) {
  console.warn(`Poulx : blog injoignable (${e.message}), données inchangées.`);
  process.exit(0);
}

for (const e of entries) {
  const p = parsePost(e);
  if (!p.url) continue;
  const old = state.posts[p.url] || {};
  state.posts[p.url] = { ...p, tracks: old.tracks || {} };
}

// GPX à récupérer : les plus récents d'abord, sans retenter trop tôt ceux en échec
const todo = [];
for (const post of Object.values(state.posts).sort((a, b) => b.date.localeCompare(a.date))) {
  for (const driveId of post.gpx) {
    const t = post.tracks[driveId];
    const id = idOf(driveId);
    if (t?.ok && fs.existsSync(path.join(TRACKS, `${id}.js`))) continue;
    if (t && !t.ok && (now - new Date(t.at)) / 864e5 < RETRY_FAILED_DAYS) continue;
    todo.push({ post, driveId, id });
  }
}
const batch = todo.slice(0, MAX_NEW);
fs.mkdirSync(TRACKS, { recursive: true });
let done = 0, failed = 0;
await pool(batch, 2, async ({ post, driveId, id }) => {
  try {
    const { track, stats } = await fetchTrack(driveId);
    fs.writeFileSync(path.join(TRACKS, `${id}.js`), `window.__rtTrack&&__rtTrack(${JSON.stringify(id)},${JSON.stringify(track)});`);
    post.tracks[driveId] = { ok: true, at: now.toISOString(), id, ...stats };
    done++;
  } catch (err) {
    post.tracks[driveId] = { ok: false, at: now.toISOString(), error: err.message };
    failed++;
  }
  await sleep(300);
});
console.log(`Poulx : ${done} trace(s) ajoutée(s), ${failed} en échec, ${Math.max(0, todo.length - batch.length)} encore à récupérer.`);

// Fichier public : un élément par trace (ou par article sans trace)
const items = [];
for (const post of Object.values(state.posts).sort((a, b) => b.date.localeCompare(a.date))) {
  const base = {
    url: post.url, date: post.date, place: post.place, animateurs: post.animateurs, ffr: post.ffr,
    image: post.image, relive: post.relive, photos: post.photos,
  };
  const ok = post.gpx.map((d) => ({ driveId: d, t: post.tracks[d] })).filter((x) => x.t?.ok);
  if (!ok.length) {
    items.push({ ...base, km: post.km, dplus: post.dplus, gpx: post.gpx[0] ? `https://drive.google.com/file/d/${post.gpx[0]}/view` : null });
    continue;
  }
  ok.forEach(({ driveId, t }, i) => {
    const { at, ok: _ok, ...stats } = t;
    items.push({ ...base, ...stats, part: ok.length > 1 ? i + 1 : undefined, km: stats.distanceKm, gpx: `https://drive.google.com/file/d/${driveId}/view` });
  });
}
writeJSON(PUBLIC_FILE, { source: BLOG, updated: now.toISOString(), items }, false);
writeJSON(STATE_FILE, state, false);
writeJSON(GEO_FILE, geo, false);
console.log(`Poulx : ${items.length} rando(s) dans externes/poulx/poulx.json (${items.filter((i) => i.id).length} avec trace)`);
