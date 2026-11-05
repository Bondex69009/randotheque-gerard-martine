/* Randothèque – « Survol 3D » : rejoue la trace en vol au-dessus du relief (MapLibre GL, chargé à la demande).
   Caméra embarquée lissée, trace qui se dessine, bornes kilométriques et profil d'étape façon Tour de France. */
(() => {
  'use strict';
  const ML = window.maplibregl;
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cssVar = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmtDur = (min) => { const m = Math.round(min); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };

  // Fonds de carte (sans clé) et relief (tuiles Terrarium d'AWS Open Data)
  const IGN = (layer, fmt) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${fmt}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
  const IGN_ATTR = '© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a>';
  const BASES = {
    photo: (fr) => fr
      ? { tiles: [IGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg')], maxzoom: 19, attribution: IGN_ATTR }
      : { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics' },
    plan: (fr) => fr
      ? { tiles: [IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png')], maxzoom: 19, attribution: IGN_ATTR }
      : { tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), maxzoom: 17, attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)' },
  };
  const DEM = {
    type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    attribution: 'Relief : <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrain Tiles</a>',
  };

  // Couleurs de pente, du plat au très raide (montée) ; descente à part
  const SLOPES = [
    { max: 5, color: '#7cc84a', label: '< 5 %' },
    { max: 10, color: '#f6d32d', label: '5-10 %' },
    { max: 15, color: '#f59e0b', label: '10-15 %' },
    { max: 20, color: '#e5452f', label: '15-20 %' },
    { max: Infinity, color: '#8b1a1a', label: '> 20 %' },
  ];
  const DESCENT = '#5f7f95';
  const slopeColor = (g) => (g < -2 ? DESCENT : (SLOPES.find((s) => g < s.max) || SLOPES[SLOPES.length - 1]).color);

  // ---------------------------------------------------------------- Préparation de la trace
  function prepare(track, dplusRef) {
    const raw = track.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[3]));
    let lastEle = raw.find((p) => p[2] != null)?.[2] ?? 0;
    for (const p of raw) { if (p[2] == null) p[2] = lastEle; else lastEle = p[2]; }
    const total = raw[raw.length - 1][3];
    // Rééchantillonnage régulier : interpolation simple et animation sans à-coups
    const step = Math.max(0.01, total / 3000);
    const n = Math.max(2, Math.ceil(total / step) + 1);
    const lon = new Float64Array(n), lat = new Float64Array(n), ele = new Float64Array(n), km = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.min(total, i * step);
      while (j < raw.length - 2 && raw[j + 1][3] < d) j++;
      const a = raw[j], b = raw[j + 1] || a;
      const t = b[3] > a[3] ? clamp((d - a[3]) / (b[3] - a[3]), 0, 1) : 0;
      lat[i] = a[0] + (b[0] - a[0]) * t; lon[i] = a[1] + (b[1] - a[1]) * t;
      ele[i] = a[2] + (b[2] - a[2]) * t; km[i] = d;
    }
    // Lissage léger des altitudes (fenêtre de ~60 m) pour les pentes et le dénivelé
    const w = Math.max(1, Math.round(0.03 / step));
    const sm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) { s += ele[k]; c++; }
      sm[i] = s / c;
    }
    // Dénivelé positif cumulé (avec seuil), recalé sur la valeur de la fiche
    const up = new Float64Array(n);
    let ref = sm[0], acc = 0;
    for (let i = 1; i < n; i++) {
      if (sm[i] - ref >= 3) { acc += sm[i] - ref; ref = sm[i]; } else if (sm[i] < ref) ref = sm[i];
      up[i] = acc;
    }
    if (dplusRef && acc > 0) { const k = dplusRef / acc; for (let i = 0; i < n; i++) up[i] *= k; }
    return { lon, lat, ele, sm, up, km, n, step, total };
  }

  function sampler(T) {
    const idx = (d) => clamp(d / T.step, 0, T.n - 1);
    const lerp = (arr, d) => { const f = idx(d), i = Math.floor(f), t = f - i; return i >= T.n - 1 ? arr[T.n - 1] : arr[i] + (arr[i + 1] - arr[i]) * t; };
    return {
      pos: (d) => [lerp(T.lon, d), lerp(T.lat, d)],
      ele: (d) => lerp(T.ele, d),
      sm: (d) => lerp(T.sm, d),
      up: (d) => lerp(T.up, d),
      grade: (d) => { const a = clamp(d - 0.1, 0, T.total), b = clamp(d + 0.1, 0, T.total); return b > a ? ((lerp(T.sm, b) - lerp(T.sm, a)) / ((b - a) * 1000)) * 100 : 0; },
      coordsTo: (d) => {
        const end = Math.floor(idx(d)), out = [];
        for (let i = 0; i <= end; i++) out.push([T.lon[i], T.lat[i]]);
        out.push([lerp(T.lon, d), lerp(T.lat, d)]);
        return out;
      },
    };
  }
  const bearingOf = (a, b) => {
    const k = Math.cos((a[1] * Math.PI) / 180);
    return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
  };
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180;

  // ---------------------------------------------------------------- Interface
  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
    replay: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    cam: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
  };

  function shellHtml(o) {
    return `
      <div class="fo__map" id="fo-map" role="region" aria-label="Carte en relief du parcours"></div>
      <div class="fo__loading" id="fo-loading"><span class="fo__spinner" aria-hidden="true"></span>Chargement du relief…</div>
      <header class="fo__top">
        <div class="fo__card fo__title">
          <p class="fo__eyebrow">Survol 3D</p>
          <h2 class="fo__name" id="fo-title">${esc(o.title)}</h2>
          ${o.place ? `<p class="fo__place">${esc(o.place)}</p>` : ''}
        </div>
        <button type="button" class="fo__btn fo__btn--round" data-fo="close" aria-label="Fermer le survol 3D">${ICON.close}</button>
      </header>
      <dl class="fo__hud fo__card" aria-live="off">
        <div><dt>Distance</dt><dd><b id="fo-d">0,0</b> <small><span class="fo__of">/ ${nf1.format(o.total)}</span> km</small></dd></div>
        <div><dt>Altitude</dt><dd><b id="fo-e">–</b> <small>m</small></dd></div>
        <div><dt>Dénivelé +</dt><dd><b id="fo-u">0</b> <small>m</small></dd></div>
        <div><dt>Pente</dt><dd><b id="fo-g">0</b> <small>%</small></dd></div>
        ${o.durationMin ? `<div class="fo__hud-time"><dt>Temps de marche</dt><dd><b id="fo-t">0 min</b></dd></div>` : ''}
      </dl>
      <div class="fo__bottom">
        <div class="fo__bar">
          <button type="button" class="fo__btn fo__btn--play" data-fo="play" aria-label="Lecture">${ICON.play}</button>
          <button type="button" class="fo__btn fo__btn--round" data-fo="replay" aria-label="Recommencer depuis le départ" title="Recommencer">${ICON.replay}</button>
          <div class="fo__speed" role="group" aria-label="Vitesse de l'animation">
            ${[0.5, 1, 2, 4].map((s) => `<button type="button" class="fo__chip" data-speed="${s}" aria-pressed="${s === 1}">×${String(s).replace('.', ',')}</button>`).join('')}
          </div>
          <span class="fo__spacer"></span>
          <button type="button" class="fo__btn fo__btn--pill" data-fo="follow" hidden>${ICON.cam}<span>Suivre la trace</span></button>
          <button type="button" class="fo__btn fo__btn--pill" data-fo="base" aria-label="Changer de fond de carte">${ICON.layers}<span id="fo-base-label">Carte</span></button>
        </div>
        <div class="fo__profile" id="fo-profile" role="slider" tabindex="0" aria-label="Position sur le profil de l'étape"
             aria-valuemin="0" aria-valuemax="${o.total.toFixed(1)}" aria-valuenow="0" aria-valuetext="0 km"></div>
        <ul class="fo__legend" aria-label="Légende des pentes">
          ${SLOPES.map((s) => `<li><i style="background:${s.color}"></i>${s.label}</li>`).join('')}<li><i style="background:${DESCENT}"></i>Descente</li>
        </ul>
      </div>`;
  }

  // ---------------------------------------------------------------- Profil d'étape (SVG)
  function profileView(box, T, S, onSeek) {
    let W = 0, H = 0, x, y, mask, cur, dot, lastD = 0;
    const seg = T.total <= 6 ? 0.5 : T.total <= 30 ? 1 : T.total <= 60 ? 2 : 5;
    function render() {
      W = Math.round(box.clientWidth); H = Math.round(box.clientHeight);
      if (W < 50 || H < 40) return;
      const L = 38, R = 10, TOP = 22, B = 18;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < T.n; i++) { lo = Math.min(lo, T.ele[i]); hi = Math.max(hi, T.ele[i]); }
      const pad = Math.max(15, (hi - lo) * 0.12);
      const min = Math.floor((lo - pad) / 10) * 10, max = Math.ceil((hi + pad * 0.5) / 10) * 10;
      x = (d) => L + (d / T.total) * (W - L - R);
      y = (e) => TOP + (1 - (e - min) / (max - min)) * (H - TOP - B);
      const base = H - B;
      const every = Math.max(1, Math.round(T.n / (W * 1.5)));
      const ptsBetween = (a, b) => {
        const out = [`${x(a).toFixed(1)},${y(S.ele(a)).toFixed(1)}`];
        for (let i = Math.ceil(a / T.step); i * T.step < b; i += every) out.push(`${x(T.km[i]).toFixed(1)},${y(T.ele[i]).toFixed(1)}`);
        out.push(`${x(b).toFixed(1)},${y(S.ele(b)).toFixed(1)}`);
        return out;
      };
      let bars = '', labels = '';
      for (let a = 0; a < T.total - 1e-6; a += seg) {
        const b = Math.min(T.total, a + seg);
        const g = ((S.sm(b) - S.sm(a)) / ((b - a) * 1000)) * 100;
        const p = ptsBetween(a, b);
        bars += `<polygon points="${x(a).toFixed(1)},${base} ${p.join(' ')} ${x(b).toFixed(1)},${base}" fill="${slopeColor(g)}"/>`;
        if (x(b) - x(a) >= 24 && Math.abs(g) >= 2) labels += `<text class="fo-p-pct" x="${((x(a) + x(b)) / 2).toFixed(1)}" y="${base - 5}" text-anchor="middle">${g > 0 ? '' : '−'}${nf0.format(Math.abs(g))}</text>`;
      }
      const line = `M${ptsBetween(0, T.total).join('L')}`;
      const kStep = (() => { const target = (W - L - R) / 46; for (const s of [0.5, 1, 2, 5, 10, 20]) if (T.total / s <= target) return s; return 50; })();
      let ticks = '';
      for (let k = 0; k <= T.total + 1e-6; k += kStep) ticks += `<line class="fo-p-tick" x1="${x(k)}" x2="${x(k)}" y1="${base}" y2="${base + 4}"/><text class="fo-p-axis" x="${x(k)}" y="${H - 3}" text-anchor="middle">${Number.isInteger(+k.toFixed(6)) ? Math.round(k) : nf1.format(k)}</text>`;
      // Point culminant et altitudes de départ / arrivée
      let top = 0;
      for (let i = 1; i < T.n; i++) if (T.ele[i] > T.ele[top]) top = i;
      const tx = clamp(x(T.km[top]), L + 30, W - R - 30);
      const summit = `<path class="fo-p-summit" d="M${x(T.km[top])},${y(T.ele[top]) - 4}l-4,-7h8z"/><text class="fo-p-alt" x="${tx}" y="${Math.max(10, y(T.ele[top]) - 13)}" text-anchor="middle">${nf0.format(T.ele[top])} m</text>`;
      box.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
          <line class="fo-p-grid" x1="${L}" x2="${W - R}" y1="${y(min + (max - min) / 2)}" y2="${y(min + (max - min) / 2)}"/>
          <text class="fo-p-axis" x="${L - 5}" y="${y(max) + 9}" text-anchor="end">${nf0.format(max)}</text>
          <text class="fo-p-axis" x="${L - 5}" y="${base}" text-anchor="end">${nf0.format(min)}</text>
          <g>${bars}</g>
          <path class="fo-p-line" d="${line}"/>
          <g>${labels}</g>
          ${summit}
          <line class="fo-p-base" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>
          ${ticks}
          <rect class="fo-p-mask" id="fo-mask" x="${L}" y="0" width="${W - L - R}" height="${base}"/>
          <line class="fo-p-cur" id="fo-cur" x1="${L}" x2="${L}" y1="${TOP - 6}" y2="${base}"/>
          <circle class="fo-p-dot" id="fo-dot" cx="${L}" cy="${y(T.ele[0])}" r="5"/>
        </svg>`;
      mask = box.querySelector('#fo-mask'); cur = box.querySelector('#fo-cur'); dot = box.querySelector('#fo-dot');
      box._L = L; box._R = R;
      set(lastD);
    }
    function set(d) {
      lastD = d;
      if (!mask) return;
      const px = x(d);
      mask.setAttribute('x', px.toFixed(1)); mask.setAttribute('width', Math.max(0, W - box._R - px).toFixed(1));
      cur.setAttribute('x1', px.toFixed(1)); cur.setAttribute('x2', px.toFixed(1));
      dot.setAttribute('cx', px.toFixed(1)); dot.setAttribute('cy', y(S.ele(d)).toFixed(1));
    }
    const toKm = (clientX) => {
      const r = box.getBoundingClientRect();
      return clamp(((clientX - r.left - box._L) / (r.width - box._L - box._R)) * T.total, 0, T.total);
    };
    let dragging = false;
    box.addEventListener('pointerdown', (e) => { dragging = true; box.setPointerCapture(e.pointerId); onSeek(toKm(e.clientX), true); });
    box.addEventListener('pointermove', (e) => { if (dragging) onSeek(toKm(e.clientX), true); });
    const stop = () => { if (dragging) { dragging = false; onSeek(null, false); } };
    box.addEventListener('pointerup', stop);
    box.addEventListener('pointercancel', stop);
    const ro = new ResizeObserver(() => { render(); });
    ro.observe(box);
    render();
    return { set, render, destroy: () => ro.disconnect() };
  }

  // ---------------------------------------------------------------- Lecteur
  function open(o) {
    if (!ML) throw new Error('MapLibre indisponible');
    const T = prepare(o.track.map((p) => p.slice()), o.dplus);
    const S = sampler(T);
    const total = T.total;
    const fr = o.inFrance;
    const color = o.color || cssVar('--c-accent', '#87f700');
    const bgColor = cssVar('--c-bg', '#0b0f0a');

    const dlg = document.createElement('dialog');
    dlg.className = 'fo';
    dlg.setAttribute('aria-labelledby', 'fo-title');
    dlg.innerHTML = shellHtml({ ...o, total });
    document.body.appendChild(dlg);
    dlg.showModal();
    const $ = (s) => dlg.querySelector(s);

    // Rythme : environ 20 s + 2,5 s par km, entre 25 et 75 s en vitesse ×1
    const baseDuration = clamp(20 + total * 2.5, 25, 75);
    const zoom = clamp(15.6 - Math.log2(Math.max(total, 1) / 4) * 0.45, 13.3, 15.6);
    const pitch = 62;
    const look = clamp(total * 0.04, 0.15, 0.6);
    const lineCoords = Array.from({ length: T.n }, (_, i) => [T.lon[i], T.lat[i]]);
    const bounds = lineCoords.reduce((b, c) => b.extend(c), new ML.LngLatBounds(lineCoords[0], lineCoords[0]));

    let base = 'photo';
    let map;
    try {
      map = new ML.Map({
        container: $('#fo-map'),
        style: {
          version: 8,
          sources: {
            base: { type: 'raster', tileSize: 256, ...BASES.photo(fr) },
            dem: DEM,
            hs: (({ attribution, ...rest }) => rest)(DEM),
            route: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: lineCoords } } },
            done: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [lineCoords[0], lineCoords[0]] } } },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': bgColor } },
            { id: 'base', type: 'raster', source: 'base', paint: { 'raster-fade-duration': 200 } },
            { id: 'hs', type: 'hillshade', source: 'hs', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': 'rgba(0,0,0,0.55)', 'hillshade-highlight-color': 'rgba(255,255,255,0.15)' } },
            { id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-opacity': 0.35, 'line-width': 6 } },
            { id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': 2.5, 'line-dasharray': [1.5, 1.5] } },
            { id: 'done-glow', type: 'line', source: 'done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-opacity': 0.45, 'line-width': 14, 'line-blur': 8 } },
            { id: 'done-casing', type: 'line', source: 'done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': bgColor, 'line-width': 7.5 } },
            { id: 'done', type: 'line', source: 'done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 5 } },
          ],
          terrain: { source: 'dem', exaggeration: 1.5 },
          sky: {
            'sky-color': '#5b9bd5', 'horizon-color': '#d8e6f2', 'fog-color': '#c9d6e3',
            'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.25, 'atmosphere-blend': 0.8,
          },
        },
        bounds, fitBoundsOptions: { padding: 60 },
        pitch: 40, maxPitch: 80,
        keyboard: false, attributionControl: { compact: true },
        fadeDuration: 150,
      });
    } catch (e) {
      $('#fo-loading').innerHTML = 'Le survol 3D nécessite WebGL, indisponible sur cet appareil.';
      dlg.addEventListener('close', () => dlg.remove(), { once: true });
      return;
    }
    map.addControl(new ML.NavigationControl({ visualizePitch: true, showZoom: true }), 'top-right');

    // Bornes kilométriques, départ, arrivée, randonneur
    const mk = (html, cls, at, anchor = 'bottom') => {
      const el = document.createElement('div'); el.className = cls; el.innerHTML = html;
      return new ML.Marker({ element: el, anchor }).setLngLat(at).addTo(map);
    };
    const kmEvery = total <= 25 ? 1 : total <= 60 ? 2 : 5;
    const bornes = [];
    for (let k = kmEvery; k < total - kmEvery * 0.35; k += kmEvery) {
      const m = mk(`<span class="fo-borne__cap"></span><span class="fo-borne__num">${k}</span>`, 'fo-borne', S.pos(k));
      m.getElement().setAttribute('aria-label', `Borne du kilomètre ${k}`);
      bornes.push({ k, el: m.getElement(), on: false });
    }
    mk('<span>D</span>', 'fo-flag fo-flag--start', S.pos(0)).getElement().title = 'Départ';
    if (!o.loop) mk('<span>A</span>', 'fo-flag fo-flag--end', S.pos(total)).getElement().title = 'Arrivée';
    const walker = mk('<span class="fo-walker__pulse"></span><span class="fo-walker__dot"></span>', 'fo-walker', S.pos(0), 'center');
    walker.getElement().style.setProperty('--fo-c', color);

    // État de lecture
    let d = 0, speed = 1, playing = false, phase = 'intro', follow = true, raf = 0, last = 0, hudAt = 0;
    let cam = { c: S.pos(0), b: bearingOf(S.pos(0), S.pos(look)) };
    const playBtn = $('[data-fo="play"]'), followBtn = $('[data-fo="follow"]');
    const setPlayUi = () => { playBtn.innerHTML = playing ? ICON.pause : ICON.play; playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Lecture'); };

    const profile = profileView($('#fo-profile'), T, S, (km, active) => {
      if (km == null) return;
      seek(km);
    });
    const padBottom = () => {
      const h = Math.round($('.fo__bottom').getBoundingClientRect().height);
      dlg.style.setProperty('--fo-bottom-h', `${h}px`);
      const hud = matchMedia('(max-width: 640px)').matches ? $('.fo__hud').getBoundingClientRect().height + 8 : 0;
      return Math.round(h * 0.85 + hud);
    };

    function camTarget(dd) {
      const here = S.pos(dd);
      const b = bearingOf(S.pos(Math.max(0, dd - look * 0.3)), S.pos(Math.min(total, dd + look)));
      return { here, b };
    }
    function updateHud(force) {
      const now = performance.now();
      if (!force && now - hudAt < 90) return;
      hudAt = now;
      $('#fo-d').textContent = nf1.format(d);
      $('#fo-e').textContent = nf0.format(S.ele(d));
      $('#fo-u').textContent = nf0.format(S.up(d));
      const g = S.grade(d);
      $('#fo-g').textContent = `${g < -0.5 ? '−' : ''}${nf0.format(Math.abs(g))}`;
      $('#fo-g').style.color = Math.abs(g) < 0.5 ? '' : slopeColor(g);
      if (o.durationMin) $('#fo-t').textContent = fmtDur((o.durationMin * d) / total);
      const pr = $('#fo-profile');
      pr.setAttribute('aria-valuenow', d.toFixed(1));
      pr.setAttribute('aria-valuetext', `${nf1.format(d)} km, ${nf0.format(S.ele(d))} m d'altitude`);
    }
    function draw(force) {
      map.getSource('done')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: S.coordsTo(Math.max(d, 1e-4)) } });
      walker.setLngLat(S.pos(d));
      profile.set(d);
      for (const b of bornes) {
        const on = d >= b.k;
        if (on !== b.on) { b.on = on; b.el.classList.toggle('is-on', on); }
      }
      updateHud(force);
    }
    function placeCamera(dt, snap) {
      if (!follow) return;
      const t = camTarget(d);
      if (snap) cam = { c: t.here, b: t.b };
      else {
        const kc = 1 - Math.exp(-dt * 4), kb = 1 - Math.exp(-dt * 1.3);
        cam.c = [cam.c[0] + (t.here[0] - cam.c[0]) * kc, cam.c[1] + (t.here[1] - cam.c[1]) * kc];
        cam.b += angDiff(cam.b, t.b) * kb;
      }
      map.jumpTo({ center: cam.c, bearing: cam.b, zoom, pitch });
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      if (phase === 'run' && playing) {
        d = Math.min(total, d + (dt * total * speed) / baseDuration);
        draw();
        placeCamera(dt);
        if (d >= total) finish();
      } else if (phase === 'done' && playing && !map.isMoving()) {
        map.setBearing(map.getBearing() + dt * 6); // lent tour d'horizon final
      }
    }
    function finish() {
      phase = 'outro';
      updateHud(true);
      map.fitBounds(bounds, { padding: { top: 90, left: 50, right: 50, bottom: padBottom() + 20 }, pitch: 55, bearing: cam.b, duration: reduceMotion() ? 0 : 3500, essential: true });
      map.once('moveend', () => { if (phase === 'outro') phase = 'done'; });
    }
    function startRun() {
      phase = 'run'; follow = true; followBtn.hidden = true;
      placeCamera(0, true);
    }
    function intro() {
      const t = camTarget(0);
      cam = { c: t.here, b: t.b };
      if (reduceMotion()) { startRun(); playing = false; setPlayUi(); draw(true); return; }
      phase = 'intro';
      map.flyTo({ center: t.here, bearing: t.b, zoom, pitch, duration: 3200, curve: 1.3, essential: true });
      map.once('moveend', () => { if (phase === 'intro') startRun(); });
    }
    function seek(km) {
      map.stop();
      d = clamp(km, 0, total);
      if (phase !== 'run') { phase = 'run'; }
      if (d >= total) { draw(true); finish(); return; }
      draw(true);
      if (follow) placeCamera(0, true);
    }
    function toggle() {
      if (phase === 'done' || (phase === 'outro')) { if (d >= total) { replay(); return; } }
      playing = !playing; setPlayUi();
      if (playing && phase === 'run' && follow) placeCamera(0, true);
    }
    function replay() {
      map.stop();
      d = 0; draw(true);
      follow = true; followBtn.hidden = true;
      playing = true; setPlayUi();
      intro();
    }

    // Interactions
    map.on('movestart', (e) => {
      if (!e.originalEvent) return;
      if (phase === 'run' || phase === 'intro') { follow = false; followBtn.hidden = false; if (phase === 'intro') { map.stop(); phase = 'run'; } }
      if (phase === 'done') { playing = false; setPlayUi(); }
    });
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fo], [data-speed]');
      if (!b) return;
      if (b.dataset.speed) {
        speed = Number(b.dataset.speed);
        dlg.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        return;
      }
      const a = b.dataset.fo;
      if (a === 'close') dlg.close();
      else if (a === 'play') toggle();
      else if (a === 'replay') replay();
      else if (a === 'follow') { follow = true; followBtn.hidden = true; map.stop(); const t = camTarget(d); map.easeTo({ center: t.here, bearing: t.b, zoom, pitch, duration: 900 }); cam = { c: t.here, b: t.b }; }
      else if (a === 'base') {
        base = base === 'photo' ? 'plan' : 'photo';
        map.removeLayer('base'); map.removeSource('base');
        map.addSource('base', { type: 'raster', tileSize: 256, ...BASES[base](fr) });
        map.addLayer({ id: 'base', type: 'raster', source: 'base' }, 'hs');
        $('#fo-base-label').textContent = base === 'photo' ? 'Carte' : 'Satellite';
      }
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); toggle(); }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.target.closest('.maplibregl-canvas')) {
        e.preventDefault(); seek(d + (e.key === 'ArrowRight' ? 1 : -1) * Math.max(0.1, total * 0.02));
      }
    });

    map.on('load', () => {
      $('#fo-loading').hidden = true;
      map.setPadding({ top: 40, bottom: padBottom(), left: 0, right: 0 });
      draw(true);
      playing = !reduceMotion();
      setPlayUi();
      setTimeout(intro, 500);
      raf = requestAnimationFrame(frame);
    });
    map.on('error', (e) => { if (!map.loaded() && /style|webgl/i.test(String(e.error?.message))) $('#fo-loading').textContent = 'Carte 3D indisponible.'; });
    const onResize = () => map.setPadding({ top: 40, bottom: padBottom(), left: 0, right: 0 });
    window.addEventListener('resize', onResize);

    dlg.addEventListener('close', () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      profile.destroy();
      map.remove();
      dlg.remove();
      o.onClose && o.onClose();
    }, { once: true });
  }

  window.RTFlyover = { open };
})();
