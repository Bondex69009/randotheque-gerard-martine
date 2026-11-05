#!/usr/bin/env node
// Récupère la liste des randos publiées sur RandoGPS (randogps.net) dans le Gard et les
// départements voisins, pour la recherche « Ailleurs sur le web » de la page d'accueil.
// Ces randos ne sont PAS les nôtres : elles ne vont que dans data/randogps.json,
// jamais dans randos.json, les chiffres ou le compteur.
// RandoGPS n'autorise pas la lecture directe depuis le navigateur : on la fait ici,
// à chaque mise à jour automatique. En cas d'échec, l'ancienne liste est gardée.
import path from 'node:path';
import { DATA_DIR, decodeEntities, fetchWithRetry, readJSON, writeJSON, sleep } from './lib/util.mjs';

const BASE = 'https://www.randogps.net/';
const DEPARTEMENTS = [
  ['gard', 30], ['herault', 34], ['bouches-du-rhone', 13],
  ['ardeche', 7], ['vaucluse', 84], ['lozere', 48],
];
const OUT = path.join(DATA_DIR, 'randogps.json');

// Accents écrits en entités HTML (&eacute;…) : decodeEntities ne gère que les entités de base.
const ACCENTS = { eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', ccedil: 'ç',
  icirc: 'î', iuml: 'ï', ocirc: 'ô', ugrave: 'ù', ucirc: 'û', Eacute: 'É', Egrave: 'È', rsquo: '’', oelig: 'œ' };
const clean = (s) => decodeEntities(String(s || '').replace(/&([a-zA-Z]+);/g, (m, e) => ACCENTS[e] || m))
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const num = (s) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };

function parse(html, dep) {
  const byNum = new Map();
  // Tous les circuits du département : un point sur la carte, avec « NOM - 12.5 Km » en titre.
  const dotRe = /<a href="(randonnee-pedestre-gps-[a-z-]+-\d+\.php\?num=(\d+)&meta=[^"]*)"><img[^>]*title="([^"]*?)(?: - ([\d.,]+) Km)?\s*"/g;
  for (const m of html.matchAll(dotRe)) {
    const name = clean(m[3]);
    if (!name) continue;
    byNum.set(m[2], { n: name, km: num(m[4]), i: +m[2], d: dep });
  }
  // Les derniers circuits publiés ont aussi le dénivelé et le lieu de départ.
  const cardRe = /<b>&nbsp;([^<]+)<\/b><br>&nbsp;Distance:\s*([\d.,]+)&nbsp;Km.*?D&eacute;nivel&eacute;:\s*(\d+)&nbsp;M.*?\?num=(\d+)&.*?D&eacute;part randonn&eacute;e <\/b>:\s*([^<]*)/gs;
  for (const m of html.matchAll(cardRe)) {
    const r = byNum.get(m[4]) || { n: clean(m[1]), km: num(m[2]), i: +m[4], d: dep };
    r.dp = Number(m[3]) || null;
    const depart = clean(m[5]);
    if (depart) r.dep = depart.slice(0, 80);
    byNum.set(m[4], r);
  }
  return [...byNum.values()];
}

const previous = readJSON(OUT, null);
const randos = [];
let ok = 0;
for (const [slug, code] of DEPARTEMENTS) {
  const page = `randonnee-pedestre-gps-${slug}-${code}.php`;
  try {
    const res = await fetchWithRetry(BASE + page);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const found = parse(await res.text(), code);
    console.log(`RandoGPS ${slug} (${code}) : ${found.length} randos`);
    randos.push(...found);
    ok++;
  } catch (e) {
    console.warn(`RandoGPS ${slug} (${code}) : échec (${e.message})`);
    // On garde ce qu'on avait pour ce département
    if (previous?.randos) randos.push(...previous.randos.filter((r) => r.d === code));
  }
  await sleep(500);
}

if (!randos.length) {
  console.warn('RandoGPS : aucune rando récupérée, fichier inchangé.');
} else {
  // Adresse d'une rando (reconstruite dans le navigateur) :
  // https://www.randogps.net/randonnee-pedestre-gps-<pages[d]>.php?num=<i>&meta=<n>
  const pages = Object.fromEntries(DEPARTEMENTS.map(([slug, code]) => [code, `${slug}-${code}`]));
  writeJSON(OUT, { source: 'randogps.net', updated: ok ? new Date().toISOString() : previous?.updated, pages, randos }, false);
  console.log(`RandoGPS : ${randos.length} randos dans data/randogps.json`);
}
