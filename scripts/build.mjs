#!/usr/bin/env node
// Analyse tous les GPX du dossier gpx/ et génère les données de la Randothèque.
//
//   node scripts/build.mjs
//
// - gpx/blog/   : GPX récupérés automatiquement sur le blog (voir scrape-blog.mjs)
// - gpx/…       : vos propres GPX (n'importe quel sous-dossier)
//   Un fichier « ma-rando.json » placé à côté de « ma-rando.gpx » peut compléter
//   ou corriger les infos : { "name", "description", "ibp", "animateurs", "date" }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT, GPX_DIR, BLOG_GPX_DIR, DATA_DIR, CACHE_DIR, readJSON, writeJSON,
  listGpxFiles, fetchWithRetry, pool,
} from './lib/util.mjs';
import {
  parseGpx, flatten, elevationStats, estimateDurationMin, recordedDuration,
  simplifyTo, profile, bbox, haversine, slopeBreakdown,
} from './lib/gpx.mjs';

const TRACKS_DIR = path.join(DATA_DIR, 'tracks');
const GEO_CACHE_FILE = path.join(CACHE_DIR, 'geo.json');
const ELE_CACHE_FILE = path.join(CACHE_DIR, 'elevation.json');
const OFFLINE = process.argv.includes('--offline');
// Corrections saisies dans l'interface d'administration, par fichier : { "gpx/…/x.gpx": { name, hidden… } }
const OVERRIDES_FILE = path.join(DATA_DIR, 'overrides.json');
const EDITABLE = ['name', 'date', 'description', 'animateurs', 'ibp', 'commune'];
// Compteur total de Gérard & Martine : somme des randos déjà faites (date passée) et non annulées.
// Pour y ajouter des kilomètres d'avant les blogs, mettre par exemple { km: 1500, date: '2014-12-31' }.
const TOTAL_REF = { km: 0, date: '0000-00-00' };
// Blogs lus par scrape-blog.mjs (repris si le catalogue n'en donne pas la liste)
const DEFAULT_BLOGS = [
  { id: 'photos', url: 'https://photosge30132.blogspot.com', name: 'Randonnées & Photos de Gé' },
  { id: 'gr', url: 'https://gr-ge-30132.blogspot.com', name: 'Nos chemins en itinérance' },
];

// ---------------------------------------------------------------- Niveaux IBP (randonnée pédestre)
export const LEVELS = [
  { id: 'vert', max: 25, label: 'Très facile' },
  { id: 'bleu', max: 50, label: 'Facile' },
  { id: 'jaune', max: 75, label: 'Moyen' },
  { id: 'rouge', max: 100, label: 'Difficile' },
  { id: 'noir', max: Infinity, label: 'Très difficile' },
];
const levelOf = (ibp) => (ibp == null ? null : LEVELS.find((l) => ibp <= l.max).id);

// Point où se rendre pour la rando : parking indiqué sur le blog (lien « Vue Parking », sinon arrivée de
// l'itinéraire, sinon coordonnées données dans l'article), s'il est à moins de 10 km du départ de la trace ;
// sinon le point de départ du GPX.
const ACCESS_MAX_M = 10000;
function accessPoint(blog, start) {
  const links = (blog && blog.maps) || [];
  for (const kind of ['parking', 'route', 'autre']) {
    const m = links.find((l) => l.kind === kind && l.lat != null && haversine({ lat: l.lat, lon: l.lon }, start) <= ACCESS_MAX_M);
    if (m) return { lat: +m.lat.toFixed(5), lon: +m.lon.toFixed(5), source: kind === 'parking' || kind === 'route' ? 'parking' : 'blog' };
  }
  return { lat: +start.lat.toFixed(5), lon: +start.lon.toFixed(5), source: 'gpx' };
}

// ---------------------------------------------------------------- Services en ligne (avec cache)
const geoCache = readJSON(GEO_CACHE_FILE, {});
async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (key in geoCache) return geoCache[key];
  if (OFFLINE) return null;
  try {
    const url = `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,code,codeDepartement,departement,region&format=json`;
    const res = await fetchWithRetry(url);
    const arr = res.ok ? await res.json() : [];
    const c = arr[0];
    geoCache[key] = c ? {
      commune: c.nom,
      deptCode: c.codeDepartement,
      deptName: c.departement ? c.departement.nom : null,
      region: c.region ? c.region.nom : null,
    } : { commune: null };
  } catch {
    return null; // on réessaiera au prochain build
  }
  return geoCache[key];
}

// Altitudes manquantes : service altimétrique de l'IGN (France uniquement).
const eleCache = readJSON(ELE_CACHE_FILE, {});
// Le service IGN refuse les rafales de requêtes : on les envoie une par une.
let ignQueue = Promise.resolve();
function fillElevation(pts, cacheKey) {
  const run = ignQueue.then(() => fillElevationNow(pts, cacheKey));
  ignQueue = run.catch(() => {});
  return run;
}
async function fillElevationNow(pts, cacheKey) {
  const sample = simplifyTo(pts, 600, 3);
  if (eleCache[cacheKey]) {
    const z = eleCache[cacheKey];
    if (z.length === sample.length) return sample.map((p, i) => ({ ...p, ele: z[i] }));
  }
  if (OFFLINE) return null;
  const z = [];
  for (let i = 0; i < sample.length; i += 150) {
    const chunk = sample.slice(i, i + 150);
    const url = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json'
      + `?lon=${chunk.map((p) => p.lon.toFixed(6)).join('|')}`
      + `&lat=${chunk.map((p) => p.lat.toFixed(6)).join('|')}`
      + '&resource=ign_rge_alti_wld&zonly=true&delimiter=|';
    const res = await fetchWithRetry(url);
    if (!res.ok) return null;
    const json = await res.json();
    z.push(...json.elevations.map((e) => (typeof e === 'number' ? e : e.z)));
  }
  if (z.some((e) => e == null || e < -1000)) return null;
  eleCache[cacheKey] = z;
  return sample.map((p, i) => ({ ...p, ele: z[i] }));
}

// ---------------------------------------------------------------- Estimation de l'IBP
// L'IBP index est un algorithme propriétaire (ibpindex.com). Pour les traces sans
// IBP publié, on l'estime par une régression calée sur les randos du blog qui en ont un.
function fitIbpModel(samples) {
  const feats = (r) => [1, r.distanceKm, r.dplus / 100, r.dminus / 100];
  const solve = (rows) => {
    const k = 4;
    const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
    for (const r of rows) {
      const x = feats(r);
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j];
        A[i][k] += x[i] * r.ibp;
      }
    }
    for (let i = 0; i < k; i++) {
      let p = i;
      for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]];
      for (let r = 0; r < k; r++) {
        if (r === i) continue;
        const f = A[r][i] / A[i][i];
        for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c];
      }
    }
    return A.map((row, i) => row[k] / row[i]);
  };
  const predict = (coef, r) => feats(r).reduce((s, x, i) => s + x * coef[i], 0);
  if (samples.length < 15) {
    // Pas assez de données : formule par défaut, calée sur l'ensemble des randos du club.
    return { coef: [3, 1.6, 6.5, 2.5], n: 0, mae: null, predict };
  }
  let coef = solve(samples);
  const mae1 = samples.reduce((s, r) => s + Math.abs(predict(coef, r) - r.ibp), 0) / samples.length;
  // On écarte les valeurs aberrantes (IBP mal associé à une trace) puis on recale.
  const clean = samples.filter((r) => Math.abs(predict(coef, r) - r.ibp) <= 3 * mae1);
  coef = solve(clean);
  const mae = clean.reduce((s, r) => s + Math.abs(predict(coef, r) - r.ibp), 0) / clean.length;
  return { coef, n: clean.length, mae, predict };
}

// ---------------------------------------------------------------- Utilitaires
const idOf = (rel) => crypto.createHash('sha1').update(rel).digest('hex').slice(0, 10);
const prettyFileName = (f) => path.basename(f, path.extname(f))
  .replace(/^\d{4}[-_ ]\d{2}[-_ ]\d{2}[-_ ]*/, '')
  .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/^./, (c) => c.toUpperCase());
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-'])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

// Étiquettes des blogs qui désignent un pays (randos hors de France)
const COUNTRY_LABELS = { ESPAGNE: 'Espagne', BARDENAS: 'Espagne', LANZAROTE: 'Espagne', PORTUGAL: 'Portugal', ITALIE: 'Italie' };
function deptFromLabels(labels = []) {
  for (const l of labels) {
    const c = COUNTRY_LABELS[l.trim().toUpperCase()];
    if (c) return { deptCode: null, deptName: c };
  }
  for (const l of labels) {
    if (/^GR\s*\d/i.test(l)) continue;
    const m = l.match(/^(\d{2,3}|2[AB])\s*-?\s*(\D.+)$/i);
    if (m) return { deptCode: m[1], deptName: titleCase(m[2].trim()) };
    if (/^[A-ZÀ-Ü\s-]{3,}$/.test(l)) return { deptCode: null, deptName: titleCase(l) };
  }
  return null;
}

// « Bruno L. - Jean », « Guy et Pierre », « G1 Jean - Bernard / G2 Pierre » → noms séparés
function splitAnimateurs(randos) {
  const clean = (n) => n.trim().replace(/@/g, 'a').replace(/^G\d+\s+/i, '').replace(/\.+$/, '')
    .replace(/\s+/g, ' ').trim();
  const lists = randos.map((r) => (r.animateurs || '')
    .split(/\s+-\s*|\s*-\s+|\s+et\s+|[,&/;+]/i)
    .map(clean)
    .filter((n) => n && n.length > 1 && /\p{L}/u.test(n)));
  // « Pierre Bernard » sans séparateur : on coupe si chaque mot est un animateur connu.
  const known = new Set(lists.flat().filter((n) => !n.includes(' ')));
  randos.forEach((r, i) => {
    const names = lists[i].flatMap((n) => {
      const words = n.split(' ');
      return words.length > 1 && words.every((w) => known.has(w)) ? words : [n];
    });
    r.animateursList = [...new Set(names)];
  });
}

// ---------------------------------------------------------------- Programme principal
async function main() {
  const files = listGpxFiles(GPX_DIR);
  console.log(`🥾 ${files.length} fichiers GPX trouvés dans gpx/`);

  const catalog = readJSON(path.join(DATA_DIR, 'blog-catalog.json'), { items: [] });
  const blogByFile = new Map(catalog.items.map((it) => [it.file.toLowerCase(), it]));

  const randos = [];
  const tracks = new Map();
  const errors = [];

  await pool(files, 6, async (file) => {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const gpx = parseGpx(raw);
      let pts = flatten(gpx.segments);
      if (pts.length < 2) throw new Error('trace trop courte');

      const inBlogDir = path.dirname(file) === BLOG_GPX_DIR;
      const blog = inBlogDir ? blogByFile.get(path.basename(file).toLowerCase()) : null;
      const sidecar = readJSON(file.replace(/\.gpx$/i, '.json'), null);

      let ele = elevationStats(pts);
      let eleSource = 'gpx';
      if (!ele) {
        const filled = await fillElevation(pts, idOf(rel) + ':' + pts.length).catch(() => null);
        if (filled) { pts = filled; ele = elevationStats(pts); eleSource = 'ign'; }
      }

      const distanceKm = +(pts[pts.length - 1].d / 1000).toFixed(2);
      const start = pts[0], end = pts[pts.length - 1];
      const loopGap = haversine(start, end);
      const loop = loopGap < Math.max(250, distanceKm * 1000 * 0.03);
      const rec = recordedDuration(pts);
      const geo = await reverseGeocode(start.lat, start.lon);
      const blogDept = blog ? deptFromLabels(blog.departements) : null;
      const m = gpx.meta;

      const name = (sidecar && sidecar.name) || (blog && blog.name)
        || m.name || m.trackName || m.routeName || prettyFileName(file);
      const description = (sidecar && sidecar.description) || m.description || m.trackDescription
        || m.routeDescription || m.trackComment || null;
      const date = (sidecar && sidecar.date) || (blog && blog.date)
        || (m.time && m.time.slice(0, 10)) || (rec && rec.start.slice(0, 10))
        || (path.basename(file).match(/^(\d{4})[-_ ](\d{2})[-_ ](\d{2})/) || []).slice(1).join('-')
        || fs.statSync(file).mtime.toISOString().slice(0, 10);

      const id = idOf(rel);
      const simplified = simplifyTo(pts, 1500, 4);
      tracks.set(id, simplified.map((p) => [
        +p.lat.toFixed(5), +p.lon.toFixed(5),
        p.ele == null ? null : Math.round(p.ele), +(p.d / 1000).toFixed(3),
      ]));
      const shape = simplifyTo(pts, 48, 20).map((p) => [+p.lat.toFixed(4), +p.lon.toFixed(4)]);

      const ibpOfficial = (sidecar && sidecar.ibp) || (blog && blog.ibp) || null;
      randos.push({
        id,
        file: rel,
        fileSize: fs.statSync(file).size, // poids du fichier GPX, en octets
        // nom proposé au téléchargement : celui du fichier d'origine sur le Drive du blog
        downloadName: (blog && blog.originalName) || path.basename(file),
        // origine : blog des randos & photos, blog des itinérances GR, ou GPX ajouté à la main
        source: blog ? ((blog.sites || [blog.site]).includes('gr') ? 'gr' : 'photos') : 'perso',
        name,
        description,
        date,
        distanceKm,
        dplus: ele ? ele.dplus : null,
        dminus: ele ? ele.dminus : null,
        altMin: ele ? ele.altMin : null,
        altMax: ele ? ele.altMax : null,
        eleSource: ele ? eleSource : null,
        durationMin: estimateDurationMin(distanceKm, ele ? ele.dplus : 0, ele ? ele.dminus : 0),
        recorded: rec,
        slopes: ele ? slopeBreakdown(pts) : null,
        ibp: ibpOfficial,
        ibpSource: ibpOfficial ? (sidecar && sidecar.ibp ? 'fichier' : 'blog') : null,
        ibpEstimated: false,
        loop,
        start: [+start.lat.toFixed(5), +start.lon.toFixed(5)],
        bbox: bbox(pts),
        access: accessPoint(blog, start),
        commune: geo && geo.commune ? geo.commune : null,
        deptCode: (geo && geo.deptCode) || (blogDept && blogDept.deptCode) || null,
        deptName: (geo && geo.deptName) || (blogDept && blogDept.deptName) || null,
        region: geo ? geo.region || null : null,
        points: pts.length,
        kind: gpx.kind,
        waypoints: gpx.waypoints.filter((w) => w.name).slice(0, 40)
          .map((w) => ({ name: w.name, lat: +w.lat.toFixed(5), lon: +w.lon.toFixed(5) })),
        meta: Object.fromEntries(Object.entries(m).filter(([, v]) => v)),
        profile: profile(pts, 60),
        shape,
        animateurs: (() => {
          // Champ « animateurs » réutilisé pour les itinéraires (GR 65, GR 70…) : filtre « Itinéraire »
          const a = (sidecar && (sidecar.itineraires || sidecar.animateurs)) || (blog && (blog.itineraires || blog.animateurs)) || null;
          return Array.isArray(a) ? a.join(' - ') : a;
        })(),
        blog: blog ? {
          site: (blog.sites || [blog.site]).includes('gr') ? 'gr' : 'photos',
          url: blog.post.url,
          title: blog.post.title,
          outings: blog.outings,
          image: blog.image,
          cancelled: blog.cancelled,
          gpxUrl: blog.sourceUrl,
          albums: blog.albums || null,
          audio: (blog.audio || []).filter((a) => a.file && fs.existsSync(path.join(ROOT, 'audio', 'blog', a.file)))
            .map((a) => ({ file: `audio/blog/${a.file}`, label: a.label, seconds: a.seconds, url: a.sourceUrl })),
        } : null,
      });
    } catch (e) {
      errors.push(`${rel} : ${e.message}`);
    }
  });

  // Corrections manuelles et randos masquées
  const overrides = readJSON(OVERRIDES_FILE, {});
  for (const r of randos) {
    r.orig = Object.fromEntries(EDITABLE.map((k) => [k, r[k] ?? null]));
    const ov = overrides[r.file];
    if (!ov) continue;
    for (const k of EDITABLE) {
      if (ov[k] === undefined || ov[k] === null || ov[k] === '') continue;
      r[k] = k === 'ibp' ? Number(ov[k]) : Array.isArray(ov[k]) ? ov[k].join(' - ') : ov[k];
    }
    if (ov.ibp) r.ibpSource = 'manuel';
    r.edited = EDITABLE.some((k) => ov[k] !== undefined && ov[k] !== null && ov[k] !== '');
    r.hidden = !!ov.hidden;
  }

  // IBP estimé pour les traces qui n'en ont pas
  const samples = randos.filter((r) => r.ibpSource === 'blog' && r.dplus != null);
  const model = fitIbpModel(samples);
  for (const r of randos) {
    if (!r.ibp && r.dplus != null) {
      r.ibp = Math.max(1, Math.round(model.predict(model.coef, r)));
      r.ibpEstimated = true;
      r.ibpSource = 'estime';
    }
    r.level = levelOf(r.ibp);
  }
  if (model.n) {
    console.log(`📐 IBP estimé (régression sur ${model.n} randos du blog) : écart moyen ±${model.mae.toFixed(1)} points`);
  }

  // Liste des animateurs, nom par nom (pour le filtre)
  splitAnimateurs(randos);

  // Harmonise les noms de département (les étiquettes du blog n'ont pas d'accents)
  const officialName = new Map();
  for (const r of randos) if (r.deptCode && r.region) officialName.set(r.deptCode, r.deptName);
  for (const r of randos) if (r.deptCode && officialName.has(r.deptCode)) r.deptName = officialName.get(r.deptCode);

  randos.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));

  // Écriture des données (format .js pour fonctionner aussi en ouvrant index.html directement)
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  for (const f of fs.readdirSync(TRACKS_DIR)) {
    if (!tracks.has(f.replace(/\.js$/, ''))) fs.unlinkSync(path.join(TRACKS_DIR, f));
  }
  for (const r of randos) if (r.hidden) tracks.delete(r.id);
  for (const [id, t] of tracks) {
    fs.writeFileSync(path.join(TRACKS_DIR, `${id}.js`), `window.__rtTrack&&__rtTrack(${JSON.stringify(id)},${JSON.stringify(t)});`);
  }
  // Liste complète (y compris masquées) pour l'interface d'administration
  writeJSON(path.join(DATA_DIR, 'admin.json'), {
    generatedAt: new Date().toISOString(),
    randos: randos.map((r) => ({
      id: r.id, file: r.file, source: r.source, name: r.name, date: r.date, description: r.description,
      animateurs: r.animateurs, ibp: r.ibp, ibpSource: r.ibpSource, level: r.level, commune: r.commune,
      deptName: r.deptName, deptCode: r.deptCode, distanceKm: r.distanceKm, dplus: r.dplus, durationMin: r.durationMin,
      blogUrl: r.blog ? r.blog.url : null, hidden: !!r.hidden, edited: !!r.edited, orig: r.orig,
    })),
    errors,
  }, false);
  const hiddenCount = randos.filter((r) => r.hidden).length;
  for (const r of randos) {
    delete r.orig; delete r.edited;
    if (r.blog && !r.blog.audio.length) delete r.blog.audio;
    if (r.blog && !r.blog.albums) delete r.blog.albums;
  }
  const visible = randos.filter((r) => !r.hidden);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const firstYear = visible.reduce((y, r) => (r.date && r.date.slice(0, 4) < y ? r.date.slice(0, 4) : y), '9999');
  const total = {
    since: firstYear === '9999' ? null : +firstYear,
    km: Math.round(TOTAL_REF.km + visible
      .filter((r) => r.date > TOTAL_REF.date && r.date <= today && !(r.blog && r.blog.cancelled))
      .reduce((s, r) => s + r.distanceKm, 0)),
    ref: TOTAL_REF,
    asOf: today, // kilométrage arrêté à cette date (heure de Paris)
  };
  const payload = {
    generatedAt: new Date().toISOString(),
    total,
    levels: LEVELS.map(({ id, max, label }) => ({ id, max: max === Infinity ? null : max, label })),
    ibpModel: model.n ? { samples: model.n, mae: +model.mae.toFixed(1), coef: model.coef.map((c) => +c.toFixed(3)) } : null,
    blog: {
      sites: Array.isArray(catalog.source) ? catalog.source : DEFAULT_BLOGS,
      scrapedAt: catalog.generatedAt || null,                                   // dernière nouveauté reprise
      checkedAt: readJSON(path.join(CACHE_DIR, 'blog', 'last-check.json'), {}).checkedAt || catalog.generatedAt || null, // dernière vérification
    },
    randos: visible,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'randos.js'), `window.RANDOTHEQUE=${JSON.stringify(payload)};`);
  // Données minuscules pour le compteur à intégrer sur un blog (compteur.html)
  fs.writeFileSync(path.join(DATA_DIR, 'compteur.js'),
    `window.COMPTEUR=${JSON.stringify({ km: total.km, since: total.since, asOf: today, randos: visible.length, generatedAt: payload.generatedAt })};`);
  writeJSON(path.join(DATA_DIR, 'randos.json'), payload, false);
  writeJSON(GEO_CACHE_FILE, geoCache);
  writeJSON(ELE_CACHE_FILE, eleCache, false);

  const blogCount = visible.filter((r) => r.source !== 'perso').length;
  console.log(`✅ ${visible.length} randos générées (${blogCount} des blogs, ${visible.length - blogCount} perso${hiddenCount ? `, ${hiddenCount} masquée(s)` : ''}) → data/randos.js`);
  if (errors.length) {
    console.log(`⚠️  ${errors.length} fichier(s) ignoré(s) :`);
    errors.forEach((e) => console.log('   - ' + e));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
