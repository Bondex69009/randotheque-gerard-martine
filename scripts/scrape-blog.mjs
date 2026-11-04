#!/usr/bin/env node
// Récupère automatiquement les fichiers GPX publiés sur les deux blogs de Gérard & Martine,
// avec les infos de chaque sortie (nom, date, IBP, département, itinéraire GR, photos, parking...).
//   - https://photosge30132.blogspot.com : Randonnées & Photos de Gé (plusieurs randos par article)
//   - https://gr-ge-30132.blogspot.com   : Nos chemins en itinérance (étapes des GR)
//
//   node scripts/scrape-blog.mjs            → met à jour (ne retélécharge que le nouveau)
//   node scripts/scrape-blog.mjs --refresh  → relit tous les articles
//
// Les articles modifiés sont relus (date de modification du flux). Pour les articles de la
// première page du blog, les GPX et audios sont en plus retéléchargés à chaque passage :
// un fichier remplacé sur Google Drive, ou un lien changé dans l'article, est donc repris.
//
// Résultat : fichiers dans gpx/blog/ et audio/blog/ + catalogue data/blog-catalog.json
import fs from 'node:fs';
import path from 'node:path';
import {
  BLOG_GPX_DIR, BLOG_AUDIO_DIR, CACHE_DIR, DATA_DIR, decodeEntities, fetchWithRetry, pool,
  readJSON, slugify, writeJSON, sleep,
} from './lib/util.mjs';

export const BLOGS = [
  { id: 'photos', url: 'https://photosge30132.blogspot.com', name: 'Randonnées & Photos de Gé' },
  { id: 'gr', url: 'https://gr-ge-30132.blogspot.com', name: 'Nos chemins en itinérance' },
];
const REFRESH = process.argv.includes('--refresh');
// --recent=10 : relit de force les articles des 10 dernières randos et retélécharge leurs GPX / audios
const RECENT = Number((process.argv.find((a) => a.startsWith('--recent=')) || '').split('=')[1]) || 0;
const POST_CACHE = path.join(CACHE_DIR, 'blog', 'posts');
const CATALOG_FILE = path.join(DATA_DIR, 'blog-catalog.json');
const FAILED_FILE = path.join(CACHE_DIR, 'blog', 'failed-downloads.json');
// Heure de la dernière vérification (non versionnée : elle change à chaque passage)
const LAST_CHECK_FILE = path.join(CACHE_DIR, 'blog', 'last-check.json');
const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
// Liens Google Maps courts déjà résolus (goo.gl/maps, maps.app.goo.gl → lien complet), pour ne pas les redemander
const MAPS_CACHE_FILE = path.join(CACHE_DIR, 'blog', 'maps-resolved.json');

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

// ---------------------------------------------------------------- Flux des articles
async function listPosts(blog) {
  const posts = [];
  for (let start = 1; ; start += 150) {
    const url = `${blog.url}/feeds/posts/default?alt=json&max-results=150&start-index=${start}`;
    const res = await fetchWithRetry(url);
    const json = await res.json();
    const entries = json.feed.entry || [];
    for (const e of entries) {
      posts.push({
        id: e.id.$t.split('post-').pop(),
        title: decodeEntities(e.title.$t || '').trim(),
        published: e.published.$t,
        updated: e.updated.$t,
        url: (e.link.find((l) => l.rel === 'alternate') || {}).href,
        labels: (e.category || []).map((c) => c.term),
        thumb: e.media$thumbnail ? e.media$thumbnail.url : null,
        site: blog.id,
      });
    }
    if (entries.length < 150) break;
  }
  return posts;
}

// Identifiants des articles affichés sur la première page du blog.
async function listFrontPage(blog) {
  try {
    const res = await fetchWithRetry(`${blog.url}/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return new Set([...html.matchAll(/id=['"]post-body-(\d+)['"]/g)].map((m) => m[1]));
  } catch (e) {
    console.warn(`   ⚠️  Première page de ${blog.url} illisible (${e.message}) : pas de revérification des fichiers`);
    return new Set();
  }
}

// On ne garde en cache que le corps de l'article (quelques Ko au lieu de ~150 Ko).
function slimPost(html) {
  const i = html.indexOf("class='post-body");
  if (i < 0) return html;
  const j = html.indexOf("class='post-footer", i);
  return html.slice(Math.max(0, i - 200), j > 0 ? j + 40 : undefined);
}

async function getPostHtml(post, force = false) {
  const file = path.join(POST_CACHE, `${post.id}.html`);
  const metaFile = file + '.updated';
  if (!REFRESH && !force && fs.existsSync(file) && fs.existsSync(metaFile)
      && fs.readFileSync(metaFile, 'utf8') === post.updated) {
    return fs.readFileSync(file, 'utf8');
  }
  const res = await fetchWithRetry(post.url);
  const html = await res.text();
  fs.mkdirSync(POST_CACHE, { recursive: true });
  fs.writeFileSync(file, slimPost(html));
  fs.writeFileSync(metaFile, post.updated);
  return html;
}

// ---------------------------------------------------------------- Analyse d'un article
function extractBody(html) {
  const i = html.indexOf("class='post-body");
  if (i < 0) return '';
  const start = html.indexOf('>', i) + 1;
  let end = html.indexOf("class='post-footer", start);
  if (end < 0) end = html.length;
  return html.slice(start, end);
}

// Transforme le HTML en texte linéaire, en mémorisant la position de chaque lien.
function linearize(bodyHtml) {
  let text = '';
  const links = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>|<br\s*\/?>|<\/(?:div|p|li|h\d)>|<[^>]+>|([^<]+)/gi;
  let m;
  while ((m = re.exec(bodyHtml))) {
    if (m[1] !== undefined) {
      const inner = decodeEntities(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      links.push({ href: decodeEntities(m[1]), text: inner, pos: text.length });
      text += ` ${inner} `;
    } else if (m[3] !== undefined) {
      text += decodeEntities(m[3]).replace(/[ \t\r\n]+/g, ' ');
    } else if (/^<br|^<\/(div|p|li|h\d)/i.test(m[0])) {
      text += '\n';
    }
  }
  return { text, links };
}

const IBP_COLORS = { VERT: 'vert', BLEU: 'bleu', JAUNE: 'jaune', ROUGE: 'rouge', NOIR: 'noir' };

function findIbpMarks(text, links) {
  const marks = [];
  const add = (pos, value) => {
    const v = parseInt(value, 10);
    if (v > 0 && v < 300) marks.push({ pos, value: v });
  };
  for (const l of links) {
    if (/ibpindex\.com/i.test(l.href)) {
      const n = l.text.match(/(\d{1,3})/);
      if (n) add(l.pos, n[1]);
    }
  }
  const patterns = [
    /EFFORT\s*:?\s*(\d{1,3})\b/gi,
    /\b(\d{1,3})\s*HKG\b/gi,
    /\b(\d{1,3})\s*-\s*(?:VERT|BLEU|JAUNE|ROUGE|NOIR)\b/gi,
    /IBP(?:[\s-]*index)?\s*:?\s*(\d{1,3})\b/gi,
    /(?:^|\s)_\s*(\d{2,3})\s*_(?=\s|$)/gm, // « _84_ » (blog des GR)
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) add(m.index, m[1]);
  }
  // un même chiffre détecté deux fois au même endroit → on dédoublonne
  marks.sort((a, b) => a.pos - b.pos);
  return marks.filter((m, i) => i === 0 || Math.abs(m.pos - marks[i - 1].pos) > 3 || m.value !== marks[i - 1].value);
}

function gpxDownloadUrl(href) {
  const drive = href.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{20,})/);
  if (drive) return { url: `https://drive.google.com/uc?export=download&id=${drive[1]}`, key: `drive:${drive[1]}` };
  if (/dropbox\.com/.test(href)) {
    const u = href.replace(/([?&])dl=0/, '$1dl=1');
    return { url: /dl=1/.test(u) ? u : u + (u.includes('?') ? '&' : '?') + 'dl=1', key: `url:${href}` };
  }
  return { url: href, key: `url:${href}` };
}

function parseFrenchDate(s) {
  const n = (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = n.match(/(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function cleanName(line) {
  let s = line.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+-\s*\d{1,3}\s*-?\s*(?:VERT|BLEU|JAUNE|ORANGE|ROUGE|NOIR)\b.*$/i, '').replace(/\s*>{2,}.*$/, '').replace(/\s+-\s+Parking\b.*$/i, '');
  const cut = s.search(/\s(?:EFFORT\b|\d{1,3}\s*HKG\b|_\s*\d|Route\b|Trace\b|GPX\b|Reco\b|Carte\b|M[ée]t[ée]o|Animateurs?\b|Accompagnateurs?\b|\*{2,}|-\s*\d+(?:[.,]\d+)?\s*km|Participation\b)/i);
  if (cut > 0) s = s.slice(0, cut);
  s = s.replace(/\s*\(\s*[\d.,]+\s*km\s*\)/gi, '').replace(/\s+km\s*\d+(?:[.,]\d+)?\b/gi, '');
  s = s.replace(/[\s\-–:>_*.…]+$/, '').replace(/^[\s\-–:"«*•]+/, '').replace(/["»]+$/, '').trim();
  // "GALICIAN 25" → "GALICIAN"
  s = s.replace(/(?<!\bGR)\s+\d{1,3}$/i, '').trim(); // « … - GR 34 » garde son numéro
  return s;
}

function parseDeclared(segment) {
  const out = {};
  const km = segment.match(/(\d{1,2}(?:[.,]\d)?)\s*km/i);
  if (km) out.km = parseFloat(km[1].replace(',', '.'));
  const dplus = segment.match(/(\d{2,4})\s*m(?:\s*D\+|\b)/i);
  if (dplus) out.dplus = parseInt(dplus[1], 10);
  // durée annoncée du type "15 Km - 5h - 400 m" (on ignore "Rassemblement 13h00")
  const h = segment.match(/km\s*-\s*(\d{1,2})\s*h\s*(\d{2})?\b/i);
  if (h && +h[1] <= 12) out.hours = +h[1] + (h[2] ? +h[2] / 60 : 0);
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------- Accès : parking / itinéraire Google Maps
const MAPS_RE = /google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl/i;
// parking : « Vue Parking départ de la Rando » ; route : « Route Google Maps » (arrive en général au parking)
function mapsKind(text) {
  if (/caissargues|complexe|omnisport/i.test(text)) return null; // lieu de rassemblement du club
  if (/parking|stationnement|d[ée]part/i.test(text)) return 'parking';
  if (/route|itin[ée]raire|\bgm\b|g\.?\s?maps|google\s?maps|suivre/i.test(text)) return 'route';
  return 'autre';
}
const dms = (d, m, s, h) => (+d + (+m || 0) / 60 + (+(s || '0').replace(',', '.') || 0) / 3600) * (/[SW]/i.test(h) ? -1 : 1);
// Coordonnées « 44° 8'28.71"N 4°32'37.23"E »
function parseDms(text) {
  const m = (text || '').replace(/&#176;|%C2%B0/g, '°').replace(/%22/g, '"').replace(/%27|’/g, "'").replace(/\+/g, ' ')
    .match(/(\d{1,2})°\s*(\d{1,2})['′]\s*([\d.,]+)?["″]?\s*([NS])[\s,]*(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.,]+)?["″]?\s*([EOW])/i);
  return m ? { lat: dms(m[1], m[2], m[3], m[4]), lon: dms(m[5], m[6], m[7], m[8].replace(/O/i, 'W')) } : null;
}
// Point visé par un lien Google Maps : repère d'un lieu, arrivée d'un itinéraire, position Street View…
export function mapsPoint(url, text = '') {
  let u = url;
  try { u = decodeURIComponent(url); } catch { /* tel quel */ }
  const ok = (lat, lon) => (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon) ? { lat: +(+lat).toFixed(6), lon: +(+lon).toFixed(6) } : null);
  if (/\/maps\/dir\//.test(u) || /[?&](daddr|destination)=/.test(u)) {
    const pairs = [...u.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)];
    if (pairs.length) { const p = pairs[pairs.length - 1]; return ok(p[2], p[1]); } // !1d = longitude, !2d = latitude
    const d = u.match(/[?&](?:daddr|destination)=([^&]+)/);
    if (d) {
      const c = d[1].match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
      if (c) return ok(c[1], c[2]);
      return parseDms(d[1]);
    }
    const parts = u.split('/maps/dir/')[1];
    if (parts) { const last = parts.split('/@')[0].split('/').filter(Boolean).pop(); if (last) return parseDms(last); }
    return null;
  }
  const pins = [...u.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)];
  if (pins.length) { const p = pins[pins.length - 1]; return ok(p[1], p[2]); }
  const place = u.match(/\/place\/([^/]+)/);
  if (place) { const p = parseDms(place[1]); if (p) return p; const c = place[1].match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)/); if (c) return ok(c[1], c[2]); }
  const q = u.match(/[?&](?:q|ll|query)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (q) return ok(q[1], q[2]);
  // @lat,lon : position Street View (« ,3a, ») ou vue zoomée (≤ 2 km, ou ≥ 15z)
  const at = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(?:(3a)|(\d+(?:\.\d+)?)m|(\d+(?:\.\d+)?)z)/);
  if (at && (at[3] || (at[4] && +at[4] <= 2000) || (at[5] && +at[5] >= 15))) return ok(at[1], at[2]);
  return parseDms(text);
}

// Albums Google Photos de l'article (les anciens liens Picasa / Google+ ne fonctionnent plus : ignorés)
const ALBUM_RE = /^https?:\/\/(?:photos\.google\.com\/(?:u\/\d+\/)?share\/|photos\.app\.goo\.gl\/|goo\.gl\/photos\/)/i;
// Intitulé du bouton à partir du texte du lien : « PHOTOS de Bruno. » → « Photos de Bruno », « René » → « Photos de René »
function albumLabel(text) {
  let t = (text || '').replace(/\s+/g, ' ').replace(/[\s.…:]+$/, '').replace(/^[\s\-–:*]+/, '').trim();
  if (!t || t.length < 3 || /\d{2}/.test(t) || /^(les |toutes les )?photos( ici)?$/i.test(t) || /^album/i.test(t)) return 'Album photos';
  const STOP = new Set(['la', 'le', 'les', 'l', 'rando', 'reco', 'nos', 'et', 'du', 'des']);
  // « BRUNO » → « Bruno », « gé » → « Gé » ; les initiales (« D », « Gr2 ») et les petits mots restent tels quels
  const cap = (w) => (STOP.has(w.toLowerCase()) || /^[A-Z]\d?$|^GR?\d+$/i.test(w) ? (w.length > 2 ? w.toLowerCase() : w)
    : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  t = t.replace(/\b[\p{Lu}]{2,}\b/gu, (w) => (/^GR?\d*$/.test(w) ? w : w.toLowerCase()));
  if (/^(le |la )?(film|diaporama|animation|vid[ée]o)/i.test(t)) return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  if (/photo/i.test(t)) {
    t = t.replace(/^(?:toutes\s+)?(?:les\s+)?photos\b/i, 'Photos')
      .replace(/^Photos\s*-\s*(?=\d)/, 'Photos ')
      .replace(/^Photos\s*[-:]?\s+(?!de\b|d['’]|du\b|des\b|gr?\d|\d)/i, 'Photos de ');
  } else if (/^(?:d['’]\s*)?[\p{L}'’-]+(?: [\p{L}.'’-]+)?$/u.test(t) && t.length <= 20) {
    t = `Photos de ${t.replace(/^d['’]\s*/i, '')}`; // juste un prénom (« Bruno D », « SYLVIE », « d'Alain »)
  } else if (t.length > 40) {
    return 'Album photos';
  }
  // Prénoms après « de » avec une majuscule ; « de Alain » → « d'Alain »
  t = t.replace(/\b(de|et|&) ([\p{L}'’-]+)/gu, (m, de, w) => `${de} ${/^l['’]/i.test(w) ? w.toLowerCase() : cap(w)}`)
    .replace(/\bde ([AEIOUYÉÈÊ])/g, "d'$1");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Lignes qui ne sont pas un nom de rando (liens de fichiers, parking, coordonnées, indice seul…)
const LABEL_LINE = /^(?:(?:la|le|les)\s+)?(?:photos?|gps|cotation|format|parking|vue\s+parking|g\s*-?\s*maps|google\s*maps|route|trace|carte|m[ée]t[ée]o|progression|cliquez|relive|le\s+film|vid[ée]o|diaporama)\b/i;
const DAY_LINE = /^(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d/i;
function isNameLine(line) {
  if (!line || LABEL_LINE.test(line) || DAY_LINE.test(line) || /\bGPX\b/i.test(line)) return false;
  if (/^[\d°'"′″.,\s NSEOW-]+$/.test(line)) return false; // coordonnées
  // indice seul : « 50 HKG », « EFFORT 68 », « _84_ »
  const rest = line.replace(/>{2,}.*$/, '').replace(/_/g, ' ')
    .replace(/\b(?:HKG|EFFORT|IBP|index|VERT|BLEU|JAUNE|ORANGE|ROUGE|NOIR|Traces?|Route|GE|KML|KMZ|3D|Carte|Profil|Pr[ée]vu|Rando|Reco|Matin|Apr[èe]s[- ]midi|Variante|M[ée]t[ée]o(?:Ciel)?|fr)\b|[\d_\s:.\-<>?]+/gi, ' ');
  return /\p{L}{3}/u.test(rest);
}

// Étiquettes du blog : « GR65 » → itinéraire ; « 73-SAVOIE », « ESPAGNE »… → lieu
const GR_LABEL = /^GR\s*(\d+)$/i;
const IMG_RE = /blogger\.googleusercontent\.com\/img|\.bp\.blogspot\.com\//i;
const sizedImage = (url) => (url ? url.replace(/\/(?:s\d+(?:-[^/]*)?|w\d+-h\d+[^/]*)\/([^/]+)$/, '/w640-h360-c/$1') : null);

function parsePost(post, html) {
  const body = extractBody(html);
  if (!body) return [];
  const { text, links } = linearize(body);

  const gpxLinks = links.filter((l) =>
    /^gpx$/i.test(l.text.replace(/[^\w]/g, ''))
    || /\.gpx(?:$|[?#])/i.test(l.href)
    || (/\bgpx\b/i.test(l.text) && /drive\.google|dropbox/.test(l.href) && l.text.length < 25));
  if (!gpxLinks.length) return [];

  // Découpage en lignes (avec leur position dans le texte) pour retrouver le nom de chaque rando
  const lines = [];
  let off = 0;
  for (const l of text.split('\n')) { lines.push({ start: off, end: off + l.length, text: l.replace(/\s+/g, ' ').trim() }); off += l.length + 1; }
  const lineOf = (pos) => { let i = lines.findIndex((l) => pos >= l.start && pos <= l.end); return i < 0 ? lines.length - 1 : i; };

  const marks = findIbpMarks(text, links);
  const firstLine = lines.map((l) => l.text).find(isNameLine) || '';
  const date = parseFrenchDate(post.title) || parseFrenchDate(firstLine) || post.published.slice(0, 10);
  const cancelled = post.labels.some((l) => /^annul/i.test(l)) || /\bannul[ée]e?\b/i.test(post.title);
  const itineraires = post.labels.map((l) => l.trim().match(GR_LABEL)).filter(Boolean).map((m) => `GR ${m[1]}`);
  const departements = post.labels.filter((l) => !GR_LABEL.test(l.trim()) && !/^annul/i.test(l));
  const etape = (post.title.match(/[EÉ]tape\s*(\d+)/i) || [])[1];

  // Albums Google Photos, liens Google Maps et photos : on les rattache à la rando dont ils suivent le lien GPX
  const albumsIn = (from, to) => {
    const seen = new Set();
    const list = [];
    for (const l of links) {
      if (l.pos < from || l.pos >= to || !ALBUM_RE.test(l.href) || seen.has(l.href)) continue;
      seen.add(l.href);
      const a = { url: l.href, label: albumLabel(l.text) };
      const twin = list.find((b) => b.url.split('?')[0] === a.url.split('?')[0]);
      if (!twin) list.push(a);
      else if (twin.label === 'Album photos') twin.label = a.label;
    }
    return list;
  };
  const mapsIn = (from, to) => {
    const seen = new Set();
    return links
      .filter((l) => l.pos >= from && l.pos < to && MAPS_RE.test(l.href) && mapsKind(l.text) && !seen.has(l.href) && seen.add(l.href))
      .map((l) => ({ url: l.href.replace(/^\/\//, 'https://'), label: l.text.slice(0, 80), kind: mapsKind(l.text) }));
  };
  const imageIn = (from, to) => { const l = links.find((x) => x.pos >= from && x.pos < to && IMG_RE.test(x.href)); return l ? l.href : null; };
  const postImage = post.thumb ? post.thumb.replace(/\/s72-[^/]*\//, '/w640-h360-c/') : sizedImage(imageIn(0, Infinity));

  const audioSeen = new Set();
  const audio = links
    .filter((l) => /\baudio\b/i.test(l.text) && /drive\.google|dropbox/.test(l.href))
    .map((l) => {
      const dl = gpxDownloadUrl(l.href);
      const dur = l.text.match(/(\d{1,2})\s*['’]\s*(\d{2})/);
      return { key: dl.key, downloadUrl: dl.url, sourceUrl: l.href, label: l.text, seconds: dur ? +dur[1] * 60 + +dur[2] : null };
    })
    .filter((a) => !audioSeen.has(a.key) && audioSeen.add(a.key));

  const items = [];
  gpxLinks.forEach((link, k) => {
    const prevPos = k > 0 ? gpxLinks[k - 1].pos : -1;
    const nextPos = k < gpxLinks.length - 1 ? gpxLinks[k + 1].pos : Infinity;
    // Nom : la dernière ligne « parlante » avant le lien GPX (après celui de la rando précédente)
    const li = lineOf(link.pos);
    const minLine = prevPos < 0 ? 0 : lineOf(prevPos) + 1;
    let rawName = null;
    const sameLine = text.slice(lines[li].start, link.pos).replace(/\s+/g, ' ').trim();
    const variantM = sameLine.match(/^(Pr[ée]vu|Rando|Reco|Matin|Apr[èe]s[- ]midi|Variante|Court|Long)\b/i);
    if (isNameLine(sameLine)) rawName = sameLine;
    for (let i = li - 1; !rawName && i >= minLine; i--) if (isNameLine(lines[i].text)) rawName = lines[i].text;
    let name = cleanName(rawName || '') || cleanName(firstLine) || post.title;
    if ((post.site === 'gr' || itineraires.length) && /^\d{1,2}\s*-\s*\D/.test(name)) name = `Étape ${name.replace(/^0(\d)/, '$1')}`;
    else if (post.site === 'gr' && etape && !/[ée]tape/i.test(name) && gpxLinks.length === 1) name = `Étape ${etape} - ${name}`;
    if (variantM && gpxLinks.length > 1) name = `${name} (${variantM[1].charAt(0).toUpperCase()}${variantM[1].slice(1).toLowerCase()})`;

    // IBP : le dernier repère placé avant ce lien GPX (et après le lien précédent),
    // sinon le premier qui suit, sinon le dernier repère disponible avant.
    const mark = [...marks].reverse().find((m) => m.pos < link.pos && m.pos > prevPos)
      || marks.find((m) => m.pos > link.pos && m.pos < nextPos)
      || (gpxLinks.length === 1 ? marks[0] : null);
    const segStart = prevPos < 0 ? 0 : prevPos;
    const segment = text.slice(segStart, Math.min(text.length, (nextPos === Infinity ? link.pos + 300 : nextPos)));
    const colorMatch = segment.match(/\b(VERT|BLEU|JAUNE|ROUGE|NOIR)\b/);
    const sectionEnd = nextPos === Infinity ? Infinity : lines[Math.max(0, lineOf(nextPos) - 1)].start;
    const single = gpxLinks.length === 1;
    const albums = single ? albumsIn(0, Infinity) : albumsIn(link.pos, nextPos);
    const maps = single ? mapsIn(0, Infinity) : mapsIn(link.pos, nextPos);
    const image = sizedImage(imageIn(link.pos, sectionEnd)) || postImage;
    const dl = gpxDownloadUrl(link.href);
    items.push({
      key: dl.key,
      downloadUrl: dl.url,
      sourceUrl: link.href,
      name,
      date,
      ibp: mark ? mark.value : null,
      ibpColor: colorMatch ? IBP_COLORS[colorMatch[1]] : null,
      declared: parseDeclared(segment),
      animateurs: null,
      itineraires: itineraires.length ? itineraires : null,
      departements,
      site: post.site,
      cancelled,
      image,
      audio: audio.length ? audio : null,
      albums: albums.length ? albums.slice(0, 12) : null,
      maps: maps.length ? maps.slice(0, 8) : null,
      post: { id: post.id, title: post.title, url: post.url, published: post.published },
    });
  });
  // Deux randos du même article avec le même nom : on les distingue
  const seenNames = new Map();
  for (const it of items) seenNames.set(it.name, (seenNames.get(it.name) || 0) + 1);
  const idx = new Map();
  for (const it of items) {
    if (seenNames.get(it.name) < 2) continue;
    const n = (idx.get(it.name) || 0) + 1; idx.set(it.name, n);
    it.name = `${it.name} (parcours ${n})`;
  }
  return items;
}

// ---------------------------------------------------------------- Téléchargement
function looksLikeGpx(buf) {
  const head = buf.subarray(0, 4000).toString('utf8');
  return /<gpx[\s>]/i.test(head) || (/<\?xml/i.test(head) && buf.toString('utf8').includes('<gpx'));
}

// Google Drive envoie le nom en octets UTF-8 bruts, lus comme du Latin-1 (« CÃ¨ze ») : on les relit en UTF-8.
export function fixUtf8(s) {
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const out = Buffer.from(s, 'latin1').toString('utf8');
  return out.includes('�') ? s : out;
}

// Nom d'origine du fichier (Google Drive, Dropbox) d'après l'en-tête Content-Disposition
function originalFileName(res) {
  const cd = res.headers.get('content-disposition') || '';
  let name = (cd.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/) || [])[1];
  if (name) { try { name = decodeURIComponent(name); } catch { /* nom laissé tel quel */ } }
  else name = fixUtf8((cd.match(/filename="?([^";]+)"?/i) || [])[1] || '');
  name = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f"<>|:*?]/g, '').trim();
  return name || null;
}

async function fetchGpx(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!looksLikeGpx(buf)) throw new Error('le fichier reçu n\'est pas un GPX (lien privé ou supprimé ?)');
  let name = originalFileName(res);
  if (name && !/\.gpx$/i.test(name)) name += '.gpx';
  return { buf, name };
}

const AUDIO_TYPES = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm',
};
async function fetchAudio(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const fileName = originalFileName(res) || '';
  const nameExt = path.extname(fileName).slice(1).toLowerCase();
  const ext = AUDIO_TYPES[type] || (Object.values(AUDIO_TYPES).includes(nameExt) ? nameExt : null);
  if (!ext) throw new Error(`le fichier reçu n'est pas un audio (${type || 'type inconnu'})`);
  if (+res.headers.get('content-length') > MAX_AUDIO_BYTES) throw new Error('fichier audio trop lourd');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_AUDIO_BYTES) throw new Error('fichier audio trop lourd');
  return { buf, ext };
}

function uniqueName(base, ext, used) {
  let name = `${base}.${ext}`;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}.${ext}`;
  used.add(name.toLowerCase());
  return name;
}

// N'écrit le fichier que si son contenu a changé (évite des commits inutiles). Renvoie true si écrit.
function writeIfChanged(file, buf) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return true;
}

const listLower = (dir) => new Set(fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => f.toLowerCase()) : []);

// ---------------------------------------------------------------- Programme principal
async function main() {
  console.log('📡 Lecture des flux des blogs…');
  const posts = [];
  const frontPage = new Set();
  for (const blog of BLOGS) {
    const [p, f] = await Promise.all([listPosts(blog), listFrontPage(blog)]);
    posts.push(...p);
    for (const id of f) frontPage.add(id);
    console.log(`   ${blog.url} : ${p.length} articles, dont ${f.size} en première page (fichiers revérifiés)`);
  }

  const catalog = readJSON(CATALOG_FILE, { generatedAt: null, items: [] });
  // Articles des N dernières randos : relus de force et traités comme ceux de la première page
  const forced = new Set();
  if (RECENT) {
    for (const it of [...catalog.items].sort((a, b) => b.date.localeCompare(a.date))) {
      if (forced.size >= RECENT) break;
      if (it.post) forced.add(it.post.id);
    }
    for (const id of forced) frontPage.add(id);
    console.log(`   --recent=${RECENT} : ${forced.size} articles relus de force`);
  }
  const byKey = new Map(catalog.items.map((it) => [it.key, it]));
  const knownAudio = new Map(catalog.items.flatMap((it) => (it.audio || []).filter((a) => a.file).map((a) => [a.key, a.file])));
  const failed = readJSON(FAILED_FILE, {});

  console.log('📖 Analyse des articles…');
  let done = 0;
  const parsedOk = new Set(); // articles lus correctement (sert à repérer les liens retirés)
  const parsed = await pool(posts, 6, async (post) => {
    try {
      const html = await getPostHtml(post, forced.has(post.id));
      const items = parsePost(post, html);
      if (html.includes("class='post-body")) parsedOk.add(post.id);
      if (++done % 100 === 0) console.log(`   ${done}/${posts.length}`);
      return items;
    } catch (e) {
      console.warn(`   ⚠️  ${post.url} : ${e.message}`);
      return [];
    }
  });

  // Un même GPX peut être publié plusieurs fois (rando refaite) : on regroupe par lien.
  const found = new Map();
  for (const item of parsed.flat()) {
    const front = frontPage.has(item.post.id);
    const prev = found.get(item.key);
    if (!prev) { found.set(item.key, { ...item, sites: [item.site], outings: [item.date], front }); continue; }
    prev.outings.push(item.date);
    // On garde les infos de l'article le plus récent, en complétant ce qui manque.
    const [recent, old] = item.date > prev.date ? [item, prev] : [prev, item];
    const merged = { ...old, ...Object.fromEntries(Object.entries(recent).filter(([, v]) => v != null)) };
    merged.outings = prev.outings;
    merged.sites = [...new Set([...prev.sites, item.site])];
    merged.itineraires = [...new Set([...(prev.itineraires || []), ...(item.itineraires || [])])];
    if (!merged.itineraires.length) merged.itineraires = null;
    merged.front = prev.front || front;
    const allAlbums = [...(recent.albums || []), ...(old.albums || [])];
    merged.albums = allAlbums.length ? allAlbums.filter((a, i) => allAlbums.findIndex((b) => b.url === a.url) === i).slice(0, 12) : null;
    found.set(item.key, merged);
  }
  console.log(`   ${found.size} liens GPX distincts`);
  if (process.argv.includes('--dry')) {
    writeJSON(path.join(CACHE_DIR, 'blog', 'dry-run.json'), [...found.values()]);
    console.log('   (--dry : aperçu écrit dans .cache/blog/dry-run.json, rien téléchargé)');
    return;
  }

  // ---- Liens Google Maps : résolution des liens courts (une seule fois, mise en cache) et coordonnées
  const mapsCache = readJSON(MAPS_CACHE_FILE, {});
  const shortLinks = [...new Set([...found.values()].flatMap((it) => (it.maps || []).map((m) => m.url)))]
    .filter((u) => /goo\.gl\/maps|maps\.app\.goo\.gl/i.test(u) && !(u in mapsCache));
  if (shortLinks.length) {
    console.log(`🗺️  Résolution de ${shortLinks.length} liens Google Maps courts…`);
    await pool(shortLinks, 4, async (u) => {
      try {
        const res = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Randotheque)' }, signal: AbortSignal.timeout(15000) });
        mapsCache[u] = res.headers.get('location') || null;
      } catch { /* réessayé au prochain passage */ }
      await sleep(100);
    });
    writeJSON(MAPS_CACHE_FILE, mapsCache);
  }
  for (const it of found.values()) {
    if (!it.maps) continue;
    it.maps = it.maps.map((m) => {
      const p = mapsPoint(mapsCache[m.url] || m.url, m.label);
      return p ? { ...m, ...p } : m;
    });
  }

  // ---- GPX : nouveaux liens, puis revérification de ceux de la première page
  const gpxPath = (f) => path.join(BLOG_GPX_DIR, f);
  const knownFile = (it) => { const k = byKey.get(it.key); return k && k.file && fs.existsSync(gpxPath(k.file)) ? k.file : null; };

  // Liens retirés d'un article de la première page, ou article récent supprimé (ex. « prochaine sortie »
  // remplacé par l'article définitif) : les fichiers devenus orphelins sont supprimés (sinon ils
  // réapparaîtraient comme des randos « perso » en double). C'est fait avant les téléchargements pour
  // que le GPX qui remplace l'ancien garde exactement le même nom de fichier.
  const postIds = new Set(posts.map((p) => p.id));
  const frontSince = posts.filter((p) => frontPage.has(p.id)).map((p) => p.published).sort()[0];
  const inScope = (old) => old.post && (
    (frontPage.has(old.post.id) && parsedOk.has(old.post.id))
    || (frontSince && !postIds.has(old.post.id) && old.post.published >= frontSince));
  const stillUsed = new Set([...found.values()].map(knownFile).filter(Boolean).map((f) => f.toLowerCase()));
  let removed = 0;
  for (const old of catalog.items) {
    if (!inScope(old) || !old.file || found.has(old.key) || stillUsed.has(old.file.toLowerCase())) continue;
    if (!fs.existsSync(gpxPath(old.file))) continue;
    fs.rmSync(gpxPath(old.file)); removed++;
    console.log(`   🗑️  GPX retiré du blog : ${old.name} (${old.file})`);
  }
  const usedNames = listLower(BLOG_GPX_DIR);
  const todo = [...found.values()].filter((it) => !knownFile(it) && (REFRESH || it.front || !failed[it.key]));
  const recheck = [...found.values()].filter((it) => it.front && knownFile(it));
  // Nom d'origine des GPX déjà téléchargés avant qu'on le note (une seule fois par GPX ; le fichier n'est pas modifié)
  const needName = [...found.values()].filter((it) => !it.front && knownFile(it) && !('originalName' in byKey.get(it.key)));

  console.log(`⬇️  Téléchargement de ${todo.length} nouveaux GPX, revérification de ${recheck.length}…`);
  let ok = 0, ko = 0, updated = 0;
  await pool(todo, 4, async (it) => {
    try {
      const { buf, name } = await fetchGpx(it.downloadUrl);
      it.originalName = name;
      it.file = uniqueName(`${it.date}_${slugify(it.name) || 'rando'}`, 'gpx', usedNames);
      fs.mkdirSync(BLOG_GPX_DIR, { recursive: true });
      fs.writeFileSync(gpxPath(it.file), buf);
      ok++;
      delete failed[it.key];
    } catch (e) {
      ko++;
      failed[it.key] = { url: it.sourceUrl, post: it.post.url, error: e.message };
    }
    await sleep(150);
  });
  await pool(recheck, 4, async (it) => {
    try {
      const { buf, name } = await fetchGpx(it.downloadUrl);
      it.originalName = name;
      if (writeIfChanged(gpxPath(knownFile(it)), buf)) {
        updated++;
        console.log(`   🔄 GPX modifié sur le blog : ${it.name}`);
      }
    } catch (e) {
      console.warn(`   ⚠️  ${it.name} : ${e.message} (on garde la version déjà téléchargée)`);
    }
    await sleep(150);
  });
  console.log(`   ✅ ${ok} téléchargés, 🔄 ${updated} mis à jour, ❌ ${ko} indisponibles`);
  if (needName.length) {
    console.log(`🏷️  Récupération du nom d'origine de ${needName.length} GPX…`);
    await pool(needName, 4, async (it) => {
      try { it.originalName = (await fetchGpx(it.downloadUrl)).name; } catch { it.originalName = null; }
      await sleep(100);
    });
  }

  // ---- Résumés audio
  const audioPath = (f) => path.join(BLOG_AUDIO_DIR, f);
  const audioJobs = new Map();
  for (const it of found.values()) {
    if (!it.file && !knownFile(it)) continue; // rando sans GPX : absente du catalogue, audio inutile
    for (const a of it.audio || []) if (!audioJobs.has(a.key) || it.front) audioJobs.set(a.key, { a, it });
  }
  const audioStillUsed = new Set([...audioJobs.keys()].map((k) => knownAudio.get(k)).filter(Boolean).map((f) => f.toLowerCase()));
  for (const old of catalog.items) {
    if (!inScope(old)) continue;
    for (const a of old.audio || []) {
      if (!a.file || audioJobs.has(a.key) || audioStillUsed.has(a.file.toLowerCase()) || !fs.existsSync(audioPath(a.file))) continue;
      fs.rmSync(audioPath(a.file)); removed++;
    }
  }
  const usedAudio = listLower(BLOG_AUDIO_DIR);
  const audioFile = new Map();
  let aNew = 0, aUpd = 0, aKo = 0;
  await pool([...audioJobs.values()], 3, async ({ a, it }) => {
    const known = knownAudio.get(a.key);
    const exists = !!known && fs.existsSync(audioPath(known));
    if (exists && !it.front && !REFRESH) { audioFile.set(a.key, known); return; }
    if (!exists && failed[a.key] && !it.front && !REFRESH) return;
    try {
      const { buf, ext } = await fetchAudio(a.downloadUrl);
      const base = `${it.date}_${slugify(it.name.replace(/\s*\([^)]*\)$/, '')) || 'audio'}`;
      const name = exists && path.extname(known).slice(1) === ext ? known : uniqueName(base, ext, usedAudio);
      if (writeIfChanged(audioPath(name), buf)) { if (exists) aUpd++; else aNew++; }
      if (exists && name !== known) fs.rmSync(audioPath(known), { force: true });
      audioFile.set(a.key, name);
      delete failed[a.key];
    } catch (e) {
      if (exists) audioFile.set(a.key, known);
      else { aKo++; failed[a.key] = { url: a.sourceUrl, post: it.post.url, error: e.message }; }
    }
    await sleep(150);
  });
  if (audioJobs.size) console.log(`🎧 ${audioFile.size} résumés audio (${aNew} nouveaux, ${aUpd} mis à jour, ${aKo} indisponibles)`);

  // ---- Catalogue
  const items = [];
  for (const it of found.values()) {
    const file = it.file || knownFile(it);
    if (!file || !fs.existsSync(gpxPath(file))) continue;
    it.outings = [...new Set(it.outings)].sort().reverse();
    const audio = (it.audio || []).filter((a) => audioFile.has(a.key)).map((a) => ({ ...a, file: audioFile.get(a.key) }));
    const { front, ...rest } = it;
    const known = byKey.get(it.key);
    // Nom du fichier sur Google Drive / Dropbox : proposé au téléchargement sur le site
    const originalName = it.originalName !== undefined ? it.originalName
      : known && known.originalName !== undefined ? known.originalName : null;
    items.push({ ...rest, audio: audio.length ? audio : null, file, originalName });
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key)); // ordre stable : pas de commit inutile

  // La date du catalogue ne bouge que s'il y a du nouveau : pas de commit inutile toutes les heures.
  const changed = updated || aNew || aUpd || removed || JSON.stringify(items) !== JSON.stringify(catalog.items);
  const now = new Date().toISOString();
  writeJSON(CATALOG_FILE, { generatedAt: changed || !catalog.generatedAt ? now : catalog.generatedAt, source: BLOGS.map(({ id, url, name }) => ({ id, url, name })), items });
  writeJSON(FAILED_FILE, failed);
  writeJSON(LAST_CHECK_FILE, { checkedAt: now });
  console.log(`📚 Catalogue : ${items.length} randos du blog → ${path.relative(process.cwd(), CATALOG_FILE)}${changed ? '' : ' (aucun changement)'}`);
  const unavailable = Object.keys(failed).length;
  if (unavailable) console.log(`   (${unavailable} liens morts listés dans .cache/blog/failed-downloads.json)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
