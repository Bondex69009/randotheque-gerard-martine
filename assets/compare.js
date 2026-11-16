/* Comparateur « VS » : deux randos côte à côte (distance, dénivelés, difficulté, profils superposés).
   Module partagé par les deux sites : il ne connaît que les variables CSS communes et reçoit
   d'app.js tout ce qui dépend du site (formatage, couleurs de niveau, ouverture des fiches). */
(() => {
  'use strict';

  window.RTCompareInit = (ctx) => {
    const { getR, esc, icon, fmtKm, fmtM, fmtDur, fmtDate, nf0, nf1, placeOf, levelLabel, ibpBadge, shapeSvg, onChange } = ctx;
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const STORE = 'rt-compare';
    const SIDES = ['a', 'b'];

    // ------------------------------------------------------------ Sélection (2 randos max, gardée le temps de la visite)
    let picked = [];
    try { picked = JSON.parse(sessionStorage.getItem(STORE) || '[]').filter((id) => getR(id)).slice(0, 2); } catch { picked = []; }
    const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(picked)); } catch { /* navigation privée */ } };

    const has = (id) => picked.includes(id);
    function toggle(id) {
      if (!getR(id)) return;
      if (has(id)) picked = picked.filter((x) => x !== id);
      else if (picked.length < 2) picked.push(id);
      else picked = [picked[0], id]; // la 1re reste la référence, la 2e est remplacée
      save();
      paint();
    }
    function remove(id) { picked = picked.filter((x) => x !== id); save(); paint(); }
    function clear() { picked = []; save(); paint(); }

    // ------------------------------------------------------------ Bouton des cartes et de la fiche
    const cardButton = (r) => `<button type="button" class="cmp-toggle" data-cmp="${esc(r.id)}" aria-pressed="${has(r.id)}"
      title="${has(r.id) ? 'Retirer du comparateur' : 'Ajouter au comparateur (VS)'}">${icon('vs')}<span>${has(r.id) ? 'Dans le VS' : 'Comparer'}</span></button>`;
    function detailButton(r) {
      const other = picked.find((x) => x !== r.id);
      const label = has(r.id) ? 'Retirer du comparateur'
        : other ? `Comparer avec « ${getR(other).name} »` : 'Comparer avec une autre rando';
      return `<button type="button" class="btn btn--outline btn--block cmp-detail" data-cmp-detail="${esc(r.id)}" aria-pressed="${has(r.id)}"
        title="Mettre deux randos face à face : distance, dénivelé, difficulté, profils">${icon('vs')}<span class="btn__label">${esc(label)}</span></button>`;
    }

    // ------------------------------------------------------------ Barre flottante
    const tray = document.createElement('div');
    tray.className = 'cmp-tray';
    tray.setAttribute('role', 'region');
    tray.setAttribute('aria-label', 'Comparateur de randos');
    tray.hidden = true;
    document.body.appendChild(tray);

    function paint() {
      for (const b of $$('[data-cmp]')) {
        const on = has(b.dataset.cmp);
        b.setAttribute('aria-pressed', on);
        b.title = on ? 'Retirer du comparateur' : 'Ajouter au comparateur (VS)';
        $('span', b).textContent = on ? 'Dans le VS' : 'Comparer';
      }
      for (const b of $$('[data-cmp-detail]')) b.outerHTML = detailButton(getR(b.dataset.cmpDetail));
      tray.hidden = !picked.length;
      if (!picked.length) { tray.innerHTML = ''; return; }
      const slot = (id, i) => {
        const r = id && getR(id);
        return r ? `<div class="cmp-tray__slot cmp-tray__slot--${SIDES[i]}">
            <span class="cmp-tray__dot" aria-hidden="true"></span>
            <span class="cmp-tray__name" title="${esc(r.name)}">${esc(r.name)}</span>
            <button type="button" class="cmp-tray__x" data-cmp-remove="${esc(r.id)}" aria-label="Retirer ${esc(r.name)} du comparateur">${icon('close')}</button>
          </div>`
          : `<div class="cmp-tray__slot cmp-tray__slot--empty">Choisissez une 2<sup>e</sup> rando</div>`;
      };
      tray.innerHTML = `
        <div class="cmp-tray__slots">${slot(picked[0], 0)}<span class="cmp-tray__vs" aria-hidden="true">VS</span>${slot(picked[1], 1)}</div>
        <div class="cmp-tray__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-cmp-clear>Vider</button>
          <button type="button" class="btn btn--primary btn--sm" data-cmp-open ${picked.length < 2 ? 'disabled' : ''}>${icon('vs')}Comparer</button>
        </div>`;
    }

    // ------------------------------------------------------------ Fenêtre de comparaison
    const dlg = document.createElement('dialog');
    dlg.className = 'cmp';
    dlg.setAttribute('aria-labelledby', 'cmp-title');
    document.body.appendChild(dlg);
    let shown = null; // [a, b] affichées

    const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
    const avgSlope = (r) => (r.dplus != null && r.distanceKm ? Math.round(r.dplus / r.distanceKm) : null);

    // Lignes du duel : valeur numérique (pour les barres), affichage et écart
    const METRICS = [
      { key: 'ibp', label: 'IBP index (difficulté)', ic: 'gauge', get: (r) => r.ibp, fmt: (v, r) => (v == null ? 'n.c.' : `${r.ibpEstimated ? '≈' : ''}${v}`), diff: (d) => `${nf0.format(d)} pts`, sub: (r) => levelLabel(r) },
      { key: 'dist', label: 'Distance', ic: 'distance', get: (r) => r.distanceKm, fmt: (v) => fmtKm(v), diff: (d) => fmtKm(d) },
      { key: 'dplus', label: 'Dénivelé +', ic: 'up', get: (r) => r.dplus, fmt: (v) => fmtM(v), diff: (d) => fmtM(d) },
      { key: 'dminus', label: 'Dénivelé −', ic: 'down', get: (r) => r.dminus, fmt: (v) => fmtM(v), diff: (d) => fmtM(d) },
      { key: 'dur', label: 'Temps estimé', ic: 'clock', get: (r) => r.durationMin, fmt: (v) => fmtDur(v), diff: (d) => fmtDur(d) },
      { key: 'slope', label: 'Dénivelé moyen', ic: 'up', get: avgSlope, fmt: (v) => (v == null ? 'n.c.' : `${nf0.format(v)} m/km`), diff: (d) => `${nf0.format(d)} m/km` },
      { key: 'altmax', label: 'Altitude max', ic: 'up', get: (r) => r.altMax, fmt: (v) => fmtM(v), diff: (d) => fmtM(d) },
      { key: 'altmin', label: 'Altitude min', ic: 'down', get: (r) => r.altMin, fmt: (v) => fmtM(v), diff: (d) => fmtM(d) },
      { key: 'up', label: 'Km en montée', ic: 'up', get: (r) => r.slopes && r.slopes.upKm, fmt: (v) => (v == null ? 'n.c.' : fmtKm(v)), diff: (d) => fmtKm(d) },
      { key: 'flat', label: 'Km à plat', ic: 'distance', get: (r) => r.slopes && r.slopes.flatKm, fmt: (v) => (v == null ? 'n.c.' : fmtKm(v)), diff: (d) => fmtKm(d) },
      { key: 'down', label: 'Km en descente', ic: 'down', get: (r) => r.slopes && r.slopes.downKm, fmt: (v) => (v == null ? 'n.c.' : fmtKm(v)), diff: (d) => fmtKm(d) },
      { key: 'rec', label: 'Durée réelle (trace)', ic: 'clock', get: (r) => r.recorded && r.recorded.totalMin, fmt: (v) => (v == null ? 'n.c.' : fmtDur(v)), diff: (d) => fmtDur(d) },
    ];

    function rowHtml(m, a, b) {
      const va = m.get(a), vb = m.get(b);
      if (va == null && vb == null) return '';
      const max = Math.max(va || 0, vb || 0) || 1;
      const w = (v) => (v == null ? 0 : Math.max(2, (v / max) * 100));
      const win = va != null && vb != null && va !== vb ? (va > vb ? 'a' : 'b') : '';
      const d = va != null && vb != null && va !== vb ? Math.abs(va - vb) : null;
      const cell = (side, r, v) => `
        <div class="cmp-row__val cmp-row__val--${side}${win === side ? ' is-more' : ''}">
          <span class="cmp-row__num">${m.fmt(v, r)}</span>${m.sub ? `<small>${esc(m.sub(r))}</small>` : ''}
          <span class="cmp-row__bar" aria-hidden="true"><i style="width:${w(v).toFixed(1)}%"></i></span>
        </div>`;
      return `
        <div class="cmp-row" role="row">
          ${cell('a', a, va)}
          <div class="cmp-row__mid" role="rowheader">
            <span class="cmp-row__label">${icon(m.ic)}${m.label}</span>
            <span class="cmp-row__diff">${d == null ? (va === vb && va != null ? 'Égalité' : '') : `écart ${m.diff(d)}`}</span>
          </div>
          ${cell('b', b, vb)}
        </div>`;
    }

    // Synthèse : la difficulté, puis une phrase par rando avec tout ce qu'elle a « en plus »
    function verdictHtml(a, b) {
      const name = (r) => `<strong class="cmp-name cmp-name--${r === a ? 'a' : 'b'}">${esc(r.name)}</strong>`;
      const lines = [];
      if (a.ibp != null && b.ibp != null) {
        if (a.ibp === b.ibp) lines.push(`Même IBP index (${a.ibp}) : difficulté équivalente.`);
        else {
          const [hi, lo] = a.ibp > b.ibp ? [a, b] : [b, a];
          const lv = (r) => levelLabel(r).toLowerCase();
          lines.push(`${name(hi)} est la plus difficile : IBP ${hi.ibp} contre ${lo.ibp}${hi.level === lo.level ? `, même niveau (${lv(hi)})` : ` (${lv(hi)} contre ${lv(lo)})`}.`);
        }
      }
      const facts = new Map([[a, []], [b, []]]);
      const more = (va, vb, txt, min = 0) => {
        if (va == null || vb == null || Math.abs(va - vb) <= min) return;
        const [hi, vh, vl] = va > vb ? [a, va, vb] : [b, vb, va];
        const p = pct(vh, vl);
        facts.get(hi).push(txt(vh - vl, p != null && Number.isFinite(p) ? ` <span class="cmp-pct">(+${p} %)</span>` : ''));
      };
      more(a.distanceKm, b.distanceKm, (d, p) => `plus longue de ${fmtKm(d)}${p}`, 0.05);
      more(a.dplus, b.dplus, (d, p) => `${fmtM(d)} de D+ en plus${p}`, 5);
      more(a.durationMin, b.durationMin, (d) => `${fmtDur(d)} de marche en plus`, 4);
      const sa = avgSlope(a), sb = avgSlope(b);
      more(sa, sb, () => `plus raide (${nf0.format(Math.max(sa, sb))} m/km contre ${nf0.format(Math.min(sa, sb))})`);
      more(a.altMax, b.altMax, (d) => `monte ${fmtM(d)} plus haut`, 10);
      const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}` : xs[0]);
      for (const [r, xs] of facts) if (xs.length) lines.push(`${name(r)} : ${list(xs)}.`);
      return lines.length ? `<ul class="cmp-verdict">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : '';
    }

    function headHtml(r, side) {
      return `
        <div class="cmp-hero cmp-hero--${side}">
          <div class="cmp-hero__visual">${shapeSvg(r)}<div class="cmp-hero__ibp">${ibpBadge(r)}</div></div>
          <h3 class="cmp-hero__title"><button type="button" class="link-btn" data-cmp-see="${esc(r.id)}" title="Ouvrir la fiche de ${esc(r.name)}">${esc(r.name)}</button></h3>
          <p class="cmp-hero__meta">
            ${placeOf(r) ? `<span>${icon('pin')}${esc(placeOf(r))}</span>` : ''}
            <span>${icon('calendar')}${fmtDate(r.date)}</span>
            <span>${icon(r.loop ? 'loop' : 'arrow')}${r.loop ? 'Boucle' : 'Aller simple'}</span>
          </p>
        </div>`;
    }

    function render() {
      const [a, b] = shown;
      dlg.innerHTML = `
        <div class="cmp__inner">
          <header class="cmp__head">
            <h2 class="cmp__title" id="cmp-title">${icon('vs')}Duel de randos</h2>
            <button type="button" class="btn btn--ghost btn--sm" data-cmp-swap title="Inverser les deux randos" aria-label="Inverser les deux randos">${icon('vs')}<span class="cmp__swap-label">Inverser</span></button>
            <button type="button" class="icon-btn" data-cmp-close aria-label="Fermer le comparateur">${icon('close')}</button>
          </header>
          <div class="cmp__heroes">${headHtml(a, 'a')}<span class="cmp__vs" aria-hidden="true">VS</span>${headHtml(b, 'b')}</div>
          ${verdictHtml(a, b)}
          <section class="cmp-panel" aria-labelledby="cmp-profile-title">
            <h3 class="cmp-panel__title" id="cmp-profile-title">Profils altimétriques superposés</h3>
            <div class="cmp-profile" id="cmp-profile"></div>
            <p class="cmp-legend"><span class="cmp-legend__a">${esc(a.name)}</span><span class="cmp-legend__b">${esc(b.name)}</span></p>
          </section>
          <section class="cmp-panel" aria-labelledby="cmp-table-title">
            <h3 class="cmp-panel__title" id="cmp-table-title">Chiffre par chiffre</h3>
            <div class="cmp-table" role="table" aria-label="Comparaison chiffrée">${METRICS.map((m) => rowHtml(m, a, b)).join('')}</div>
          </section>
        </div>`;
    }

    // Profils sur le même axe des distances et des altitudes
    function renderProfiles() {
      const box = $('#cmp-profile', dlg);
      if (!box) return;
      const [a, b] = shown;
      const pa = a.profile || [], pb = b.profile || [];
      if (pa.length < 2 && pb.length < 2) { box.innerHTML = '<p class="cmp-empty">Pas de profil disponible.</p>'; return; }
      const W = Math.max(280, Math.round(box.clientWidth) || 640), H = 190, L = 40, B = 20, T = 10;
      const total = Math.max(pa.length ? pa[pa.length - 1][0] : 0, pb.length ? pb[pb.length - 1][0] : 0) || 1;
      const eles = [...pa, ...pb].map((p) => p[1]);
      let min = Math.min(...eles), max = Math.max(...eles);
      const pad = Math.max(20, (max - min) * 0.1);
      min = Math.floor((min - pad) / 10) * 10; max = Math.ceil((max + pad) / 10) * 10;
      const x = (d) => L + (d / total) * (W - L - 4);
      const y = (e) => T + (1 - (e - min) / (max - min)) * (H - T - B);
      const path = (p) => (p.length < 2 ? '' : 'M' + p.map((q) => `${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join('L'));
      const area = (p) => (p.length < 2 ? '' : `${path(p)}L${x(p[p.length - 1][0]).toFixed(1)},${H - B}L${L},${H - B}Z`);
      const step = (total > 20 ? 5 : total > 8 ? 2 : 1) * (W < 420 && total > 8 ? 2 : 1);
      const xTicks = [];
      for (let k = 0; k <= total; k += step) xTicks.push(k);
      const yTicks = [min, Math.round((min + max) / 2), max];
      box.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Profils superposés : ${esc(a.name)} et ${esc(b.name)}, sur ${fmtKm(total)}">
          ${yTicks.map((t) => `<line class="cp-grid" x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="cp-axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
          ${xTicks.map((t) => `<text class="cp-axis" x="${x(t)}" y="${H - 4}" text-anchor="middle">${t}</text>`).join('')}
          <path class="cp-area cp-area--a" d="${area(pa)}"/><path class="cp-area cp-area--b" d="${area(pb)}"/>
          <path class="cp-line cp-line--a" d="${path(pa)}"/><path class="cp-line cp-line--b" d="${path(pb)}"/>
          <line class="cp-cursor" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
          <circle class="cp-dot cp-dot--a" r="4" visibility="hidden"/><circle class="cp-dot cp-dot--b" r="4" visibility="hidden"/>
        </svg>
        <div class="cmp-profile__tip" hidden></div>`;
      const svg = $('svg', box), cur = $('.cp-cursor', box), tip = $('.cmp-profile__tip', box);
      const dots = { a: $('.cp-dot--a', box), b: $('.cp-dot--b', box) };
      const near = (p, d) => {
        if (p.length < 2 || d > p[p.length - 1][0]) return null;
        let lo = 0, hi = p.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid][0] < d) lo = mid; else hi = mid; }
        return Math.abs(p[lo][0] - d) < Math.abs(p[hi][0] - d) ? p[lo] : p[hi];
      };
      const move = (clientX) => {
        const rect = svg.getBoundingClientRect();
        const d = Math.max(0, Math.min(total, (((clientX - rect.left) / rect.width) * W - L) / (W - L - 4) * total));
        cur.setAttribute('x1', x(d)); cur.setAttribute('x2', x(d)); cur.setAttribute('visibility', 'visible');
        const parts = [`${nf1.format(d)} km`];
        for (const [side, p] of [['a', pa], ['b', pb]]) {
          const q = near(p, d);
          if (q) { dots[side].setAttribute('cx', x(q[0])); dots[side].setAttribute('cy', y(q[1])); dots[side].setAttribute('visibility', 'visible'); }
          else dots[side].setAttribute('visibility', 'hidden');
          parts.push(`<span class="cmp-profile__tip-${side}">${q ? `${nf0.format(q[1])} m` : 'arrivée'}</span>`);
        }
        tip.hidden = false;
        tip.style.left = `${(x(d) / W) * 100}%`;
        tip.innerHTML = parts.join(' · ');
      };
      const leave = () => { cur.setAttribute('visibility', 'hidden'); tip.hidden = true; for (const d of Object.values(dots)) d.setAttribute('visibility', 'hidden'); };
      svg.addEventListener('pointermove', (e) => move(e.clientX));
      svg.addEventListener('pointerdown', (e) => move(e.clientX));
      svg.addEventListener('pointerleave', leave);
    }

    function open(ids = picked) {
      const rs = ids.map(getR).filter(Boolean);
      if (rs.length < 2) return;
      shown = rs.slice(0, 2);
      render();
      if (!dlg.open) dlg.showModal();
      dlg.scrollTop = 0;
      renderProfiles();
      $('[data-cmp-close]', dlg).focus();
      onChange && onChange();
    }
    function close() { if (dlg.open) dlg.close(); }
    dlg.addEventListener('close', () => { shown = null; onChange && onChange(); });

    let rz;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (shown) renderProfiles(); }, 150); });

    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-cmp-close]')) { close(); return; }
      if (e.target.closest('[data-cmp-swap]')) {
        shown = [shown[1], shown[0]];
        if (picked.length === 2 && shown.every((r) => has(r.id))) { picked = shown.map((r) => r.id); save(); paint(); }
        render(); renderProfiles(); onChange && onChange();
        return;
      }
      const see = e.target.closest('[data-cmp-see]');
      if (see) { close(); ctx.openDetail(see.dataset.cmpSee); }
    });

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-cmp]');
      if (t) { e.preventDefault(); e.stopPropagation(); toggle(t.dataset.cmp); return; }
      const d = e.target.closest('[data-cmp-detail]');
      if (d) {
        const id = d.dataset.cmpDetail;
        const wasIn = has(id);
        toggle(id);
        // Depuis une fiche : si c'est la 2e rando, on passe directement au duel
        if (!wasIn && picked.length === 2) { ctx.closeDetail(); open(); }
        return;
      }
      const rm = e.target.closest('[data-cmp-remove]');
      if (rm) { remove(rm.dataset.cmpRemove); return; }
      if (e.target.closest('[data-cmp-clear]')) { clear(); return; }
      if (e.target.closest('[data-cmp-open]')) open();
    }, true);

    paint();
    return {
      cardButton, detailButton, paint, open, close, has,
      // Pour l'URL partageable « #vs=id1,id2 »
      hashIds: () => (shown ? shown.map((r) => r.id) : null),
      openFromHash(ids) {
        if (!ids || ids.length < 2 || !ids.every(getR)) return;
        picked = ids.slice(0, 2); save(); paint(); open();
      },
      isOpen: () => dlg.open,
    };
  };
})();
