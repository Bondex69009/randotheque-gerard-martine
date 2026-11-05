/* Randothèque – « Chercher aussi sur » : randos trouvées sur d'autres sites (Visorando, RandoGPS,
   blog Poulx Rando Pédestre), affichées dans un panneau à part sous la barre de recherche.
   Ces randos ne sont PAS les nôtres : ce fichier ne lit ni ne modifie les données de la randothèque,
   les filtres, les chiffres ou le compteur. Il reçoit seulement de app.js le texte cherché
   (événement « randos:search »). */
(() => {
  'use strict';
  const tabsBox = document.getElementById('elsewhere-tabs');
  const panel = document.getElementById('elsewhere-panel');
  if (!tabsBox || !panel) return;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const words = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 1);
  const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const km = (n) => (n ? `${nf1.format(n)} km` : '');
  const plus = (n) => (n ? `+${Math.round(n)} m` : '');
  const MAX = 30;

  // Fiche d'une rando Visorando : on lit sa page publique (fiche technique, point de départ).
  // La trace GPS n'est téléchargeable qu'avec un compte Visorando : on ne la récupère pas.
  async function visorandoFiche(url, title) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    // Fiche technique : <div class="vr-walk-datasheet--dataset"><strong>Distance :</strong> 14,45 km</div>
    const sheet = {};
    for (const el of doc.querySelectorAll('.vr-walk-datasheet--dataset')) {
      const label = el.querySelector('strong')?.textContent.replace(/[\s\u00a0]*:[\s\u00a0]*$/, '').trim();
      if (label && !(label in sheet)) sheet[label] = el.textContent.replace(el.querySelector('strong').textContent, '').replace(/\s+/g, ' ').trim();
    }
    const num = (s) => { const n = parseFloat(String(s || '').replace(/[\s\u00a0\u2009]/g, '').replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };
    const lat = num(doc.querySelector('meta[property="og:latitude"]')?.content);
    const lon = num(doc.querySelector('meta[property="og:longitude"]')?.content);
    const start = lat != null && lon != null ? [lat, lon] : null;
    const diff = sheet['Difficulté'] || '';
    const LEVEL = { 'tres facile': 'vert', facile: 'bleu', moyenne: 'jaune', difficile: 'rouge' };
    const dur = Object.entries(sheet).find(([k]) => /^Durée/.test(k))?.[1] || '';
    const h = dur.match(/(\d+)\s*h\s*(\d+)?/);
    return {
      id: `vr-${slug(url)}`, sourceName: 'Visorando', name: doc.querySelector('h1')?.textContent.trim() || title, url,
      commune: (sheet.Commune || '').replace(/\s*\(.*$/, '') || null,
      distanceKm: num(sheet.Distance), dplus: num(sheet['Dénivelé positif']), dminus: num(sheet['Dénivelé négatif']) == null ? null : Math.abs(num(sheet['Dénivelé négatif'])),
      altMax: num(sheet['Point haut']), altMin: num(sheet['Point bas']),
      durationMin: h ? (+h[1]) * 60 + (+h[2] || 0) : null, durationText: h ? dur : '',
      level: LEVEL[norm(diff)] || null, levelTitle: 'Difficulté', levelText: diff && !/non renseign/i.test(diff) ? diff : '',
      start, image: doc.querySelector('meta[property="og:image"]')?.content || null,
      gpxUrl: url, gpxLabel: 'GPX sur Visorando (avec un compte)', gpxNote: 'le GPX est réservé aux membres inscrits',
    };
  }

  // ---------------------------------------------------------------- Sources
  // Chaque source : search(terme) → Promise<{ items: [{ title, url, meta: [] , sub }], more }>
  // « more » = adresse où voir la recherche complète sur le site.
  const SOURCES = [
    {
      id: 'visorando', name: 'Visorando', home: 'https://www.visorando.com/',
      // Visorando autorise la lecture depuis un autre site. On essaie d'abord la page de la commune
      // (« randonnee-uzes.html » : les randos autour d'Uzès), sinon sa recherche par mot.
      async search(t) {
        const page = `https://www.visorando.com/randonnee-${slug(t)}.html`;
        const res = await fetch(page, { credentials: 'omit' });
        if (res.ok) {
          const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
          const items = [...doc.querySelectorAll('.vr-card--rando')].map((card) => {
            const a = card.querySelector('a.card--link');
            if (!a) return null;
            const tag = (t) => card.querySelector(`.card--datasheet img[title="${t}"]`)?.parentElement?.textContent.replace(/\s+/g, ' ').trim() || '';
            const lvl = card.querySelector('.card--datasheet img[src*="level-"]')?.getAttribute('title') || '';
            const start = tag('Départ');
            return {
              title: a.getAttribute('title') || a.textContent.trim(),
              url: a.href,
              meta: [tag('Distance'), tag('Dénivelé positif'), tag('Durée'), lvl].filter(Boolean),
              sub: start,
              fiche: () => visorandoFiche(a.href, a.getAttribute('title') || a.textContent.trim()),
            };
          }).filter(Boolean);
          if (items.length) return { items, more: page };
        }
        // Recherche par mot : elle ratisse large, on ne garde que les titres qui contiennent le terme.
        const more = `https://www.visorando.com/index.php?component=search&task=searchRandonnee&mainSearchInput=${encodeURIComponent(t)}`;
        const r2 = await fetch(more, { credentials: 'omit' });
        if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
        const doc = new DOMParser().parseFromString(await r2.text(), 'text/html');
        const want = words(t);
        const items = [...doc.querySelectorAll('a[href^="https://www.visorando.com/randonnee-"]')]
          .filter((a) => a.closest('li') && want.every((w) => norm(a.textContent).includes(w)))
          .map((a) => {
            const info = a.closest('li').querySelector('span')?.textContent.replace(/\s+/g, ' ').trim() || '';
            return { title: a.textContent.trim(), url: a.href, meta: [info.split('•').pop().trim()].filter(Boolean),
              fiche: () => visorandoFiche(a.href, a.textContent.trim()) };
          });
        return { items, more };
      },
    },
    {
      id: 'randogps', name: 'RandoGPS', home: 'https://www.randogps.net/',
      // RandoGPS ne se laisse pas lire depuis le navigateur : la liste de ses randos (Gard et
      // départements voisins) est récupérée à chaque mise à jour du site (scripts/scrape-randogps.mjs).
      data: null,
      async search(t) {
        if (!this.data) {
          const res = await fetch('data/randogps.json', { cache: 'no-cache' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          this.data = await res.json();
          for (const r of this.data.randos) r._n = ` ${norm(`${r.n} ${r.dep || ''}`).replace(/[^a-z0-9]+/g, ' ')}`;
        }
        const { pages, randos } = this.data;
        const want = words(t);
        if (!want.length) return { items: [] };
        const DEPS = { 30: 'Gard', 34: 'Hérault', 13: 'Bouches-du-Rhône', 7: 'Ardèche', 84: 'Vaucluse', 48: 'Lozère' };
        // Chaque mot cherché doit commencer un mot du nom (« uzes » ne trouve pas « Pouzes »)
        const items = randos
          .filter((r) => want.every((w) => r._n.includes(` ${w}`)))
          .sort((a, b) => (a.d === 30 ? 0 : 1) - (b.d === 30 ? 0 : 1))
          .map((r) => ({
            title: r.n.charAt(0) + r.n.slice(1).toLowerCase(),
            url: `https://www.randogps.net/randonnee-pedestre-gps-${pages[r.d]}.php?num=${r.i}&meta=${encodeURIComponent(r.n)}`,
            meta: [km(r.km), plus(r.dp), DEPS[r.d] || ''].filter(Boolean),
            sub: r.dep ? `Départ : ${r.dep}` : '',
            fiche: async () => ({
              id: `rg-${r.d}-${r.i}`, sourceName: 'RandoGPS', name: r.n.charAt(0) + r.n.slice(1).toLowerCase(),
              url: `https://www.randogps.net/randonnee-pedestre-gps-${pages[r.d]}.php?num=${r.i}&meta=${encodeURIComponent(r.n)}`,
              deptName: DEPS[r.d] || null, distanceKm: r.km, dplus: r.dp ?? null,
              durationMin: r.km ? Math.round((r.km / 4 + (r.dp || 0) / 300) * 60) : null,
              departText: r.dep || '', gpxNote: 'le GPX est réservé aux membres du site',
            }),
          }));
        return { items, more: 'https://www.randogps.net/cherche/search-commune.php' };
      },
    },
    {
      id: 'poulx', name: 'Poulx Rando Pédestre', home: 'https://poulxrandopedestre.blogspot.com/',
      // Articles du blog et traces GPX récupérés à chaque mise à jour du site (scripts/scrape-poulx.mjs)
      data: null,
      async search(t) {
        if (!this.data) {
          const res = await fetch('externes/poulx/poulx.json', { cache: 'no-cache' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          this.data = await res.json();
          for (const r of this.data.items) r._n = ` ${norm(`${r.place} ${r.commune || ''} ${r.animateurs || ''}`).replace(/[^a-z0-9]+/g, ' ')}`;
        }
        const want = words(t);
        const more = `https://poulxrandopedestre.blogspot.com/search?q=${encodeURIComponent(t)}`;
        if (!want.length) return { items: [], more };
        const FFR = { vert: 'vert', bleu: 'bleu', jaune: 'jaune', orange: 'jaune', rouge: 'rouge', noir: 'noir' };
        const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');
        const items = this.data.items.filter((r) => want.every((w) => r._n.includes(` ${w}`))).map((r) => {
          const name = cap(r.place) || r.commune || 'Rando';
          const date = r.date ? new Date(`${r.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
          return {
            title: r.part ? `${name} (trace ${r.part})` : name,
            url: r.url,
            meta: [km(r.km), plus(r.dplus), date].filter(Boolean),
            sub: [r.id ? 'Trace, profil et survol 3D' : '', r.animateurs ? `Animée par ${r.animateurs}` : ''].filter(Boolean).join(' · '),
            fiche: async () => ({
              id: r.id || `px-${this.data.items.indexOf(r)}`,
              sourceName: 'Poulx Rando Pédestre', name: r.part ? `${name} (trace ${r.part})` : name,
              url: r.url, date: r.date, animateurs: r.animateurs, image: r.image, photos: r.photos, relive: r.relive,
              commune: r.commune, deptName: r.deptName, region: r.deptCode ? 'France' : null,
              trackUrl: r.id ? `externes/poulx/tracks/${r.id}.js` : null,
              distanceKm: r.km, dplus: r.dplus, dminus: r.dminus ?? null, altMin: r.altMin ?? null, altMax: r.altMax ?? null,
              durationMin: r.durationMin || null, loop: r.loop, start: r.start || null,
              level: FFR[r.ffr] || null, levelTitle: 'Indice FFR', levelText: r.ffr ? cap(r.ffr) : '',
              gpxUrl: r.gpx, gpxLabel: 'GPX sur le Drive du blog',
              gpxNote: r.gpx ? 'trace pas encore récupérée par la randothèque' : 'pas de GPX dans cet article',
            }),
          };
        });
        return { items, more };
      },
    },
  ];

  // ---------------------------------------------------------------- État
  let term = '';             // ce qu'on cherche (texte de la barre, sinon commune choisie)
  let active = null;         // source affichée dans le panneau (null = panneau fermé)
  const cache = new Map();   // `${source}|${terme}` → Promise<résultat>
  const results = {};        // source → { term, status: 'loading'|'ok'|'error', data }

  const run = (src) => {
    const key = `${src.id}|${norm(term)}`;
    if (!cache.has(key)) cache.set(key, src.search(term).catch((e) => { cache.delete(key); throw e; }));
    const t = term;
    results[src.id] = { term: t, status: 'loading' };
    cache.get(key).then(
      (data) => { if (t === term) { results[src.id] = { term: t, status: 'ok', data }; render(); } },
      () => { if (t === term) { results[src.id] = { term: t, status: 'error' }; render(); } },
    );
  };
  const searchAll = () => { if (term.length >= 3) SOURCES.forEach(run); render(); };

  // ---------------------------------------------------------------- Affichage
  function renderTabs() {
    tabsBox.innerHTML = SOURCES.map((s) => {
      const r = results[s.id];
      const count = term.length >= 3 && r?.term === term
        ? (r.status === 'loading' ? '<span class="elsewhere__count is-loading" aria-label="recherche en cours">…</span>'
          : r.status === 'ok' ? `<span class="elsewhere__count">${r.data.items.length > MAX ? `${MAX}+` : r.data.items.length}</span>` : '')
        : '';
      return `<button type="button" class="elsewhere__tab" data-src="${s.id}" aria-pressed="${active === s.id}" aria-controls="elsewhere-panel">${esc(s.name)}${count}</button>`;
    }).join('');
  }

  function renderPanel() {
    const src = SOURCES.find((s) => s.id === active);
    panel.hidden = !src;
    if (!src) { panel.innerHTML = ''; return; }
    const head = `<div class="elsewhere__head">
        <p class="elsewhere__note">Randos trouvées sur <strong>${esc(src.name)}</strong>${term.length >= 3 ? ` pour « ${esc(term)} »` : ''}. Elles ne font pas partie de nos randos et ne comptent dans aucun chiffre.</p>
        <button type="button" class="elsewhere__close" data-close aria-label="Fermer"><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button>
      </div>`;
    const link = (href, label) => `<a class="elsewhere__more" href="${esc(href)}" target="_blank" rel="noopener">${label}<svg class="icon" aria-hidden="true"><use href="#i-external"/></svg></a>`;
    if (term.length < 3) {
      panel.innerHTML = `${head}<p class="elsewhere__msg">Tapez un village ou un lieu (3 lettres au moins) dans la barre de recherche, ou choisissez une commune dans les suggestions.</p>${link(src.home, `Ouvrir ${esc(src.name)}`)}`;
      return;
    }
    const r = results[src.id];
    if (!r || r.term !== term || r.status === 'loading') {
      panel.innerHTML = `${head}<p class="elsewhere__msg" role="status">Recherche sur ${esc(src.name)}…</p>`;
      return;
    }
    if (r.status === 'error') {
      panel.innerHTML = `${head}<p class="elsewhere__msg" role="status">${esc(src.name)} ne répond pas pour le moment.</p>${link(src.home, `Ouvrir ${esc(src.name)}`)}`;
      return;
    }
    const { items, more } = r.data;
    const list = items.slice(0, MAX).map((it, i) => `<li>
        <button type="button" class="elsewhere__item" data-fiche="${i}" title="Ouvrir la fiche dans la randothèque">
          <span class="elsewhere__title">${esc(it.title)}</span>
          ${it.meta?.length ? `<span class="elsewhere__meta">${it.meta.map(esc).join(' · ')}</span>` : ''}
          ${it.sub ? `<span class="elsewhere__sub">${esc(it.sub)}</span>` : ''}
        </button></li>`).join('');
    panel.innerHTML = `${head}${items.length
      ? `<ul class="elsewhere__results" role="list">${list}</ul>`
      : `<p class="elsewhere__msg" role="status">Aucune rando trouvée sur ${esc(src.name)} pour « ${esc(term)} ».</p>`}
      ${link(more || src.home, items.length > MAX ? `Voir les ${items.length} résultats sur ${esc(src.name)}` : `Chercher sur ${esc(src.name)}`)}`;
  }

  function render() { renderTabs(); renderPanel(); }

  // ---------------------------------------------------------------- Événements
  tabsBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-src]');
    if (!b) return;
    active = active === b.dataset.src ? null : b.dataset.src;
    if (active) searchAll(); else render();
  });
  panel.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { active = null; render(); tabsBox.querySelector('[data-src]')?.focus(); return; }
    const btn = e.target.closest('[data-fiche]');
    const r = btn && results[active];
    const it = r?.status === 'ok' ? r.data.items[+btn.dataset.fiche] : null;
    if (!it) return;
    // Sans fiche possible (ou si la page n'est pas prête), on ouvre la rando sur son site
    if (!it.fiche || !window.RTExternal) { window.open(it.url, '_blank', 'noopener'); return; }
    btn.setAttribute('aria-busy', 'true');
    try {
      window.RTExternal.open(await it.fiche());
    } catch {
      window.open(it.url, '_blank', 'noopener');
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });

  let timer;
  document.addEventListener('randos:search', (e) => {
    const { q, communes } = e.detail || {};
    const next = (q || '').trim() || (communes && communes[0]) || '';
    if (next === term) return;
    term = next;
    clearTimeout(timer);
    render();
    // On n'interroge les autres sites que si le panneau est ouvert, après une courte pause de frappe.
    if (active) timer = setTimeout(searchAll, 450);
  });

  render();
})();
