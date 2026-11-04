#!/usr/bin/env node
// Rassemble dans _site/ uniquement les fichiers du site public (pour GitHub Pages).
// À lancer après « npm run build ».
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/util.mjs';

const OUT = path.join(ROOT, '_site');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

const noHidden = (src) => !path.basename(src).startsWith('.');
const copy = (from, to, filter = noHidden) => fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true, filter });

if (!fs.existsSync(path.join(ROOT, 'data', 'randos.js'))) {
  console.error('data/randos.js manquant : lancez d\'abord « npm run build ».');
  process.exit(1);
}
copy('index.html', 'index.html');
copy('compteur.html', 'compteur.html');
// Les données changent à chaque mise à jour : on ajoute un numéro de version à leur adresse
// pour que les navigateurs (et le gadget du blog) ne réutilisent pas une ancienne copie en cache.
const version = Date.now().toString(36);
for (const [page, data] of [['index.html', 'data/randos.js'], ['compteur.html', 'data/compteur.js']]) {
  const file = path.join(OUT, page);
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes(`src="${data}"`)) throw new Error(`${page} : balise ${data} introuvable`);
  fs.writeFileSync(file, html.replace(`src="${data}"`, `src="${data}?v=${version}"`));
}
copy('data/compteur.js', 'data/compteur.js');
copy('robots.txt', 'robots.txt');
copy('assets', 'assets', (src) => noHidden(src) && !/[\\/]admin\.(css|js)$/.test(src));
copy('data/randos.js', 'data/randos.js');
copy('data/tracks', 'data/tracks');
copy('gpx', 'gpx');
if (fs.existsSync(path.join(ROOT, 'audio'))) copy('audio', 'audio');
// Pas de traitement Jekyll par GitHub Pages
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((s, e) => s + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`📦 Site prêt dans _site/ (${(size(OUT) / 1e6).toFixed(1)} Mo)`);
