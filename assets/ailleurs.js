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
            return { title: a.textContent.trim(), url: a.href, meta: [info.split('•').pop().trim()].filter(Boolean) };
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
          }));
        return { items, more: 'https://www.randogps.net/cherche/search-commune.php' };
      },
    },
    {
      id: 'poulx', name: 'Poulx Rando Pédestre', home: 'https://poulxrandopedestre.blogspot.com/',
      // Blog Blogger : son flux de recherche officiel, lu en « JSONP » (balise script).
      search(t) {
        const term = norm(t);
        const more = `https://poulxrandopedestre.blogspot.com/search?q=${encodeURIComponent(t)}`;
        return new Promise((resolve, reject) => {
          const cb = `__poulx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          const s = document.createElement('script');
          const done = () => { delete window[cb]; s.remove(); clearTimeout(timer); };
          const timer = setTimeout(() => { done(); reject(new Error('délai dépassé')); }, 12000);
          window[cb] = (json) => {
            done();
            const entries = json?.feed?.entry || [];
            resolve({ more, items: entries.map((e) => {
              const link = (e.link || []).find((l) => l.rel === 'alternate')?.href;
              const tmp = document.createElement('div');
              tmp.innerHTML = (e.summary?.$t || '').replace(/<[^>]*>/g, ' ');
              const text = tmp.textContent.replace(/\s+/g, ' ').trim();
              // Résumé du type « UZES 8km +190m Animateur : Sergio Nous sommes passés par là… »
              const m = text.match(/^(.*?)(\d+(?:[.,]\d+)?)\s*km/i);
              const place = m ? m[1].trim() : '';
              const dist = m ? parseFloat(m[2].replace(',', '.')) : null;
              const dp = text.match(/\+\s*(\d+)\s*m/i)?.[1];
              const anim = text.match(/Animat(?:eur|rice)s?\s*:?\s*(.+?)(?=\s*(?:Nous sommes|Indice|Format|Toutes les|$))/i)?.[1];
              const date = (e.published?.$t || '').slice(0, 10);
              return {
                title: place ? place.charAt(0) + place.slice(1).toLowerCase() : (e.title?.$t || 'Rando'),
                url: link,
                meta: [km(dist), plus(dp), date ? new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : ''].filter(Boolean),
                sub: anim ? `Animée par ${anim.trim()}` : '',
              };
            }).filter((it) => it.url) });
          };
          s.src = `https://poulxrandopedestre.blogspot.com/feeds/posts/summary?alt=json-in-script&max-results=${MAX}&q=${encodeURIComponent(term)}&callback=${cb}`;
          s.onerror = () => { done(); reject(new Error('blog injoignable')); };
          document.head.appendChild(s);
        });
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
    const list = items.slice(0, MAX).map((it) => `<li>
        <a class="elsewhere__item" href="${esc(it.url)}" target="_blank" rel="noopener">
          <span class="elsewhere__title">${esc(it.title)}<svg class="icon" aria-hidden="true"><use href="#i-external"/></svg></span>
          ${it.meta?.length ? `<span class="elsewhere__meta">${it.meta.map(esc).join(' · ')}</span>` : ''}
          ${it.sub ? `<span class="elsewhere__sub">${esc(it.sub)}</span>` : ''}
        </a></li>`).join('');
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
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { active = null; render(); tabsBox.querySelector('[data-src]')?.focus(); }
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
