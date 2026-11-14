/* Randothèque – « Partager la rando » : image (PNG) ou vidéo animée (MP4/WebM) d'une rando,
   personnalisable (format, fond de carte ou photo, couleur de la trace, données affichées), puis partage
   vers les applis du téléphone (feuille de partage native), WhatsApp, Facebook, X, Telegram, e-mail…
   Module commun aux deux randothèques : tout ce qui est propre au site arrive dans `site` (voir RTShare.open). */
(() => {
  'use strict';

  // ------------------------------------------------------------ Outils
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtDur = (min) => { const m = Math.round(min || 0); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
  const fmtDate = (d) => { try { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T12:00:00`)); } catch { return d || ''; } };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const slug = (s) => String(s || 'rando').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('rt-share') || '{}'); } catch { return {}; } },
    set(v) { try { localStorage.setItem('rt-share', JSON.stringify(v)); } catch { /* navigation privée */ } },
  };
  const ICON = {
    close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    share: '<path d="M12 3v12m0-12-4 4m4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" stroke-width="2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 10 5-3v10l-5-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    image: '<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9.5" cy="9.5" r="1.5" fill="currentColor"/><path d="m5 18 5-5 3 3 2-2 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    upload: '<path d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    whatsapp: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.8 8.2c.2-.5.5-.5.8-.5h.5c.2 0 .4 0 .6.5l.7 1.6c.1.2.1.4 0 .6l-.5.7c-.1.2-.1.4 0 .5.6 1 1.4 1.8 2.4 2.3.2.1.4.1.5 0l.7-.8c.2-.2.4-.2.6-.1l1.6.8c.2.1.3.3.3.5 0 .7-.6 1.6-1.4 1.8-.8.2-1.8 0-3.2-.7-1.7-.9-3-2.4-3.6-3.6-.6-1.1-.6-2.1-.1-3.4Z" fill="currentColor"/>',
    facebook: '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v7h4v-7h3l1-4h-4V8.5c0-.3.2-.5.5-.5Z" fill="currentColor"/>',
    x: '<path d="M4 4h4.5l11.5 16h-4.5ZM19.5 4 13.6 10.6M4.5 20l5.9-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    telegram: '<path d="m3 11 17-7-3 16-5.5-4.5L9 18l-.5-5L18 7l-11.5 6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    sms: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  };
  const svg = (id, cls = 'sh-icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[id]}</svg>`;

  // ------------------------------------------------------------ Réglages proposés
  const FORMATS = {
    story: { label: 'Story', hint: '9:16', w: 1080, h: 1920 },
    portrait: { label: 'Portrait', hint: '4:5', w: 1080, h: 1350 },
    carre: { label: 'Carré', hint: '1:1', w: 1080, h: 1080 },
    paysage: { label: 'Paysage', hint: '16:9', w: 1920, h: 1080 },
  };
  const IGN = (layer, fmt) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${fmt}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
  // Fonds de carte sans clé, qui autorisent le dessin sur canvas (en-tête CORS « * »)
  const MAPS = {
    plan: { label: 'Carte IGN', url: (fr) => (fr ? IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png') : 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'), max: (fr) => (fr ? 18 : 17), attr: (fr) => (fr ? '© IGN' : '© OpenStreetMap · OpenTopoMap') },
    topo: { label: 'Topo', url: () => 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', max: () => 17, attr: () => '© OpenStreetMap · OpenTopoMap' },
    photo: { label: 'Satellite', url: (fr) => (fr ? IGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg') : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'), max: () => 18, attr: (fr) => (fr ? '© IGN' : '© Esri, Maxar') },
    sombre: { label: 'Nuit', url: () => 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', max: () => 16, attr: () => '© Esri, HERE, OpenStreetMap' },
    clair: { label: 'Épuré', url: () => 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', max: () => 16, attr: () => '© Esri, HERE, OpenStreetMap' },
  };
  const GRADIENTS = {
    crepuscule: ['#2a1f4d', '#7a3b5e', '#ff9a5c'],
    foret: ['#0b2318', '#1f4d36', '#7fb069'],
    ocean: ['#071a2f', '#0f4c75', '#3fc1c9'],
    aube: ['#ffecd2', '#fcb69f', '#ff8a80'],
    nuit: ['#05060b', '#141a2e', '#2c3e64'],
  };
  const TRACK_COLORS = ['level', 'accent', '#fc5200', '#ffffff', '#ffd400', '#00e5ff', '#ff3b6b', '#111111'];
  const STATS = {
    distance: 'Distance', dplus: 'Dénivelé +', dminus: 'Dénivelé −', duree: 'Durée', ibp: 'IBP index', altmax: 'Altitude max',
  };
  const SHOW = { title: 'Nom', date: 'Date', place: 'Lieu', profile: 'Profil', brand: 'Signature', markers: 'Départ / arrivée' };
  const DEFAULTS = {
    mode: 'image', format: 'story', bg: 'plan', gradient: 'crepuscule', solid: '#0d1322', dim: 25,
    trackColor: 'level', customColor: '#fc5200', width: 10, glow: true, slope: false,
    stats: ['distance', 'dplus', 'duree', 'ibp'], show: ['title', 'date', 'place', 'profile', 'brand', 'markers'],
    seconds: 10, textTheme: 'auto',
  };
  // Pente : du plat au très raide (montée), descente à part
  const SLOPES = [[5, '#7cc84a'], [10, '#f6d32d'], [15, '#f59e0b'], [20, '#e5452f'], [Infinity, '#8b1a1a']];
  const slopeColor = (g) => (g < -2 ? '#5f9fd0' : SLOPES.find(([max]) => g < max)[1]);

  // ------------------------------------------------------------ Projection (Web Mercator, unités « monde » de 256 px au zoom 0)
  const mx = (lon) => ((lon + 180) / 360) * 256;
  const my = (lat) => { const s = Math.sin((clamp(lat, -85, 85) * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256; };

  // ------------------------------------------------------------ État
  let dlg = null, ctx = null, canvas = null;
  let R = null, TRACK = null, SITE = null;
  let opts = null;
  let bgCanvas = null, bgKey = '', bgAttr = '';
  let userPhoto = null, blogPhoto = null;
  let geo = null; // trace projetée + profil
  let anim = null; // aperçu animé en cours
  let lastBlob = null, lastKind = null; // dernier fichier créé (image ou vidéo)
  let renderToken = 0;

  // ------------------------------------------------------------ Préparation de la trace
  function prepareTrack(track) {
    const pts = track.filter((p) => p && p[0] != null && p[1] != null);
    const P = pts.map((p) => ({ x: mx(p[1]), y: my(p[0]), ele: p[2], d: p[3] }));
    const total = P[P.length - 1].d || 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    // Pente lissée sur ~150 m pour la couleur « selon la pente »
    const grade = P.map((p, i) => {
      let j = i; while (j < P.length - 1 && P[j].d - p.d < 0.075) j++;
      let k = i; while (k > 0 && p.d - P[k].d < 0.075) k--;
      const dd = (P[j].d - P[k].d) * 1000;
      return dd > 20 && P[j].ele != null && P[k].ele != null ? ((P[j].ele - P[k].ele) / dd) * 100 : 0;
    });
    const eles = P.map((p) => p.ele).filter((e) => e != null);
    // Dénivelés cumulés le long de la trace (seuil de 3 m contre le bruit), pour les compteurs animés
    const up = [0], down = [0];
    let ref = P[0].ele;
    for (let i = 1; i < P.length; i++) {
      let u = up[i - 1], dn = down[i - 1];
      const e = P[i].ele;
      if (e != null && ref != null && Math.abs(e - ref) >= 3) { if (e > ref) u += e - ref; else dn += ref - e; ref = e; }
      else if (ref == null) ref = e;
      up.push(u); down.push(dn);
    }
    return { P, total, up, down, bbox: { x0, x1, y0, y1 }, grade, eMin: eles.length ? Math.min(...eles) : 0, eMax: eles.length ? Math.max(...eles) : 1, hasEle: eles.length > 1 };
  }

  // ------------------------------------------------------------ Mise en page selon le format
  function layout(W, H, o) {
    const land = W > H;
    const pad = Math.round(Math.min(W, H) * 0.065);
    const show = new Set(o.show);
    const nStats = o.stats.length;
    const tall = H / W > 1.5; // Story : chiffres sur 2 lignes ; Carré et Portrait : sur une ligne (jusqu'à 4)
    const cols = land ? Math.min(nStats, 3) : tall ? Math.min(nStats, nStats === 4 ? 2 : 3) : (nStats <= 4 ? nStats : 3);
    const rows = nStats ? Math.ceil(nStats / cols) : 0;
    const statH = Math.round(Math.min(W, H) * (land ? 0.12 : tall ? 0.13 : 0.12));
    const titleSize = Math.round(Math.min(W, H) * (land ? 0.058 : 0.068));
    const headH = (show.has('title') ? titleSize * 2.5 : 0) + (show.has('date') || show.has('place') ? titleSize * 0.75 : 0);
    const brandH = show.has('brand') ? Math.round(Math.min(W, H) * 0.06) : 0;
    const profH = show.has('profile') && geo && geo.hasEle ? Math.round(Math.min(W, H) * (land ? 0.11 : 0.12)) : 0;
    if (land) {
      // Trace à gauche (60 %), textes à droite
      const colX = Math.round(W * 0.58), colW = W - colX - pad;
      const track = { x: pad, y: pad, w: colX - pad * 1.6, h: H - pad * 2 };
      const head = { x: colX, y: pad, w: colW, h: headH };
      const statsBox = { x: colX, y: pad + headH + pad * 0.4, w: colW, h: rows * statH };
      const prof = { x: colX, y: statsBox.y + statsBox.h + pad * 0.5, w: colW, h: profH };
      const brand = { x: colX, y: H - pad - brandH, w: colW, h: brandH };
      return { W, H, pad, land, track, head, statsBox, prof, brand, cols, rows, statH, titleSize, panelTop: 0, panelLeft: colX - pad };
    }
    const head = { x: pad, y: pad, w: W - pad * 2, h: headH };
    const brand = { x: pad, y: H - pad - brandH, w: W - pad * 2, h: brandH };
    const statsBox = { x: pad, y: brand.y - (brandH ? pad * 0.5 : 0) - rows * statH, w: W - pad * 2, h: rows * statH };
    const prof = { x: pad, y: statsBox.y - pad * 0.4 - profH, w: W - pad * 2, h: profH };
    const top = head.y + head.h + pad * 0.5;
    const bottom = (profH ? prof.y : statsBox.y) - pad * 0.6;
    const track = { x: pad, y: top, w: W - pad * 2, h: Math.max(H * 0.2, bottom - top) };
    return { W, H, pad, land, track, head, statsBox, prof, brand, cols, rows, statH, titleSize, panelTop: prof.h ? prof.y - pad : statsBox.y - pad, panelLeft: 0 };
  }

  // Passage coordonnées « monde » → pixels du visuel : la trace remplit sa zone, centrée
  function viewFor(L) {
    const { bbox } = geo;
    const bw = Math.max(bbox.x1 - bbox.x0, 1e-6), bh = Math.max(bbox.y1 - bbox.y0, 1e-6);
    const k = Math.min(L.track.w / bw, L.track.h / bh) * 0.92;
    const cx = (bbox.x0 + bbox.x1) / 2, cy = (bbox.y0 + bbox.y1) / 2;
    const ox = L.track.x + L.track.w / 2, oy = L.track.y + L.track.h / 2;
    return { k, cx, cy, ox, oy, X: (x) => (x - cx) * k + ox, Y: (y) => (y - cy) * k + oy };
  }

  // ------------------------------------------------------------ Fond
  // Chargement d'une image utilisable sur canvas, abandonné au bout de `ms` (une tuile qui ne répond pas ne bloque rien)
  const loadImg = (src, ms = 9000) => new Promise((res, rej) => {
    const im = new Image();
    const timer = setTimeout(() => { im.src = ''; rej(new Error(`délai dépassé : ${src}`)); }, ms);
    im.crossOrigin = 'anonymous';
    im.onload = () => { clearTimeout(timer); res(im); };
    im.onerror = () => { clearTimeout(timer); rej(new Error(`image indisponible : ${src}`)); };
    im.src = src;
  });

  async function drawMapBg(c, L, V, kind) {
    const fr = !!R.region;
    const def = MAPS[kind];
    const maxZ = def.max(fr);
    const zf = Math.log2(V.k);
    let z = clamp(Math.ceil(zf), 1, maxZ);
    const tilesFor = (zz) => {
      const n = 2 ** zz, size = 256 / n; // taille d'une tuile en unités monde
      const wx0 = V.cx + (0 - V.ox) / V.k, wx1 = V.cx + (L.W - V.ox) / V.k;
      const wy0 = V.cy + (0 - V.oy) / V.k, wy1 = V.cy + (L.H - V.oy) / V.k;
      const list = [];
      for (let tx = Math.floor(wx0 / size); tx <= Math.floor(wx1 / size); tx++) {
        for (let ty = Math.floor(wy0 / size); ty <= Math.floor(wy1 / size); ty++) {
          if (ty < 0 || ty >= n) continue;
          list.push({ tx, ty, x: ((tx * size) - V.cx) * V.k + V.ox, y: ((ty * size) - V.cy) * V.k + V.oy, s: size * V.k, n });
        }
      }
      return list;
    };
    let tiles = tilesFor(z);
    if (tiles.length > 140 && z > 1) tiles = tilesFor(--z);
    const urlTpl = def.url(fr);
    const subs = def.sub || 'abc';
    const g = c.getContext('2d');
    g.fillStyle = kind === 'sombre' ? '#3a3a3a' : '#e8e6df';
    g.fillRect(0, 0, L.W, L.H);
    const urlOf = (zz, tx, ty, i) => {
      const n = 2 ** zz, x = ((tx % n) + n) % n;
      return urlTpl.replace('{s}', subs[i % subs.length]).replace('{z}', zz).replace('{x}', x).replace('{y}', ty);
    };
    const tryLoad = async (url) => {
      try { return await loadImg(url); } catch { await new Promise((r) => setTimeout(r, 400)); return loadImg(url); }
    };
    // 8 téléchargements à la fois (les serveurs de tuiles refusent les rafales), nouvel essai, sinon tuile parente agrandie
    let ok = 0, idx = 0;
    const worker = async () => {
      while (idx < tiles.length) {
        const i = idx++, t = tiles[i];
        try {
          const im = await tryLoad(urlOf(z, t.tx, t.ty, i));
          g.drawImage(im, Math.floor(t.x), Math.floor(t.y), Math.ceil(t.s) + 1, Math.ceil(t.s) + 1);
          ok++;
        } catch {
          try {
            const im = await loadImg(urlOf(z - 1, Math.floor(t.tx / 2), Math.floor(t.ty / 2), i));
            const qx = ((t.tx % 2) + 2) % 2, qy = t.ty % 2;
            g.drawImage(im, qx * 128, qy * 128, 128, 128, Math.floor(t.x), Math.floor(t.y), Math.ceil(t.s) + 1, Math.ceil(t.s) + 1);
            ok++;
          } catch { /* tuile manquante : fond uni */ }
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (!ok) throw new Error('fond de carte indisponible');
    bgAttr = def.attr(fr);
  }

  function drawCover(g, im, W, H) {
    const s = Math.max(W / im.width, H / im.height);
    const w = im.width * s, h = im.height * s;
    g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
  }

  async function blogImage() {
    if (blogPhoto) return blogPhoto;
    const src = R.blog && R.blog.image;
    if (!src) throw new Error('pas de photo');
    // Photo en grand (Blogger) servie par un relais d'images qui autorise son usage sur canvas
    const big = src.replace(/\/(?:w\d+-h\d+[^/]*|s\d+(?:-[^/]*)?)\/([^/]+)$/, '/s1920/$1');
    blogPhoto = await loadImg(`https://wsrv.nl/?url=${encodeURIComponent(big.replace(/^https?:\/\//, ''))}&w=1920&output=jpg`);
    return blogPhoto;
  }

  // Le fond ne dépend que du format, du type de fond et de la zone de la trace (donc des éléments affichés)
  const bgKeyFor = (L) => JSON.stringify([L.W, L.H, opts.bg, opts.gradient, opts.solid, L.track, opts.bg === 'perso' && userPhoto ? userPhoto.src : 0]);
  let bgInflight = null; // { key, promise } : un seul chargement à la fois pour un même fond
  function buildBackground(L, V) {
    const key = bgKeyFor(L);
    if (key === bgKey && bgCanvas) return Promise.resolve();
    if (bgInflight && bgInflight.key === key) return bgInflight.promise;
    const promise = buildBackgroundNow(L, V, key).finally(() => { if (bgInflight && bgInflight.promise === promise) bgInflight = null; });
    bgInflight = { key, promise };
    return promise;
  }
  async function buildBackgroundNow(L, V, key) {
    const c = document.createElement('canvas');
    c.width = L.W; c.height = L.H;
    const g = c.getContext('2d');
    bgAttr = '';
    if (MAPS[opts.bg]) {
      await drawMapBg(c, L, V, opts.bg);
    } else if (opts.bg === 'blog' || opts.bg === 'perso') {
      const im = opts.bg === 'perso' ? userPhoto : await blogImage();
      if (!im) throw new Error('pas de photo');
      drawCover(g, im, L.W, L.H);
    } else if (opts.bg === 'degrade') {
      const cols = GRADIENTS[opts.gradient] || GRADIENTS.crepuscule;
      const gr = g.createLinearGradient(0, 0, L.W * 0.3, L.H);
      cols.forEach((col, i) => gr.addColorStop(i / (cols.length - 1), col));
      g.fillStyle = gr; g.fillRect(0, 0, L.W, L.H);
    } else {
      g.fillStyle = opts.solid; g.fillRect(0, 0, L.W, L.H);
    }
    bgCanvas = c; bgKey = key;
  }

  // Couleur du texte : claire sur fond sombre, foncée sur fond clair (fond uni ou dégradé « aube »)
  function luminance(hex) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
    if (!m) return 0;
    const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function darkText() {
    if (opts.textTheme === 'clair') return false;
    if (opts.textTheme === 'fonce') return true;
    if (opts.bg === 'uni') return luminance(opts.solid) > 0.6;
    if (opts.bg === 'degrade') return opts.gradient === 'aube';
    return false;
  }
  // Couleur en #rrggbb (pour pouvoir y ajouter une transparence)
  const hex6 = (c) => { const m = /^#([\da-f])([\da-f])([\da-f])$/i.exec(c || ''); return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : (/^#[\da-f]{6}$/i.test(c || '') ? c : '#ffa45c'); };
  function trackColor() { return hex6(rawTrackColor()); }
  function rawTrackColor() {
    const c = opts.trackColor;
    if (c === 'level') return R.level === 'noir' ? (opts.bg === 'sombre' ? '#f4f4f0' : '#111111') : (SITE.levelColor(R.level) || SITE.accent);
    if (c === 'accent') return SITE.accent;
    if (c === 'custom') return opts.customColor;
    return c;
  }

  // ------------------------------------------------------------ Dessin d'une image (t = avancement de 0 à 1)
  function fitFont(g, str, weight, size, family, maxW) {
    let s = size;
    g.font = `${weight} ${s}px ${family}`;
    while (g.measureText(str).width > maxW && s > size * 0.45) { s -= 2; g.font = `${weight} ${s}px ${family}`; }
    return s;
  }
  function wrapTitle(g, str, weight, size, family, maxW, maxLines = 2) {
    g.font = `${weight} ${size}px ${family}`;
    const words = String(str).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (g.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const keep = lines.slice(0, maxLines);
      let last = keep[maxLines - 1];
      while (g.measureText(`${last}…`).width > maxW && last.length > 3) last = last.slice(0, -1);
      keep[maxLines - 1] = `${last.trim()}…`;
      return keep;
    }
    return lines;
  }
  function rrect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // Part du dénivelé (montée ou descente) déjà parcourue quand la trace en est à la fraction t
  function partOf(arr, t) {
    const P = geo.P, d = geo.total * t, last = arr[arr.length - 1];
    if (!last || t >= 1) return 1;
    let lo = 0, hi = P.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].d < d) lo = m + 1; else hi = m; }
    return arr[lo] / last;
  }
  function statValue(key, t) {
    const k = clamp(t, 0, 1); // les chiffres suivent l'avancée de la trace
    const r = R;
    switch (key) {
      case 'distance': return [nf1.format(r.distanceKm * k), 'km'];
      case 'dplus': return [nf0.format((r.dplus || 0) * (geo.hasEle ? partOf(geo.up, k) : k)), 'm'];
      case 'dminus': return [nf0.format((r.dminus || 0) * (geo.hasEle ? partOf(geo.down, k) : k)), 'm'];
      case 'duree': return [fmtDur((r.recorded && r.recorded.movingMin ? r.recorded.movingMin : r.durationMin) * k), ''];
      case 'ibp': return [r.ibp == null ? '–' : `${r.ibpEstimated ? '≈' : ''}${Math.round(r.ibp * k)}`, ''];
      case 'altmax': return [r.altMax == null ? '–' : nf0.format(r.altMax), 'm'];
      default: return ['', ''];
    }
  }
  function statLabel(key) {
    if (key === 'ibp' && R.level) return `IBP · ${SITE.levelLabel(R.level)}`;
    if (key === 'duree') return R.recorded && R.recorded.movingMin ? 'Temps en mouvement' : 'Durée estimée';
    return STATS[key];
  }

  function drawFrame(g, L, V, t, scale = 1) {
    const { W, H } = L;
    const dark = darkText();
    const ink = dark ? '#16181f' : '#ffffff';
    const inkSoft = dark ? 'rgba(22,24,31,0.68)' : 'rgba(255,255,255,0.78)';
    const show = new Set(opts.show);
    const isMap = !!MAPS[opts.bg];
    const isPhoto = opts.bg === 'blog' || opts.bg === 'perso';
    const color = trackColor();
    g.save();
    g.clearRect(0, 0, W, H);

    // Fond (léger zoom pendant l'animation, la trace suit le même mouvement)
    g.save();
    g.translate(W / 2, H / 2); g.scale(scale, scale); g.translate(-W / 2, -H / 2);
    if (bgCanvas) g.drawImage(bgCanvas, 0, 0);
    if ((isMap || isPhoto) && opts.dim > 0) { g.fillStyle = `rgba(6,9,18,${opts.dim / 100})`; g.fillRect(0, 0, W, H); }

    // Trace
    const P = geo.P;
    const lw = Math.max(3, opts.width * (Math.min(W, H) / 1080));
    const upto = geo.total * t;
    const pathTo = (limit) => {
      g.beginPath();
      let last = null;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        if (p.d > limit && i > 0) {
          const q = P[i - 1], f = (limit - q.d) / Math.max(p.d - q.d, 1e-9);
          last = [V.X(q.x + (p.x - q.x) * f), V.Y(q.y + (p.y - q.y) * f)];
          g.lineTo(last[0], last[1]);
          break;
        }
        last = [V.X(p.x), V.Y(p.y)];
        if (i === 0) g.moveTo(last[0], last[1]); else g.lineTo(last[0], last[1]);
      }
      return last;
    };
    g.lineJoin = 'round'; g.lineCap = 'round';
    // Liseré pour détacher la trace du fond
    const halo = color === '#111111' || (dark && !isMap && !isPhoto) ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)';
    if (t < 1) { // trace à venir, en pointillés discrets
      pathTo(geo.total); g.setLineDash([lw * 0.2, lw * 1.6]); g.strokeStyle = isMap || isPhoto ? 'rgba(255,255,255,0.75)' : inkSoft; g.lineWidth = lw * 0.45; g.stroke(); g.setLineDash([]);
    }
    let head = pathTo(upto);
    g.strokeStyle = halo; g.lineWidth = lw + Math.max(3, lw * 0.5); g.stroke();
    if (opts.glow) { g.save(); g.shadowColor = color; g.shadowBlur = lw * 2.2; }
    if (opts.slope && geo.hasEle) {
      // Couleur selon la pente : segment par segment
      g.lineWidth = lw;
      for (let i = 1; i < P.length && P[i - 1].d <= upto; i++) {
        const a = P[i - 1], b = P[i];
        const f = b.d > upto ? (upto - a.d) / Math.max(b.d - a.d, 1e-9) : 1;
        g.beginPath(); g.moveTo(V.X(a.x), V.Y(a.y)); g.lineTo(V.X(a.x + (b.x - a.x) * f), V.Y(a.y + (b.y - a.y) * f));
        g.strokeStyle = slopeColor(geo.grade[i]); g.stroke();
      }
    } else {
      head = pathTo(upto); g.strokeStyle = color; g.lineWidth = lw; g.stroke();
    }
    if (opts.glow) g.restore();

    // Départ, arrivée, tête de la trace
    const dot = (x, y, r, fill, stroke) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = r * 0.35; g.strokeStyle = stroke; g.stroke(); };
    if (show.has('markers')) {
      dot(V.X(P[0].x), V.Y(P[0].y), lw * 1.15, '#ffffff', '#1a8f4a');
      if (t >= 1 && !R.loop) dot(V.X(P[P.length - 1].x), V.Y(P[P.length - 1].y), lw * 1.15, '#ffffff', '#d23a3a');
    }
    if (t < 1 && head) {
      const pulse = 1 + 0.25 * Math.sin(performance.now() / 160);
      g.beginPath(); g.arc(head[0], head[1], lw * 2.2 * pulse, 0, Math.PI * 2); g.fillStyle = `${color}55`; g.fill();
      dot(head[0], head[1], lw * 1.1, color, '#ffffff');
    }
    g.restore(); // fin du zoom

    // Voiles de lisibilité (carte ou photo)
    if (isMap || isPhoto) {
      if (L.land) {
        const gr = g.createLinearGradient(L.panelLeft, 0, W, 0);
        gr.addColorStop(0, 'rgba(6,9,18,0)'); gr.addColorStop(0.18, 'rgba(6,9,18,0.72)'); gr.addColorStop(1, 'rgba(6,9,18,0.86)');
        g.fillStyle = gr; g.fillRect(L.panelLeft, 0, W - L.panelLeft, H);
      } else {
        const top = g.createLinearGradient(0, 0, 0, L.head.y + L.head.h + L.pad * 1.6);
        top.addColorStop(0, 'rgba(6,9,18,0.82)'); top.addColorStop(1, 'rgba(6,9,18,0)');
        g.fillStyle = top; g.fillRect(0, 0, W, L.head.y + L.head.h + L.pad * 1.6);
        const by = L.panelTop - L.pad;
        const bot = g.createLinearGradient(0, by, 0, H);
        bot.addColorStop(0, 'rgba(6,9,18,0)'); bot.addColorStop(0.35, 'rgba(6,9,18,0.78)'); bot.addColorStop(1, 'rgba(6,9,18,0.92)');
        g.fillStyle = bot; g.fillRect(0, by, W, H - by);
      }
    }

    // En-tête : nom, date, lieu
    const appear = (delay) => easeOut(clamp((t * 1.6 - delay) / 0.5, 0, 1));
    const titleA = anim ? appear(0) : 1;
    g.globalAlpha = titleA;
    g.textBaseline = 'alphabetic';
    let y = L.head.y;
    if (show.has('title')) {
      const lines = wrapTitle(g, R.name, 700, L.titleSize, SITE.fontDisplay, L.head.w);
      g.fillStyle = ink;
      g.font = `700 ${L.titleSize}px ${SITE.fontDisplay}`;
      lines.forEach((ln, i) => g.fillText(ln, L.head.x, y + L.titleSize * (1 + i * 1.12)));
      y += L.titleSize * (lines.length * 1.12 + 0.25);
    }
    const sub = [show.has('date') ? fmtDate(R.date) : '', show.has('place') ? [R.commune, R.deptName].filter(Boolean).join(', ') : ''].filter(Boolean).join('  ·  ');
    if (sub) {
      const s = fitFont(g, sub, 600, Math.round(L.titleSize * 0.42), SITE.fontSans, L.head.w);
      g.fillStyle = inkSoft;
      g.fillText(sub, L.head.x, y + s * 1.25);
    }
    g.globalAlpha = 1;

    // Profil altimétrique
    if (L.prof.h && geo.hasEle) {
      const { x, y: py, w, h } = L.prof;
      const span = Math.max(geo.eMax - geo.eMin, 30);
      const px = (d) => x + (d / geo.total) * w;
      const py2 = (e) => py + h - ((e - geo.eMin) / span) * h * 0.9;
      g.beginPath(); g.moveTo(x, py + h);
      for (const p of P) if (p.ele != null) g.lineTo(px(p.d), py2(p.ele));
      g.lineTo(x + w, py + h); g.closePath();
      g.fillStyle = dark ? 'rgba(22,24,31,0.12)' : 'rgba(255,255,255,0.16)'; g.fill();
      g.save(); g.clip();
      const gr = g.createLinearGradient(0, py, 0, py + h);
      gr.addColorStop(0, `${color}dd`); gr.addColorStop(1, `${color}22`);
      g.fillStyle = gr; g.fillRect(x, py, w * t, h);
      g.restore();
      if (t < 1) {
        const cx = px(upto);
        g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, py); g.lineTo(cx, py + h); g.stroke();
      }
      const s = Math.round(L.titleSize * 0.3);
      g.font = `600 ${s}px ${SITE.fontSans}`; g.fillStyle = inkSoft;
      if (R.altMax != null) g.fillText(`${nf0.format(R.altMax)} m`, x, py - s * 0.35);
    }

    // Chiffres
    if (opts.stats.length) {
      const cw = L.statsBox.w / L.cols;
      opts.stats.forEach((key, i) => {
        const col = i % L.cols, row = Math.floor(i / L.cols);
        const sx = L.statsBox.x + col * cw, sy = L.statsBox.y + row * L.statH;
        g.globalAlpha = anim ? appear(0.15 + i * 0.08) : 1;
        const lab = statLabel(key).toUpperCase();
        const ls = Math.round(L.statH * 0.17);
        fitFont(g, lab, 700, ls, SITE.fontSans, cw - 16);
        g.fillStyle = inkSoft;
        g.fillText(lab, sx, sy + ls * 1.1);
        const [v, unit] = statValue(key, anim ? t : 1);
        const vs = Math.round(L.statH * 0.42);
        g.font = `800 ${vs}px ${SITE.fontSans}`;
        g.fillStyle = key === 'ibp' && R.level ? (SITE.levelColor(R.level) === '#111' || R.level === 'noir' ? ink : SITE.levelColor(R.level)) : ink;
        const vw = g.measureText(v).width;
        g.fillText(v, sx, sy + ls * 1.4 + vs);
        if (unit) { g.font = `600 ${Math.round(vs * 0.45)}px ${SITE.fontSans}`; g.fillStyle = inkSoft; g.fillText(unit, sx + vw + vs * 0.15, sy + ls * 1.4 + vs); }
      });
      g.globalAlpha = 1;
    }

    // Signature du site
    if (L.brand.h) {
      const { x, y: by, h, w } = L.brand;
      const s = Math.round(h * 0.42);
      let tx = x;
      if (SITE.logo && SITE.logo.complete && SITE.logo.naturalWidth) { g.drawImage(SITE.logo, x, by, h, h); tx = x + h * 1.25; }
      g.fillStyle = ink; g.font = `700 ${s}px ${SITE.fontSans}`;
      g.fillText(SITE.name, tx, by + h * 0.5);
      g.fillStyle = inkSoft; g.font = `500 ${Math.round(s * 0.78)}px ${SITE.fontSans}`;
      g.fillText(SITE.tagline, tx, by + h * 0.5 + s * 1.15);
      if (bgAttr) {
        const as = Math.round(s * 0.62);
        g.font = `500 ${as}px ${SITE.fontSans}`; g.textAlign = 'right'; g.fillStyle = inkSoft;
        g.fillText(bgAttr, x + w, by + h * 0.5 + s * 1.15);
        g.textAlign = 'left';
      }
    } else if (bgAttr) {
      const as = Math.round(L.titleSize * 0.22);
      g.font = `500 ${as}px ${SITE.fontSans}`; g.textAlign = 'right'; g.fillStyle = inkSoft;
      g.fillText(bgAttr, W - L.pad * 0.5, H - L.pad * 0.4); g.textAlign = 'left';
    }
    g.restore();
  }

  // ------------------------------------------------------------ Rendu de l'aperçu
  async function render() {
    const token = ++renderToken;
    const F = FORMATS[opts.format];
    if (canvas.width !== F.w || canvas.height !== F.h) { canvas.width = F.w; canvas.height = F.h; }
    $('.sh-stage', dlg).dataset.format = opts.format;
    const L = layout(F.w, F.h, opts);
    const V = viewFor(L);
    setStatus('');
    try {
      // (un fond plus ancien peut finir après le nouveau : on recommence tant qu'il ne correspond pas aux réglages)
      for (let n = 0; n < 3 && (bgKeyFor(L) !== bgKey || !bgCanvas) && token === renderToken; n++) {
        $('.sh-stage', dlg).classList.add('is-loading');
        await buildBackground(L, V);
      }
    } catch (e) {
      if (token !== renderToken) return;
      setStatus(opts.bg === 'blog' ? 'Photo du blog indisponible : fond dégradé à la place.'
        : opts.bg === 'perso' ? 'Choisissez une photo pour ce fond.' : 'Fond de carte indisponible (connexion ?) : fond dégradé à la place.', true);
      const prev = opts.bg; opts.bg = 'degrade'; bgKey = ''; await buildBackground(L, V); opts.bg = prev; bgKey = bgKeyFor(L);
    } finally {
      $('.sh-stage', dlg).classList.remove('is-loading');
    }
    if (token !== renderToken) return;
    if (!anim) drawFrame(ctx, L, V, 1);
    return { L, V };
  }

  // ------------------------------------------------------------ Animation (aperçu et vidéo)
  const HOLD = 2.2; // secondes d'image finale
  function playAnimation({ record = false } = {}) {
    stopAnimation();
    const F = FORMATS[opts.format];
    const L = layout(F.w, F.h, opts);
    const V = viewFor(L);
    const total = opts.seconds + HOLD;
    return new Promise((resolve) => {
      const t0 = performance.now();
      anim = { raf: 0, resolve };
      const step = () => {
        const el = (performance.now() - t0) / 1000;
        const zoom = 1.08 - 0.08 * easeInOut(clamp(el / total, 0, 1));
        drawFrame(ctx, L, V, el < 0.4 ? 0 : easeInOut(clamp((el - 0.4) / (opts.seconds - 0.4), 0, 1)), zoom);
        if (anim && anim.onProgress) anim.onProgress(el / total);
        if (el < total && anim) anim.raf = requestAnimationFrame(step);
        else { const a = anim; anim = null; drawFrame(ctx, L, V, 1); if (a) a.resolve(); }
      };
      if (record) anim.onProgress = record;
      anim.raf = requestAnimationFrame(step);
    });
  }
  function stopAnimation() {
    if (!anim) return;
    cancelAnimationFrame(anim.raf);
    const a = anim; anim = null;
    a.resolve();
  }

  function videoMime() {
    if (!window.MediaRecorder) return null;
    const list = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return list.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || null;
  }

  async function makeVideo() {
    const mime = videoMime();
    if (!mime || !canvas.captureStream) { setStatus('Ce navigateur ne sait pas créer de vidéo. Essayez Chrome, Edge ou Safari récents.', true); return null; }
    await render();
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    busy(true, 'Enregistrement de la vidéo… 0 %');
    rec.start(250);
    await playAnimation({ record: (p) => busy(true, `Enregistrement de la vidéo… ${Math.min(99, Math.round(p * 100))} %`) });
    await new Promise((r) => setTimeout(r, 120));
    rec.stop();
    await stopped;
    stream.getTracks().forEach((tr) => tr.stop());
    busy(false);
    const type = mime.split(';')[0];
    return new Blob(chunks, { type });
  }

  async function makeImage() {
    stopAnimation();
    await render();
    return new Promise((res) => canvas.toBlob(res, 'image/png'));
  }

  // ------------------------------------------------------------ Partage
  const shareUrl = () => `${SITE.url}#rando=${encodeURIComponent(R.id)}`;
  const shareText = () => {
    const bits = [`${nf1.format(R.distanceKm)} km`, R.dplus != null ? `${nf0.format(R.dplus)} m D+` : '', R.ibp != null ? `IBP ${R.ibp}` : ''].filter(Boolean).join(' · ');
    return `${R.name} (${fmtDate(R.date)}) : ${bits}`;
  };
  const fileFor = (blob) => {
    const ext = blob.type === 'image/png' ? 'png' : blob.type.includes('mp4') ? 'mp4' : 'webm';
    return new File([blob], `${R.date}-${slug(R.name)}.${ext}`, { type: blob.type });
  };
  async function currentFile() {
    const want = opts.mode;
    if (lastBlob && lastKind === want && lastKind === 'video') return fileFor(lastBlob);
    const blob = want === 'video' ? await makeVideo() : await makeImage();
    if (!blob) return null;
    lastBlob = blob; lastKind = want;
    return fileFor(blob);
  }
  function download(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }
  async function nativeShare() {
    const file = await currentFile();
    if (!file) return;
    const data = { files: [file], title: R.name, text: `${shareText()}\n${shareUrl()}` };
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share(data); setStatus('Partagé !'); } catch (e) { if (e.name !== 'AbortError') setStatus('Partage interrompu.', true); }
    } else {
      download(file);
      setStatus(`Ce navigateur ne propose pas le partage direct : ${file.name} a été téléchargé, ajoutez-le à votre message.`);
    }
  }
  async function copyImage() {
    try {
      const blob = await makeImage();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('Image copiée : collez-la dans votre message.');
    } catch { setStatus('Copie impossible dans ce navigateur : utilisez « Télécharger ».', true); }
  }
  const SOCIAL = {
    whatsapp: { label: 'WhatsApp', href: () => `https://wa.me/?text=${encodeURIComponent(`${shareText()}\n${shareUrl()}`)}` },
    facebook: { label: 'Facebook', href: () => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl())}` },
    x: { label: 'X', href: () => `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText())}&url=${encodeURIComponent(shareUrl())}` },
    telegram: { label: 'Telegram', href: () => `https://t.me/share/url?url=${encodeURIComponent(shareUrl())}&text=${encodeURIComponent(shareText())}` },
    sms: { label: 'SMS', href: () => `sms:?&body=${encodeURIComponent(`${shareText()} ${shareUrl()}`)}` },
    mail: { label: 'E-mail', href: () => `mailto:?subject=${encodeURIComponent(`Rando : ${R.name}`)}&body=${encodeURIComponent(`${shareText()}\n\n${shareUrl()}`)}` },
  };

  // ------------------------------------------------------------ Interface
  function setStatus(msg, warn = false) {
    const el = $('#sh-status', dlg);
    if (!el) return;
    el.textContent = msg; el.classList.toggle('is-warn', !!warn);
  }
  function busy(on, msg = '') {
    dlg.classList.toggle('is-busy', on);
    $$('.sh-actions button', dlg).forEach((b) => { b.disabled = on; });
    if (msg) setStatus(msg);
  }
  function save() { const { mode, ...rest } = opts; store.set({ ...rest, mode }); }

  function chip(name, value, label, checked, type = 'radio', extra = '') {
    return `<label class="sh-chip"><input type="${type}" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${extra}${label}</span></label>`;
  }
  let sec = 'format'; // rubrique affichée sur téléphone (sur grand écran, toutes les rubriques sont visibles)
  function panelHtml() {
    const o = opts;
    if (sec === 'anim' && o.mode !== 'video') sec = 'format';
    const hasBlog = !!(R.blog && R.blog.image);
    const swatch = (c) => {
      const col = c === 'level' ? (SITE.levelColor(R.level) || SITE.accent) : c === 'accent' ? SITE.accent : c;
      const title = c === 'level' ? 'Couleur du niveau IBP' : c === 'accent' ? 'Couleur du site' : c;
      return `<label class="sh-swatch" title="${title}"><input type="radio" name="trackColor" value="${c}" ${o.trackColor === c ? 'checked' : ''}><span style="--sw:${col}"></span><span class="visually-hidden">${title}</span></label>`;
    };
    return `
      <div class="sh-tabs" role="tablist" aria-label="Type de partage">
        <button type="button" role="tab" class="sh-tab" data-mode="image" aria-selected="${o.mode === 'image'}">${svg('image')}Image</button>
        <button type="button" role="tab" class="sh-tab" data-mode="video" aria-selected="${o.mode === 'video'}">${svg('video')}Vidéo animée</button>
      </div>
      <nav class="sh-secnav" aria-label="Réglages">
        ${[['format', 'Format'], ['bg', 'Fond'], ['trace', 'Trace'], ['stats', 'Chiffres'], ['els', 'Éléments']].concat(o.mode === 'video' ? [['anim', 'Animation']] : [])
    .map(([k, l]) => `<button type="button" class="sh-secbtn" data-sec="${k}" aria-pressed="${sec === k}">${l}</button>`).join('')}
      </nav>
      <fieldset class="sh-group" data-group="format"><legend>Format</legend>
        <div class="sh-chips">${Object.entries(FORMATS).map(([k, f]) => chip('format', k, `${f.label} <small>${f.hint}</small>`, o.format === k)).join('')}</div>
      </fieldset>
      <fieldset class="sh-group" data-group="bg"><legend>Fond</legend>
        <div class="sh-chips">
          ${Object.entries(MAPS).map(([k, m]) => chip('bg', k, m.label, o.bg === k)).join('')}
          ${hasBlog ? chip('bg', 'blog', 'Photo du blog', o.bg === 'blog') : ''}
          ${chip('bg', 'perso', 'Ma photo', o.bg === 'perso')}
          ${chip('bg', 'degrade', 'Dégradé', o.bg === 'degrade')}
          ${chip('bg', 'uni', 'Couleur unie', o.bg === 'uni')}
        </div>
        <div class="sh-sub" data-for="perso" ${o.bg === 'perso' ? '' : 'hidden'}>
          <label class="sh-file">${svg('upload')}<span>${userPhoto ? 'Changer de photo' : 'Choisir une photo'}</span><input type="file" accept="image/*" id="sh-photo"></label>
        </div>
        <div class="sh-sub" data-for="degrade" ${o.bg === 'degrade' ? '' : 'hidden'}>
          ${Object.entries(GRADIENTS).map(([k, c]) => `<label class="sh-swatch sh-swatch--wide" title="${k}"><input type="radio" name="gradient" value="${k}" ${o.gradient === k ? 'checked' : ''}><span style="--sw:linear-gradient(135deg,${c.join(',')})"></span><span class="visually-hidden">${k}</span></label>`).join('')}
        </div>
        <div class="sh-sub" data-for="uni" ${o.bg === 'uni' ? '' : 'hidden'}>
          <label class="sh-color">Couleur <input type="color" id="sh-solid" value="${esc(o.solid)}"></label>
        </div>
        <label class="sh-range" data-for-map ${MAPS[o.bg] || o.bg === 'blog' || o.bg === 'perso' ? '' : 'hidden'}>Assombrir le fond <input type="range" id="sh-dim" min="0" max="70" step="5" value="${o.dim}"><output>${o.dim} %</output></label>
      </fieldset>
      <fieldset class="sh-group" data-group="trace"><legend>Trace</legend>
        <div class="sh-swatches">
          ${TRACK_COLORS.map(swatch).join('')}
          <label class="sh-swatch sh-swatch--custom" title="Autre couleur"><input type="radio" name="trackColor" value="custom" ${o.trackColor === 'custom' ? 'checked' : ''}><span style="--sw:${esc(o.customColor)}"></span><input type="color" id="sh-custom" value="${esc(o.customColor)}" aria-label="Choisir une couleur"></label>
        </div>
        <label class="sh-range">Épaisseur <input type="range" id="sh-width" min="4" max="22" step="1" value="${o.width}"><output>${o.width}</output></label>
        <div class="sh-chips">
          ${chip('glow', '1', 'Lueur', o.glow, 'checkbox')}
          ${geo.hasEle ? chip('slope', '1', 'Couleur selon la pente', o.slope, 'checkbox') : ''}
        </div>
      </fieldset>
      <fieldset class="sh-group" data-group="stats"><legend>Chiffres affichés</legend>
        <div class="sh-chips">${Object.entries(STATS).map(([k, l]) => chip('stats', k, l, o.stats.includes(k), 'checkbox')).join('')}</div>
      </fieldset>
      <fieldset class="sh-group" data-group="els"><legend>Éléments</legend>
        <div class="sh-chips">${Object.entries(SHOW).filter(([k]) => k !== 'profile' || geo.hasEle).map(([k, l]) => chip('show', k, l, o.show.includes(k), 'checkbox')).join('')}</div>
        <div class="sh-chips sh-chips--tight">
          ${chip('textTheme', 'auto', 'Texte auto', o.textTheme === 'auto')}${chip('textTheme', 'clair', 'Texte clair', o.textTheme === 'clair')}${chip('textTheme', 'fonce', 'Texte foncé', o.textTheme === 'fonce')}
        </div>
      </fieldset>
      <fieldset class="sh-group" data-group="anim" data-video ${o.mode === 'video' ? '' : 'hidden'}><legend>Animation</legend>
        <div class="sh-chips">${[6, 10, 15, 20].map((s) => chip('seconds', s, `${s} s`, +o.seconds === s)).join('')}</div>
        <p class="sh-note">La trace se dessine, la carte recule doucement et les chiffres défilent. Fichier ${(videoMime() || '').includes('mp4') ? 'MP4' : 'WebM'}, ${opts.seconds + HOLD} s environ.</p>
      </fieldset>`;
  }

  function actionsHtml() {
    const video = opts.mode === 'video';
    return `
      <div class="sh-actions">
        ${video ? `<button type="button" class="sh-btn sh-btn--ghost" data-act="preview" aria-label="${anim ? 'Arrêter l’aperçu' : 'Aperçu de l’animation'}">${svg(anim ? 'stop' : 'play')}<span class="sh-btn__txt">${anim ? 'Arrêter' : 'Aperçu'}</span></button>` : ''}
        <button type="button" class="sh-btn sh-btn--primary" data-act="share">${svg('share')}Partager${video ? ' la vidéo' : ''}</button>
        <button type="button" class="sh-btn" data-act="download" aria-label="Télécharger">${svg('download')}<span class="sh-btn__txt">Télécharger</span></button>
        ${!video && window.ClipboardItem ? `<button type="button" class="sh-btn" data-act="copy" aria-label="Copier l’image">${svg('copy')}<span class="sh-btn__txt">Copier</span></button>` : ''}
      </div>
      <div class="sh-social" aria-label="Envoyer le lien de la rando">
        <span class="sh-social__label">Envoyer le lien</span>
        ${Object.entries(SOCIAL).map(([k, s]) => `<a class="sh-soc sh-soc--${k}" href="#" data-soc="${k}" target="_blank" rel="noopener" title="${s.label}">${svg(k === 'mail' ? 'mail' : k)}<span class="visually-hidden">${s.label}</span></a>`).join('')}
        <button type="button" class="sh-soc" data-act="link" title="Copier le lien">${svg('link')}<span class="visually-hidden">Copier le lien</span></button>
      </div>
      <p class="sh-status" id="sh-status" role="status" aria-live="polite"></p>`;
  }

  function paintPanel() {
    $('.sh-panel', dlg).innerHTML = panelHtml();
    $('.sh-panel', dlg).dataset.shSection = sec;
    $('.sh-foot', dlg).innerHTML = actionsHtml();
  }

  function onChange(e) {
    const el = e.target;
    const n = el.name || el.id;
    if (n === 'format') opts.format = el.value;
    else if (n === 'bg') { opts.bg = el.value; $$('.sh-sub', dlg).forEach((s) => { s.hidden = s.dataset.for !== el.value; }); $('[data-for-map]', dlg).hidden = !(MAPS[el.value] || el.value === 'blog' || el.value === 'perso'); if (el.value === 'perso' && !userPhoto) $('#sh-photo', dlg).click(); }
    else if (n === 'gradient') opts.gradient = el.value;
    else if (n === 'sh-solid') opts.solid = el.value;
    else if (n === 'sh-dim') { opts.dim = +el.value; el.nextElementSibling.textContent = `${el.value} %`; }
    else if (n === 'trackColor') opts.trackColor = el.value;
    else if (n === 'sh-custom') { opts.customColor = el.value; opts.trackColor = 'custom'; const r = $('input[name="trackColor"][value="custom"]', dlg); r.checked = true; r.nextElementSibling.style.setProperty('--sw', el.value); }
    else if (n === 'sh-width') { opts.width = +el.value; el.nextElementSibling.textContent = el.value; }
    else if (n === 'glow') opts.glow = el.checked;
    else if (n === 'slope') opts.slope = el.checked;
    else if (n === 'stats') opts.stats = $$('input[name="stats"]:checked', dlg).map((i) => i.value);
    else if (n === 'show') opts.show = $$('input[name="show"]:checked', dlg).map((i) => i.value);
    else if (n === 'textTheme') opts.textTheme = el.value;
    else if (n === 'seconds') { opts.seconds = +el.value; }
    else if (n === 'sh-photo') {
      const f = el.files && el.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.onload = () => { userPhoto = im; opts.bg = 'perso'; bgKey = ''; el.previousElementSibling.textContent = 'Changer de photo'; schedule(); };
      im.src = url;
      return;
    } else return;
    lastBlob = null;
    save();
    if (n === 'seconds') { paintPanel(); }
    schedule();
  }
  let pending = 0;
  function schedule() {
    clearTimeout(pending);
    pending = setTimeout(async () => { // regroupe les réglages modifiés coup sur coup
      const wasAnim = !!anim;
      stopAnimation();
      await render();
      if (wasAnim) togglePreview();
    }, 40);
  }
  async function togglePreview() {
    if (anim) { stopAnimation(); paintFoot(); return; }
    await render();
    const p = playAnimation();
    paintFoot();
    await p;
    paintFoot();
  }
  function paintFoot() { const s = $('#sh-status', dlg).textContent; $('.sh-foot', dlg).innerHTML = actionsHtml(); $('#sh-status', dlg).textContent = s; }

  async function onClick(e) {
    if (e.target === dlg || e.target.closest('[data-sh-close]')) { close(); return; }
    const secBtn = e.target.closest('[data-sec]');
    if (secBtn) {
      sec = secBtn.dataset.sec;
      $('.sh-panel', dlg).dataset.shSection = sec;
      $$('[data-sec]', dlg).forEach((b) => b.setAttribute('aria-pressed', String(b === secBtn)));
      { const nav = secBtn.parentElement; nav.scrollTo({ left: secBtn.offsetLeft - (nav.clientWidth - secBtn.offsetWidth) / 2, behavior: 'smooth' }); }
      return;
    }
    const tab = e.target.closest('[data-mode]');
    if (tab) {
      stopAnimation();
      opts.mode = tab.dataset.mode; lastBlob = null; save(); paintPanel(); await render();
      if (opts.mode === 'video') togglePreview();
      return;
    }
    const soc = e.target.closest('[data-soc]');
    if (soc) { soc.href = SOCIAL[soc.dataset.soc].href(); return; } // lien suivi normalement
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'preview') togglePreview();
    else if (a === 'share') nativeShare();
    else if (a === 'download') { const f = await currentFile(); if (f) { download(f); setStatus(`${f.name} téléchargé.`); } }
    else if (a === 'copy') copyImage();
    else if (a === 'link') {
      try { await navigator.clipboard.writeText(shareUrl()); setStatus('Lien copié.'); } catch { setStatus(shareUrl()); }
    }
  }

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'sh';
    dlg.setAttribute('aria-labelledby', 'sh-title');
    dlg.innerHTML = `
      <div class="sh-inner">
        <header class="sh-head">
          <h2 class="sh-title" id="sh-title">Partager la rando</h2>
          <button type="button" class="sh-x" data-sh-close aria-label="Fermer">${svg('close')}</button>
        </header>
        <div class="sh-body">
          <div class="sh-stage"><canvas class="sh-canvas" aria-label="Aperçu de l'image à partager"></canvas><span class="sh-spinner" aria-hidden="true"></span></div>
          <div class="sh-side">
            <form class="sh-panel" onsubmit="return false"></form>
            <div class="sh-foot"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    canvas = $('.sh-canvas', dlg);
    ctx = canvas.getContext('2d');
    dlg.addEventListener('change', onChange);
    dlg.addEventListener('input', (e) => { if (['sh-dim', 'sh-width', 'sh-solid', 'sh-custom'].includes(e.target.id)) onChange(e); });
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('close', () => { stopAnimation(); document.documentElement.classList.remove('sh-open'); });
  }
  function close() { stopAnimation(); if (dlg && dlg.open) dlg.close(); }

  // ------------------------------------------------------------ Point d'entrée
  // RTShare.open({ rando, track, site: { name, tagline, url, accent, fontDisplay, fontSans, logoUrl, levelColor(lvl), levelLabel(lvl) } })
  async function open({ rando, track, site }) {
    if (!dlg) build();
    R = rando; TRACK = track; SITE = { ...site };
    if (site.logoUrl) { SITE.logo = new Image(); SITE.logo.src = site.logoUrl; }
    geo = prepareTrack(track);
    const saved = store.get();
    opts = { ...DEFAULTS, ...saved };
    if (opts.bg === 'blog' && !(R.blog && R.blog.image)) opts.bg = 'plan';
    if (opts.bg === 'perso' && !userPhoto) opts.bg = 'plan';
    bgKey = ''; bgCanvas = null; blogPhoto = null; lastBlob = null;
    $('#sh-title', dlg).textContent = `Partager · ${R.name}`;
    paintPanel();
    dlg.showModal();
    document.documentElement.classList.add('sh-open');
    try { await document.fonts.load(`700 40px ${SITE.fontDisplay}`); await document.fonts.load(`800 40px ${SITE.fontSans}`); } catch { /* polices système */ }
    await render();
    if (opts.mode === 'video') togglePreview();
  }

  window.RTShare = { open, close, makeImage, makeVideo }; // makeImage / makeVideo : contrôle et tests
})();
