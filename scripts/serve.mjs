#!/usr/bin/env node
// Serveur de la Randothèque : site public + interface d'administration.
//
//   npm run serve            → http://localhost:8080
//
// L'administration est accessible par une adresse secrète, sans mot de passe :
//   http://localhost:8080/admin/<jeton>
// Le jeton est créé au premier lancement dans le fichier .admin-token (ou variable ADMIN_TOKEN).
// Pour changer l'adresse, supprimez .admin-token et relancez le serveur.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, GPX_DIR, DATA_DIR, readJSON, writeJSON, slugify } from './lib/util.mjs';
import { parseGpx } from './lib/gpx.mjs';

const PORT = Number(process.env.PORT) || 8080;
const TOKEN_FILE = path.join(ROOT, '.admin-token');
const OVERRIDES_FILE = path.join(DATA_DIR, 'overrides.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const PERSO_DIR = path.join(GPX_DIR, 'mes-randos');
const TRASH_DIR = path.join(GPX_DIR, '.corbeille');
const TRASH_INDEX = path.join(TRASH_DIR, 'index.json');
const EDITABLE = ['name', 'date', 'description', 'animateurs', 'ibp', 'commune'];
const MAX_UPLOAD = 25 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.gpx': 'application/gpx+xml', '.md': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.wav': 'audio/wav', '.webm': 'audio/webm',
};

// ---------------------------------------------------------------- Jeton d'accès
function loadToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  const token = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  return token;
}
const TOKEN = loadToken();
const tokenOk = (t) => {
  const a = Buffer.from(String(t || '')), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// ---------------------------------------------------------------- Reconstruction (une à la fois)
let queue = Promise.resolve();
function runNode(script, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', script)], { cwd: ROOT });
    child.stdout.on('data', (d) => log && log(String(d)));
    child.stderr.on('data', (d) => log && log(String(d)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${script} a échoué (code ${code})`))));
  });
}
const rebuild = () => (queue = queue.catch(() => {}).then(() => runNode('build.mjs')));

const job = { running: false, log: '', ok: null, startedAt: null, finishedAt: null };
function startSync() {
  if (job.running) return false;
  Object.assign(job, { running: true, log: '', ok: null, startedAt: new Date().toISOString(), finishedAt: null });
  const log = (s) => { job.log = (job.log + s).slice(-6000); };
  queue = queue.catch(() => {}).then(async () => {
    try {
      await runNode('scrape-blog.mjs', log);
      await runNode('build.mjs', log);
      job.ok = true;
    } catch (e) {
      log(`\n${e.message}\n`);
      job.ok = false;
    } finally {
      job.running = false;
      job.finishedAt = new Date().toISOString();
    }
  });
  return true;
}

// ---------------------------------------------------------------- Données
const adminIndex = () => readJSON(ADMIN_FILE, { randos: [] });
const findRando = (id) => adminIndex().randos.find((r) => r.id === id);
const readOverrides = () => readJSON(OVERRIDES_FILE, {});
function saveOverrides(o) {
  const tmp = OVERRIDES_FILE + '.tmp';
  writeJSON(tmp, o);
  fs.renameSync(tmp, OVERRIDES_FILE);
}
const readTrash = () => readJSON(TRASH_INDEX, []);
const saveTrash = (t) => writeJSON(TRASH_INDEX, t);

function cleanFields(body) {
  const out = {};
  for (const k of EDITABLE) {
    if (!(k in body)) continue;
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v == null) { out[k] = null; continue; }
    if (k === 'ibp') {
      v = Math.round(Number(v));
      if (!(v > 0 && v < 400)) throw httpError(400, "L'IBP doit être un nombre entre 1 et 399.");
    }
    if (k === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw httpError(400, 'Date invalide (format AAAA-MM-JJ).');
    if (typeof v === 'string' && v.length > 4000) v = v.slice(0, 4000);
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- HTTP
const httpError = (status, message) => Object.assign(new Error(message), { status });
const send = (res, status, body, headers = {}) => {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
};
function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'Fichier trop volumineux (25 Mo maximum).')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJsonBody = async (req) => {
  try { return JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}'); }
  catch (e) { throw e.status ? e : httpError(400, 'Requête invalide.'); }
};

async function api(req, res, route) {
  const method = req.method;
  const [a, b, c] = route;

  if (method === 'GET' && a === 'randos' && !b) {
    return send(res, 200, { ...adminIndex(), trash: readTrash(), job: { ...job, log: undefined } });
  }

  // Ajout d'un fichier GPX
  if (method === 'POST' && a === 'upload') {
    const original = decodeURIComponent(req.headers['x-filename'] || 'rando.gpx');
    if (!/\.gpx$/i.test(original)) throw httpError(400, 'Seuls les fichiers .gpx sont acceptés.');
    const buf = await readBody(req);
    try { parseGpx(buf.toString('utf8')); } catch (e) { throw httpError(400, `Fichier GPX illisible : ${e.message}`); }
    fs.mkdirSync(PERSO_DIR, { recursive: true });
    const base = slugify(original.replace(/\.gpx$/i, '')) || 'rando';
    let name = `${base}.gpx`;
    for (let n = 2; fs.existsSync(path.join(PERSO_DIR, name)); n++) name = `${base}-${n}.gpx`;
    fs.writeFileSync(path.join(PERSO_DIR, name), buf);
    await rebuild();
    const file = `gpx/mes-randos/${name}`;
    const rando = adminIndex().randos.find((r) => r.file === file);
    if (!rando) throw httpError(500, "Le fichier a été enregistré mais n'a pas pu être analysé.");
    return send(res, 201, { rando });
  }

  // Synchronisation avec le blog
  if (a === 'sync') {
    if (method === 'POST') return send(res, startSync() ? 202 : 409, job);
    if (method === 'GET') return send(res, 200, job);
  }

  // Restauration depuis la corbeille
  if (method === 'POST' && a === 'trash' && b && c === 'restore') {
    const trash = readTrash();
    const item = trash.find((t) => t.id === b);
    if (!item) throw httpError(404, 'Élément introuvable dans la corbeille.');
    const dest = path.join(ROOT, item.original);
    if (fs.existsSync(dest)) throw httpError(409, 'Un fichier du même nom existe déjà.');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(path.join(TRASH_DIR, item.trashFile), dest);
    if (item.sidecar && fs.existsSync(path.join(TRASH_DIR, item.sidecar))) {
      fs.renameSync(path.join(TRASH_DIR, item.sidecar), dest.replace(/\.gpx$/i, '.json'));
    }
    saveTrash(trash.filter((t) => t.id !== b));
    await rebuild();
    return send(res, 200, { ok: true });
  }

  if (a === 'randos' && b) {
    const rando = findRando(b);
    if (!rando) throw httpError(404, 'Rando introuvable. Rechargez la page.');
    const overrides = readOverrides();

    if (method === 'PATCH' && !c) {
      const fields = cleanFields(await readJsonBody(req));
      const ov = { ...(overrides[rando.file] || {}) };
      for (const [k, v] of Object.entries(fields)) {
        // une valeur identique à l'origine n'est pas une correction
        const orig = rando.orig ? rando.orig[k] : undefined;
        if (v === null || String(v) === String(orig ?? '')) delete ov[k]; else ov[k] = v;
      }
      if (Object.keys(ov).length) overrides[rando.file] = ov; else delete overrides[rando.file];
      saveOverrides(overrides);
      await rebuild();
      return send(res, 200, { rando: findRando(b) });
    }

    if (method === 'DELETE' && !c) {
      if (rando.source !== 'perso') {
        // Les GPX du blog seraient retéléchargés : on les masque.
        overrides[rando.file] = { ...(overrides[rando.file] || {}), hidden: true };
        saveOverrides(overrides);
      } else {
        const src = path.join(ROOT, rando.file);
        if (!src.startsWith(GPX_DIR + path.sep) || !fs.existsSync(src)) throw httpError(404, 'Fichier introuvable.');
        fs.mkdirSync(TRASH_DIR, { recursive: true });
        const id = crypto.randomBytes(6).toString('hex');
        const trashFile = `${id}__${path.basename(src)}`;
        fs.renameSync(src, path.join(TRASH_DIR, trashFile));
        let sidecar = null;
        const json = src.replace(/\.gpx$/i, '.json');
        if (fs.existsSync(json)) { sidecar = `${id}__${path.basename(json)}`; fs.renameSync(json, path.join(TRASH_DIR, sidecar)); }
        saveTrash([{ id, trashFile, sidecar, original: rando.file, name: rando.name, deletedAt: new Date().toISOString() }, ...readTrash()]);
      }
      await rebuild();
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && c === 'restore') {
      const ov = { ...(overrides[rando.file] || {}) };
      delete ov.hidden;
      if (Object.keys(ov).length) overrides[rando.file] = ov; else delete overrides[rando.file];
      saveOverrides(overrides);
      await rebuild();
      return send(res, 200, { rando: findRando(b) });
    }
  }

  throw httpError(404, 'Action inconnue.');
}

function serveStatic(req, res, urlPath) {
  // Pas de fichiers cachés (.admin-token, .cache…) ni d'accès direct à la page d'administration.
  if (urlPath.split('/').some((seg) => seg.startsWith('.')) || /^\/(admin\.html|data\/(admin|overrides)\.json)$/.test(urlPath)) return send(res, 404, 'Introuvable');
  let file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Interdit');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Introuvable');
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
    // Pas de nom imposé : le site propose le nom d'origine du GPX (attribut download), comme sur GitHub Pages
    if (ext === '.gpx') headers['Content-Disposition'] = 'attachment';
    // Lecture partielle (« Range ») : indispensable pour avancer dans un audio (et pour Safari).
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = st.size - 1, status = 200;
    if (range && (range[1] || range[2])) {
      start = range[1] ? +range[1] : Math.max(0, st.size - +range[2]);
      end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) {
        return res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}

http.createServer(async (req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'Adresse invalide'); }
  const parts = urlPath.split('/').filter(Boolean);
  try {
    if (parts[0] === 'admin') {
      if (!tokenOk(parts[1])) return send(res, 404, 'Introuvable');
      return fs.readFile(path.join(ROOT, 'admin.html'), (err, buf) => (err
        ? send(res, 500, 'admin.html manquant')
        : res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }).end(buf)));
    }
    if (parts[0] === 'api') {
      if (!tokenOk(parts[1])) return send(res, 404, { error: 'Introuvable' });
      return await api(req, res, parts.slice(2));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée');
    return serveStatic(req, res, urlPath);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : `Erreur : ${e.message}` });
  }
}).listen(PORT, () => {
  console.log(`🥾 Randothèque : http://localhost:${PORT}`);
  console.log(`🔧 Administration (adresse secrète, ne la partagez qu'avec les gestionnaires) :`);
  console.log(`   http://localhost:${PORT}/admin/${TOKEN}`);
});
