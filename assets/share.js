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
    instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/>',
    messenger: '<path d="M12 3C7 3 3 6.7 3 11.4c0 2.6 1.3 5 3.3 6.5V21l3-1.7c.9.3 1.8.4 2.7.4 5 0 9-3.7 9-8.3S17 3 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m7.5 13.5 3-3.2 2.2 2 3.8-2.8-3 3.3-2.2-2Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
    globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" fill="none" stroke="currentColor" stroke-width="2"/>',
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
    seconds: 10, textTheme: 'auto', anim3d: true,
  };
  const FPS = 30;
  const ML_VER = '4.7.1';
  const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.min.js';
  const loaded = new Map();
  const loadScript = (url) => {
    if (!loaded.has(url)) {
      loaded.set(url, new Promise((res, rej) => {
        const el = document.createElement('script');
        el.src = url; el.async = true; el.crossOrigin = 'anonymous';
        el.onload = res; el.onerror = () => { loaded.delete(url); rej(new Error(`chargement impossible : ${url}`)); };
        document.head.appendChild(el);
      }));
    }
    return loaded.get(url);
  };
  const webgl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
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

  // mapCanvas : image de la carte 3D (survol) qui remplace le fond et la trace dessinée en 2D
  function drawFrame(g, L, V, t, scale = 1, clock = performance.now() / 1000, mapCanvas = null) {
    const { W, H } = L;
    const dark = mapCanvas ? false : darkText();
    const ink = dark ? '#16181f' : '#ffffff';
    const inkSoft = dark ? 'rgba(22,24,31,0.68)' : 'rgba(255,255,255,0.78)';
    const show = new Set(opts.show);
    const isMap = !!MAPS[opts.bg] || !!mapCanvas;
    const isPhoto = opts.bg === 'blog' || opts.bg === 'perso';
    const color = trackColor();
    g.save();
    g.clearRect(0, 0, W, H);

    const P = geo.P;
    const upto = geo.total * t;
    if (mapCanvas) {
      g.drawImage(mapCanvas, 0, 0, W, H);
      if (opts.dim > 0) { g.fillStyle = `rgba(6,9,18,${Math.min(opts.dim, 40) / 100 * 0.6})`; g.fillRect(0, 0, W, H); }
    } else {
    // Fond (léger zoom pendant l'animation, la trace suit le même mouvement)
    g.save();
    g.translate(W / 2, H / 2); g.scale(scale, scale); g.translate(-W / 2, -H / 2);
    if (bgCanvas) g.drawImage(bgCanvas, 0, 0);
    if ((isMap || isPhoto) && opts.dim > 0) { g.fillStyle = `rgba(6,9,18,${opts.dim / 100})`; g.fillRect(0, 0, W, H); }

    // Trace
    const lw = Math.max(3, opts.width * (Math.min(W, H) / 1080));
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
      const pulse = 1 + 0.25 * Math.sin(clock * 6.3);
      g.beginPath(); g.arc(head[0], head[1], lw * 2.2 * pulse, 0, Math.PI * 2); g.fillStyle = `${color}55`; g.fill();
      dot(head[0], head[1], lw * 1.1, color, '#ffffff');
    }
    g.restore(); // fin du zoom
    }

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
    const titleA = anim || encoding ? appear(0) : 1;
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
        g.globalAlpha = anim || encoding ? appear(0.15 + i * 0.08) : 1;
        const lab = statLabel(key).toUpperCase();
        const ls = Math.round(L.statH * 0.17);
        fitFont(g, lab, 700, ls, SITE.fontSans, cw - 16);
        g.fillStyle = inkSoft;
        g.fillText(lab, sx, sy + ls * 1.1);
        const [v, unit] = statValue(key, anim || encoding ? t : 1);
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
  const use3d = () => opts.mode === 'video' && opts.anim3d && webgl;
  // Déroulé de la vidéo : t = avancement de la trace (0 → 1), zoom = léger recul de la carte 2D
  function timeline() {
    const is3d = use3d();
    const intro = is3d ? 1.6 : 0.4;
    const run = Math.max(2, opts.seconds - intro);
    const total = intro + run + HOLD + (is3d ? 0.8 : 0);
    const at = (el) => {
      const r = clamp((el - intro) / run, 0, 1);
      // 3D : vitesse presque constante (caméra embarquée) ; 2D : départ et arrivée en douceur
      const t = el < intro ? 0 : is3d ? 0.75 * r + 0.25 * easeInOut(r) : easeInOut(r);
      return { t, zoom: 1.08 - 0.08 * easeInOut(clamp(el / total, 0, 1)) };
    };
    return { is3d, intro, run, total, frames: Math.round(total * FPS), at };
  }
  function planFor() {
    const F = FORMATS[opts.format];
    const L = layout(F.w, F.h, opts);
    return { F, L, V: viewFor(L), TL: timeline() };
  }

  // ------------------------------------------------------------ Survol 3D satellite (MapLibre, carte hors écran)
  // La carte est rendue à la taille exacte de la vidéo, puis recopiée image par image sous les textes.
  let f3 = null; // { map, box, key, cams, S, total, warm }
  let encoding = false; // vrai pendant la création image par image de la vidéo
  const bearingOf = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
  function sampler3d() {
    const pts = TRACK.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[3]));
    const total = pts[pts.length - 1][3] || 0.001;
    const step = Math.max(0.005, total / 2500);
    const n = Math.max(2, Math.ceil(total / step) + 1);
    const lon = new Float64Array(n), lat = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.min(total, i * step);
      while (j < pts.length - 2 && pts[j + 1][3] < d) j++;
      const a = pts[j], b = pts[j + 1] || a;
      const f = b[3] > a[3] ? clamp((d - a[3]) / (b[3] - a[3]), 0, 1) : 0;
      lat[i] = a[0] + (b[0] - a[0]) * f; lon[i] = a[1] + (b[1] - a[1]) * f;
    }
    const idx = (d) => clamp(d / step, 0, n - 1);
    const lerp = (arr, d) => { const f = idx(d), i = Math.floor(f), t = f - i; return i >= n - 1 ? arr[n - 1] : arr[i] + (arr[i + 1] - arr[i]) * t; };
    return {
      total, n,
      pos: (d) => [lerp(lon, d), lerp(lat, d)],
      coordsTo: (d) => { const end = Math.floor(idx(d)), out = []; for (let i = 0; i <= end; i++) out.push([lon[i], lat[i]]); out.push([lerp(lon, d), lerp(lat, d)]); return out; },
      all: () => Array.from({ length: n }, (_, i) => [lon[i], lat[i]]),
    };
  }
  function padding3d(L) {
    if (L.land) return { top: L.pad, bottom: L.pad, left: L.pad, right: L.W - L.panelLeft + L.pad * 0.5 };
    return { top: Math.round(L.head.y + L.head.h + L.pad * 0.6), bottom: Math.round(L.H - L.panelTop + L.pad * 0.3), left: L.pad, right: L.pad };
  }
  // Un seul chargement de la carte 3D à la fois (aperçu et création de la vidéo peuvent se croiser)
  let f3Lock = Promise.resolve();
  function ensure3d(P) {
    const run = f3Lock.then(() => ensure3dNow(P));
    f3Lock = run.catch(() => {});
    return run;
  }
  async function ensure3dNow(P) {
    const color = trackColor();
    const key = JSON.stringify([R.id, P.L.W, P.L.H, color, opts.width, opts.show.includes('markers'), P.L.track, P.TL.frames]);
    if (f3 && f3.key === key) return f3;
    await loadScript(`https://unpkg.com/maplibre-gl@${ML_VER}/dist/maplibre-gl.js`);
    const ML = window.maplibregl;
    if (!ML) throw new Error('MapLibre indisponible');
    const S = f3 && f3.rid === R.id ? f3.S : sampler3d();
    let map = f3 && f3.size === `${P.L.W}x${P.L.H}` && f3.rid === R.id ? f3.map : null;
    if (!map) {
      destroy3d();
      const box = document.createElement('div');
      // hors de l'écran mais bien « affichée » : WebGL continue de dessiner
      box.style.cssText = `position:fixed;left:-${P.L.W + 500}px;top:0;width:${P.L.W}px;height:${P.L.H}px;pointer-events:none;`;
      box.setAttribute('aria-hidden', 'true');
      document.body.appendChild(box);
      const fr = !!R.region;
      const all = S.all();
      const lw = Math.max(3, opts.width * 0.55);
      map = new ML.Map({
        container: box,
        style: {
          version: 8,
          sources: {
            sat: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [MAPS.photo.url(fr)] },
            dem: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15, tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] },
            route: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: all } } },
            done: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [all[0], all[0]] } } },
            head: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: all[0] } } },
            ends: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#1b2430' } },
            { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 0, 'raster-saturation': 0.1, 'raster-contrast': 0.08 } },
            { id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.7, 'line-width': lw * 0.45, 'line-dasharray': [1.2, 1.6] } },
            { id: 'done-glow', type: 'line', source: 'done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-opacity': opts.glow ? 0.5 : 0, 'line-width': lw * 3, 'line-blur': lw * 1.6 } },
            { id: 'done-casing', type: 'line', source: 'done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b0f14', 'line-opacity': 0.55, 'line-width': lw + 4 } },
            { id: 'done', type: 'line', source: 'done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': lw } },
            { id: 'ends', type: 'circle', source: 'ends', paint: { 'circle-radius': lw * 0.9, 'circle-color': '#ffffff', 'circle-stroke-width': lw * 0.45, 'circle-stroke-color': ['get', 'c'] } },
            { id: 'head-halo', type: 'circle', source: 'head', paint: { 'circle-radius': lw * 2.4, 'circle-color': color, 'circle-opacity': 0.35, 'circle-blur': 0.4 } },
            { id: 'head', type: 'circle', source: 'head', paint: { 'circle-radius': lw * 1.05, 'circle-color': color, 'circle-stroke-width': lw * 0.45, 'circle-stroke-color': '#ffffff' } },
          ],
          terrain: { source: 'dem', exaggeration: 1.45 },
          sky: { 'sky-color': '#6aa6dc', 'horizon-color': '#dfeaf4', 'fog-color': '#cfdbe6', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.3, 'atmosphere-blend': 0.8 },
        },
        center: all[0], zoom: 13, pitch: 55,
        interactive: false, attributionControl: false, preserveDrawingBuffer: true, pixelRatio: 1, fadeDuration: 0, maxPitch: 80,
      });
      // On attend seulement le style : les tuiles (satellite, relief) se chargent ensuite pendant le préchargement
      await new Promise((res, rej) => {
        // (style fourni directement : il peut être prêt avant même qu'on écoute l'événement)
        const ok = () => !!(map.style && map.style._loaded);
        if (ok()) { res(); return; }
        map.once('style.load', res);
        const poll = setInterval(() => { if (ok()) { clearInterval(poll); res(); } }, 100);
        setTimeout(() => { clearInterval(poll); if (ok()) res(); else rej(new Error('carte 3D : style non chargé')); }, 15000);
      });
      f3 = { map, box, rid: R.id, size: `${P.L.W}x${P.L.H}`, S };
    } else {
      // Même carte, réglages modifiés : couleurs et épaisseurs
      const lw = Math.max(3, opts.width * 0.55);
      map.setPaintProperty('done', 'line-color', color); map.setPaintProperty('done', 'line-width', lw);
      map.setPaintProperty('done-glow', 'line-color', color); map.setPaintProperty('done-glow', 'line-opacity', opts.glow ? 0.5 : 0);
      map.setPaintProperty('done-casing', 'line-width', lw + 4);
      map.setPaintProperty('head', 'circle-color', color); map.setPaintProperty('head-halo', 'circle-color', color);
    }
    const ends = [{ c: '#1a8f4a', at: S.pos(0) }].concat(R.loop ? [] : [{ c: '#d23a3a', at: S.pos(S.total) }]);
    map.getSource('ends').setData({ type: 'FeatureCollection', features: opts.show.includes('markers') ? ends.map((e) => ({ type: 'Feature', properties: { c: e.c }, geometry: { type: 'Point', coordinates: e.at } })) : [] });
    map.setPadding(padding3d(P.L));
    f3.cams = cameraPath(map, S, P);
    f3.key = key;
    return f3;
  }
  // Trajet de la caméra, calculé d'avance image par image (identique pour l'aperçu et la vidéo)
  function cameraPath(map, S, P) {
    const { TL } = P;
    const total = S.total;
    const look = clamp(total * 0.05, 0.12, 0.7);
    const zoom = clamp(15.8 - Math.log2(Math.max(total, 1) / 4) * 0.5, 13.2, 16);
    const pitch = 62;
    const target = (d) => ({ c: S.pos(d), b: bearingOf(S.pos(Math.max(0, d - look * 0.3)), S.pos(Math.min(total, d + look))) });
    const all = S.all();
    let bounds = new window.maplibregl.LngLatBounds(all[0], all[0]);
    for (const c of all) bounds = bounds.extend(c);
    const ov = map.cameraForBounds(bounds, { padding: 40 }) || { center: bounds.getCenter(), zoom: 12 };
    const t0 = target(0);
    const overview = { c: [ov.center.lng ?? ov.center[0], ov.center.lat ?? ov.center[1]], z: Math.min(ov.zoom, zoom - 0.5), p: 45, b: t0.b };
    const cams = [];
    let cam = { c: t0.c, b: t0.b };
    const runEnd = TL.intro + TL.run;
    for (let i = 0; i < TL.frames; i++) {
      const el = i / FPS;
      const { t } = TL.at(el);
      const d = total * t;
      if (el < TL.intro) {
        const k = easeInOut(el / TL.intro);
        cams.push({ c: [overview.c[0] + (t0.c[0] - overview.c[0]) * k, overview.c[1] + (t0.c[1] - overview.c[1]) * k], z: overview.z + (zoom - overview.z) * k, p: overview.p + (pitch - overview.p) * k, b: overview.b, d: 0 });
        continue;
      }
      const tg = target(d);
      const dt = 1 / FPS;
      cam.c = [cam.c[0] + (tg.c[0] - cam.c[0]) * (1 - Math.exp(-dt * 5)), cam.c[1] + (tg.c[1] - cam.c[1]) * (1 - Math.exp(-dt * 5))];
      cam.b += angDiff(cam.b, tg.b) * (1 - Math.exp(-dt * 1.4));
      if (el <= runEnd) { cams.push({ c: cam.c.slice(), z: zoom, p: pitch, b: cam.b, d }); continue; }
      // Fin : la caméra s'élève pour montrer toute la trace, en tournant doucement
      const k = easeInOut(clamp((el - runEnd) / 1.8, 0, 1));
      const last = cams[cams.length - 1];
      cams.push({ c: [last.c[0] + (overview.c[0] - last.c[0]) * k * 0.15, last.c[1] + (overview.c[1] - last.c[1]) * k * 0.15], z: last.z + (overview.z - last.z) * k * 0.15, p: last.p + (50 - last.p) * k * 0.15, b: last.b + 0.25, d: total });
    }
    return cams;
  }
  function apply3d(i) {
    const cam = f3.cams[clamp(i, 0, f3.cams.length - 1)];
    const map = f3.map;
    map.getSource('done').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: f3.S.coordsTo(Math.max(cam.d, 1e-4)) } });
    map.getSource('head').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: f3.S.pos(cam.d) } });
    map.setLayoutProperty('head', 'visibility', cam.d >= f3.S.total ? 'none' : 'visible');
    map.setLayoutProperty('head-halo', 'visibility', cam.d >= f3.S.total ? 'none' : 'visible');
    map.jumpTo({ center: cam.c, zoom: cam.z, pitch: cam.p, bearing: cam.b });
  }
  // Image exacte : on attend que les tuiles visibles soient chargées (au plus 4 s)
  // (chaque attente est bornée : si la carte ne dessine plus, par exemple onglet masqué, on n'attend pas indéfiniment)
  const renderOnce = (map, ms = 1500) => Promise.race([new Promise((res) => { map.once('render', res); map.triggerRepaint(); }), new Promise((res) => setTimeout(res, ms))]);
  async function frame3d(i) {
    apply3d(i);
    const map = f3.map;
    await renderOnce(map);
    if (!map.areTilesLoaded()) await Promise.race([new Promise((res) => map.once('idle', res)), new Promise((res) => setTimeout(res, 4000))]);
    await renderOnce(map);
    return map.getCanvas();
  }
  function destroy3d() {
    if (!f3) return;
    try { f3.map.remove(); } catch { /* déjà supprimée */ }
    f3.box.remove();
    f3 = null;
  }
  // Avant l'aperçu : on survole rapidement le parcours pour charger les tuiles (le rendu sera fluide)
  async function warm3d(onProgress) {
    if (f3.warm === f3.key) return;
    const n = f3.cams.length;
    const stepEvery = Math.max(1, Math.round(n / 9));
    for (let i = 0, k = 0; i < n; i += stepEvery, k++) {
      apply3d(i);
      await Promise.race([new Promise((res) => f3.map.once('idle', res)), new Promise((res) => setTimeout(res, 1800))]);
      if (onProgress) onProgress(i / n);
    }
    f3.warm = f3.key;
  }

  async function drawAt(P, i, exact) {
    const el = i / FPS;
    const { t, zoom } = P.TL.at(el);
    if (P.TL.is3d) {
      const mc = exact ? await frame3d(i) : (apply3d(i), f3.map.getCanvas());
      drawFrame(ctx, P.L, P.V, t, 1, el, mc);
    } else {
      drawFrame(ctx, P.L, P.V, t, zoom, el);
    }
  }

  async function prepare(P) {
    await render(); // fond 2D et polices
    if (P.TL.is3d) {
      busy(true, 'Préparation du survol 3D…');
      try {
        await ensure3d(P);
        await warm3d((p) => setStatus(`Chargement du relief et des images satellite… ${Math.round(p * 100)} %`));
      } finally { busy(false); setStatus(''); }
    }
  }

  function playAnimation({ record = false } = {}) {
    stopAnimation();
    const P = planFor();
    return new Promise((resolve) => {
      anim = { raf: 0, resolve };
      (async () => {
        try { await prepare(P); } catch (e) {
          console.warn('Survol 3D indisponible', e);
          setStatus('Le survol 3D n’a pas pu se charger (WebGL ou connexion) : animation à plat à la place.', true);
          opts.anim3d = false; paintPanel(); P.TL = timeline();
        }
        if (!anim) return;
        const t0 = performance.now();
        const step = () => {
          if (!anim) return;
          const el = (performance.now() - t0) / 1000;
          const i = Math.min(P.TL.frames - 1, Math.floor(el * FPS));
          drawAt(P, i, false);
          if (record) record(el / P.TL.total);
          if (el < P.TL.total) anim.raf = requestAnimationFrame(step);
          else { const a = anim; anim = null; if (a) a.resolve(); }
        };
        anim.raf = requestAnimationFrame(step);
      })();
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
  const canEncode = () => typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function';

  // Vidéo image par image (WebCodecs + MP4) : durée exacte et rendu net, même si la carte charge lentement
  async function encodeMp4(P) {
    await loadScript(MUXER_URL);
    const { W, H } = P.L;
    const bitrate = Math.round(W * H * FPS * 0.16);
    let config = null;
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640033']) {
      const c = { codec, width: W, height: H, bitrate, framerate: FPS, latencyMode: 'quality' };
      try { if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; } } catch { /* suivant */ }
    }
    if (!config) throw new Error('codec H.264 indisponible');
    const muxer = new window.Mp4Muxer.Muxer({ target: new window.Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
    let failure = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
    enc.configure(config);
    const N = P.TL.frames;
    encoding = true;
    try {
    for (let i = 0; i < N; i++) {
      if (failure) throw failure;
      await drawAt(P, i, P.TL.is3d);
      const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
      vf.close();
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (i % 6 === 0) { busy(true, `Création de la vidéo… ${Math.round((i / N) * 100)} %`); await new Promise((r) => setTimeout(r, 0)); }
    }
    } finally { encoding = false; }
    await enc.flush();
    enc.close();
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }
  // Secours (navigateurs sans WebCodecs) : enregistrement en temps réel de l'animation
  async function recordRealtime() {
    const mime = videoMime();
    if (!mime || !canvas.captureStream) throw new Error('vidéo impossible');
    const stream = canvas.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start(250);
    await playAnimation({ record: (p) => busy(true, `Enregistrement de la vidéo… ${Math.min(99, Math.round(p * 100))} %`) });
    await new Promise((r) => setTimeout(r, 120));
    rec.stop();
    await stopped;
    stream.getTracks().forEach((tr) => tr.stop());
    return new Blob(chunks, { type: mime.split(';')[0] });
  }
  async function makeVideo() {
    stopAnimation();
    const P = planFor();
    try {
      if (canEncode()) {
        try { await prepare(P); } catch (e) { console.warn('Survol 3D indisponible', e); opts.anim3d = false; paintPanel(); P.TL = timeline(); setStatus('Survol 3D indisponible : animation à plat.', true); }
        busy(true, 'Création de la vidéo… 0 %');
        try { return await encodeMp4(P); } catch (e) { console.warn('Encodage MP4 impossible, enregistrement en direct', e); }
      }
      busy(true, 'Enregistrement de la vidéo…');
      return await recordRealtime();
    } catch {
      setStatus('Ce navigateur ne sait pas créer de vidéo. Essayez Chrome, Edge ou Safari récents.', true);
      return null;
    } finally {
      busy(false);
      if ($('#sh-status', dlg).textContent.startsWith('Création') || $('#sh-status', dlg).textContent.startsWith('Enregistrement')) setStatus('');
      drawAt(P, P.TL.frames - 1, false);
    }
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
  const fileKey = () => JSON.stringify([opts.mode, opts.format, opts.mode === 'video' ? use3d() : 0]);
  let lastKey = '';
  async function currentFile() {
    if (lastBlob && lastKey === fileKey()) return fileFor(lastBlob);
    const blob = opts.mode === 'video' ? await makeVideo() : await makeImage();
    if (!blob) return null;
    lastBlob = blob; lastKey = fileKey(); lastKind = opts.mode;
    return fileFor(blob);
  }
  const hasFile = () => !!lastBlob && lastKey === fileKey();
  function download(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }
  const canShareFile = (file) => { try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; } };

  // Destinations proposées. format : réglé automatiquement avant de créer le fichier (story = 9:16, publication = 4:5)
  const TARGETS = {
    whatsapp: { label: 'WhatsApp', icon: 'whatsapp', app: 'WhatsApp', text: true, web: () => `https://wa.me/?text=${encodeURIComponent(`${shareText()}\n${shareUrl()}`)}`, webLabel: 'Ouvrir WhatsApp' },
    messenger: { label: 'Messenger', icon: 'messenger', app: 'Messenger', text: true, web: () => 'https://www.messenger.com/', webLabel: 'Ouvrir Messenger' },
    mail: { label: 'E-mail', icon: 'mail', app: 'Mail', text: true, web: () => `mailto:?subject=${encodeURIComponent(`Rando : ${R.name}`)}&body=${encodeURIComponent(`${shareText()}\n\n${shareUrl()}\n\n(le fichier est joint)`)}`, webLabel: 'Écrire l’e-mail' },
    'ig-story': { label: 'Story', sub: 'Instagram', icon: 'instagram', app: 'Instagram', format: 'story', hint: 'choisissez Instagram, puis « Story »', web: () => 'https://www.instagram.com/', webLabel: 'Ouvrir Instagram', webNote: 'Les stories se publient depuis l’appli Instagram du téléphone.' },
    'ig-post': { label: 'Publication', sub: 'Instagram', icon: 'instagram', app: 'Instagram', format: 'portrait', hint: 'choisissez Instagram, puis « Publication »', web: () => 'https://www.instagram.com/', webLabel: 'Ouvrir Instagram', webNote: 'Sur Instagram : « Créer », puis ajoutez le fichier.' },
    'fb-story': { label: 'Story', sub: 'Facebook', icon: 'facebook', app: 'Facebook', format: 'story', hint: 'choisissez Facebook, puis « Story »', web: () => 'https://www.facebook.com/stories/create', webLabel: 'Ouvrir Facebook' },
    'fb-post': { label: 'Publication', sub: 'Facebook', icon: 'facebook', app: 'Facebook', format: 'portrait', hint: 'choisissez Facebook, puis « Publication »', web: () => 'https://www.facebook.com/', webLabel: 'Ouvrir Facebook', webNote: 'Sur Facebook : « Photo/vidéo », puis ajoutez le fichier.' },
    download: { label: 'Télécharger', icon: 'download' },
  };
  let ready = null; // { id, data } : partage prêt, en attente d'un nouveau geste de l'utilisateur
  async function doShare(id, data) {
    try {
      await navigator.share(data);
      setStatus(`Envoyé vers ${TARGETS[id].app} !`);
      return true;
    } catch (e) {
      if (e.name === 'AbortError') { setStatus(''); return true; }
      if (e.name === 'NotAllowedError') return false; // le geste a expiré pendant la création du fichier
      setStatus('Le partage n’a pas abouti. Réessayez, ou utilisez « Télécharger ».', true);
      return true;
    }
  }
  function showReady(id, html) {
    const el = $('#sh-status', dlg);
    el.classList.remove('is-warn');
    el.innerHTML = html;
  }
  async function shareTo(id) {
    const T = TARGETS[id];
    stopAnimation();
    ready = null;
    if (T.format && opts.format !== T.format) {
      opts.format = T.format; save(); paintPanel();
      setStatus(`Format ${FORMATS[T.format].label} (${FORMATS[T.format].hint}) appliqué pour ${T.sub || T.label}.`);
    }
    const quick = hasFile(); // fichier déjà prêt : le partage part tout de suite
    const file = await currentFile();
    if (!file) return;
    if (id === 'download') { download(file); setStatus(`${file.name} téléchargé.`); return; }
    const data = { files: [file] };
    if (T.text) { data.title = R.name; data.text = `${shareText()}\n${shareUrl()}`; }
    if (canShareFile(file)) {
      if (quick || opts.mode === 'image') {
        if (await doShare(id, data)) return;
      }
      // Création longue (vidéo) : le téléphone exige un nouveau geste pour ouvrir le menu de partage
      ready = { id, data };
      showReady(id, `<span class="sh-ready"><span>${opts.mode === 'video' ? 'Vidéo prête' : 'Image prête'}${T.hint ? ` : ${esc(T.hint)}` : ''}.</span>
        <button type="button" class="sh-btn sh-btn--primary sh-ready__btn" data-ready>${svg(T.icon)}Envoyer sur ${esc(T.app)}</button></span>`);
      $('[data-ready]', dlg).focus();
      return;
    }
    // Ordinateur (pas de partage de fichier) : téléchargement, puis lien vers le service
    download(file);
    showReady(id, `<span class="sh-ready"><span>${esc(file.name)} téléchargé. ${esc(T.webNote || 'Ajoutez-le à votre message.')}</span>
      <a class="sh-btn sh-ready__btn" href="${esc(T.web())}" ${T.web().startsWith('mailto:') ? '' : 'target="_blank" rel="noopener"'}>${svg(T.icon)}${esc(T.webLabel)}</a></span>`);
  }

  // ------------------------------------------------------------ Interface
  function setStatus(msg, warn = false) {
    const el = $('#sh-status', dlg);
    if (!el) return;
    el.textContent = msg; el.classList.toggle('is-warn', !!warn);
    if (msg) ready = null;
  }
  function busy(on, msg = '') {
    dlg.classList.toggle('is-busy', on);
    $$('.sh-actions button, .sh-targets button', dlg).forEach((b) => { b.disabled = on; });
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
        ${(o.mode === 'video' ? [['anim', 'Animation']] : []).concat([['format', 'Format'], ['bg', 'Fond'], ['trace', 'Trace'], ['stats', 'Chiffres'], ['els', 'Éléments']])
    .map(([k, l]) => `<button type="button" class="sh-secbtn" data-sec="${k}" aria-pressed="${sec === k}">${l}</button>`).join('')}
      </nav>
      <fieldset class="sh-group" data-group="format"><legend>Format</legend>
        <div class="sh-chips">${Object.entries(FORMATS).map(([k, f]) => chip('format', k, `${f.label} <small>${f.hint}</small>`, o.format === k)).join('')}</div>
      </fieldset>
      <fieldset class="sh-group" data-group="bg"><legend>Fond</legend>
        ${use3d() ? '<p class="sh-note sh-note--top">Le survol 3D utilise toujours la vue satellite avec relief. Ce fond sert à l’image et à l’animation à plat.</p>' : ''}
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
        <div class="sh-chips">
          ${webgl ? chip('anim3d', '1', `${svg('globe')}Survol 3D satellite`, o.anim3d) : ''}${chip('anim3d', '0', 'Carte à plat', !o.anim3d || !webgl)}
        </div>
        <div class="sh-chips sh-chips--tight">${[6, 10, 15, 20].map((s) => chip('seconds', s, `${s} s`, +o.seconds === s)).join('')}</div>
        <p class="sh-note">${use3d()
    ? 'Vue 3D avec relief : la caméra suit la trace au-dessus des images satellite, puis s’élève pour montrer tout le parcours.'
    : 'La trace se dessine sur le fond choisi, la carte recule doucement et les chiffres défilent.'}
          Fichier ${canEncode() || (videoMime() || '').includes('mp4') ? 'MP4' : 'WebM'} de ${Math.round(timeline().total)} s environ.</p>
      </fieldset>`;
  }

  function actionsHtml() {
    const video = opts.mode === 'video';
    const tile = (id) => {
      const T = TARGETS[id];
      return `<button type="button" class="sh-tg sh-tg--${id}" data-tg="${id}" title="${esc(T.sub ? `${T.sub} · ${T.label}` : T.label)}">
        <span class="sh-tg__ico">${svg(T.icon)}</span><span class="sh-tg__txt">${T.sub ? `<small>${esc(T.sub)}</small>` : ''}${esc(T.label)}</span></button>`;
    };
    return `
      ${video ? `<div class="sh-actions"><button type="button" class="sh-btn sh-btn--ghost" data-act="preview">${svg(anim ? 'stop' : 'play')}${anim ? 'Arrêter l’aperçu' : 'Voir l’aperçu animé'}</button></div>` : ''}
      <p class="sh-targets__label">${video ? 'Partager la vidéo' : 'Partager l’image'}</p>
      <div class="sh-targets">${['whatsapp', 'messenger', 'mail', 'download', 'ig-story', 'ig-post', 'fb-story', 'fb-post'].map(tile).join('')}</div>
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
    else if (n === 'anim3d') { opts.anim3d = el.value === '1'; }
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
    if (n === 'seconds' || n === 'anim3d') { paintPanel(); }
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
  function paintFoot() { const s = $('#sh-status', dlg).innerHTML; $('.sh-foot', dlg).innerHTML = actionsHtml(); $('#sh-status', dlg).innerHTML = s; }

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
      opts.mode = tab.dataset.mode; lastBlob = null; save();
      if (opts.mode === 'video') sec = 'anim';
      paintPanel(); await render();
      if (opts.mode === 'video') togglePreview();
      return;
    }
    const rd = e.target.closest('[data-ready]');
    if (rd && ready) {
      const { id, data } = ready;
      if (!(await doShare(id, data))) setStatus('Le téléphone a refusé le partage : touchez à nouveau le bouton.', true);
      else ready = null;
      return;
    }
    const tg = e.target.closest('[data-tg]');
    if (tg) { shareTo(tg.dataset.tg); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'preview') togglePreview();
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
    dlg.addEventListener('close', () => { stopAnimation(); destroy3d(); ready = null; document.documentElement.classList.remove('sh-open'); });
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
    bgKey = ''; bgCanvas = null; blogPhoto = null; lastBlob = null; lastKey = ''; ready = null;
    if (f3 && f3.rid !== R.id) destroy3d();
    $('#sh-title', dlg).textContent = `Partager · ${R.name}`;
    paintPanel();
    dlg.showModal();
    document.documentElement.classList.add('sh-open');
    try { await document.fonts.load(`700 40px ${SITE.fontDisplay}`); await document.fonts.load(`800 40px ${SITE.fontSans}`); } catch { /* polices système */ }
    await render();
    if (opts.mode === 'video') togglePreview();
  }

  window.RTShare = { open, close, makeImage, makeVideo, shareTo }; // makeImage / makeVideo : contrôle et tests
})();
