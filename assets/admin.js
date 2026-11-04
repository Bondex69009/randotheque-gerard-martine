/* Randothèque – interface d'administration */
(() => {
  'use strict';

  const TOKEN = location.pathname.split('/').filter(Boolean)[1];
  const API = `/api/${encodeURIComponent(TOKEN)}`;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const PAGE = 60;

  const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const df = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDate = (d) => { try { return df.format(new Date(d.length === 10 ? d + 'T12:00:00' : d)); } catch { return d || ''; } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const LEVELS = { vert: 'Très facile', bleu: 'Facile', jaune: 'Moyen', rouge: 'Difficile', noir: 'Très difficile' };

  let randos = [];
  let trash = [];
  let tab = 'visible';
  let shown = PAGE;

  // ------------------------------------------------------------ API
  async function call(method, url, body, headers = {}) {
    const res = await fetch(API + url, {
      method,
      headers: body && !(body instanceof Blob) ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  async function load() {
    try {
      const data = await call('GET', '/randos');
      randos = data.randos;
      trash = data.trash || [];
      if (data.job && data.job.running) watchSync();
      render();
    } catch (e) {
      $('#rows').innerHTML = `<tr><td colspan="7" class="rtable__empty">Impossible de charger les randos : ${esc(e.message)}</td></tr>`;
    }
  }

  // ------------------------------------------------------------ Notifications
  function toast(text, { error = false, action } = {}) {
    const el = document.createElement('div');
    el.className = `toast${error ? ' toast--error' : ''}`;
    el.setAttribute('role', error ? 'alert' : 'status');
    el.innerHTML = `${icon(error ? 'close' : 'check')}<span class="toast__text">${esc(text)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--outline btn--sm';
      b.textContent = action.label;
      b.addEventListener('click', () => { el.remove(); action.run(); });
      el.appendChild(b);
    }
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), action ? 9000 : 5000);
  }

  // ------------------------------------------------------------ Liste
  const inTab = (r) => (tab === 'visible' ? !r.hidden : tab === 'hidden' ? r.hidden : tab === 'edited' ? r.edited : false);
  const matchesQ = (r) => {
    const q = norm($('#admin-q').value.trim());
    if (!q) return true;
    const hay = norm([r.name, r.commune, r.deptName, r.animateurs, r.date, r.file].join(' '));
    return q.split(/\s+/).every((t) => hay.includes(t));
  };

  function ibpCell(r) {
    if (r.ibp == null) return '<span class="origin">n.c.</span>';
    const src = { blog: 'publié sur le blog', manuel: 'saisi à la main', fichier: 'fichier JSON', estime: 'estimé' }[r.ibpSource] || '';
    return `<span class="ibp ibp--${r.level}" title="IBP ${src}"><span class="ibp__num">${r.ibpSource === 'estime' ? '≈' : ''}${r.ibp}</span>${LEVELS[r.level] || ''}</span>`;
  }

  function rowHtml(r) {
    const place = [r.commune, r.deptCode ? `(${r.deptCode})` : r.deptName].filter(Boolean).join(' ');
    const actions = r.hidden
      ? `<button type="button" class="btn btn--outline btn--sm btn-icon-label" data-restore="${r.id}">${icon('eye')}Réafficher</button>`
      : `<button type="button" class="btn btn--outline btn--sm btn-icon-label" data-edit="${r.id}" aria-label="Modifier ${esc(r.name)}">${icon('edit')}Modifier</button>
         <button type="button" class="btn btn--danger-ghost btn--sm btn-icon-label" data-delete="${r.id}" aria-label="Supprimer ${esc(r.name)}">${icon('trash')}Supprimer</button>`;
    return `<tr>
      <td>
        <a class="rtable__name" href="/#rando=${r.id}" target="_blank" rel="noopener">${esc(r.name)}</a>${r.edited ? '<span class="mark" title="Informations corrigées à la main">✎ modifiée</span>' : ''}
        <span class="rtable__sub">${[place, fmtDate(r.date)].filter(Boolean).map(esc).join(' · ')}</span>
      </td>
      <td class="num" data-label="Distance">${nf1.format(r.distanceKm)} km</td>
      <td class="num" data-label="D+">${r.dplus == null ? 'n.c.' : nf0.format(r.dplus) + ' m'}</td>
      <td>${ibpCell(r)}</td>
      <td data-label="Itinéraire">${esc(r.animateurs || '')}</td>
      <td><span class="origin">${r.source !== 'perso' ? 'Blog' : 'Ajoutée'}</span></td>
      <td class="rtable__cell-actions"><div class="rtable__actions">${actions}</div></td>
    </tr>`;
  }

  function trashRowHtml(t) {
    return `<tr>
      <td><span class="rtable__name">${esc(t.name)}</span><span class="rtable__sub">${esc(t.original.split('/').pop())} · supprimée le ${fmtDate(t.deletedAt)}</span></td>
      <td class="num"></td><td class="num"></td><td></td><td></td>
      <td><span class="origin">Ajoutée</span></td>
      <td class="rtable__cell-actions"><div class="rtable__actions">
        <button type="button" class="btn btn--outline btn--sm btn-icon-label" data-untrash="${t.id}">${icon('undo')}Restaurer</button>
      </div></td>
    </tr>`;
  }

  function render() {
    const counts = {
      visible: randos.filter((r) => !r.hidden).length,
      edited: randos.filter((r) => r.edited).length,
      hidden: randos.filter((r) => r.hidden).length,
      trash: trash.length,
    };
    for (const el of $$('[data-tabcount]')) el.textContent = counts[el.dataset.tabcount];
    for (const b of $$('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));

    const rows = $('#rows');
    if (tab === 'trash') {
      const list = trash.filter((t) => matchesQ({ name: t.name, file: t.original }));
      $('#list-title').textContent = `Corbeille (${list.length})`;
      rows.innerHTML = list.length ? list.map(trashRowHtml).join('')
        : '<tr><td colspan="7" class="rtable__empty">La corbeille est vide. Les randos ajoutées puis supprimées apparaissent ici.</td></tr>';
      $('#more-wrap').hidden = true;
      return;
    }
    const list = randos.filter((r) => inTab(r) && matchesQ(r));
    const titles = { visible: 'Randos en ligne', edited: 'Randos modifiées', hidden: 'Randos masquées' };
    $('#list-title').textContent = `${titles[tab]} (${list.length})`;
    const empty = {
      visible: 'Aucune rando ne correspond à la recherche.',
      edited: "Aucune rando n'a été corrigée pour l'instant.",
      hidden: 'Aucune rando masquée. Les randos du blog supprimées apparaissent ici.',
    };
    rows.innerHTML = list.length ? list.slice(0, shown).map(rowHtml).join('')
      : `<tr><td colspan="7" class="rtable__empty">${empty[tab]}</td></tr>`;
    $('#more-wrap').hidden = list.length <= shown;
  }

  // ------------------------------------------------------------ Modification
  const FIELDS = [
    { key: 'name', label: 'Nom de la rando', type: 'text', wide: true, required: true },
    { key: 'date', label: 'Date', type: 'date', hint: 'Date de la sortie ou de création de la trace.' },
    { key: 'commune', label: 'Commune de départ', type: 'text' },
    { key: 'animateurs', label: 'Itinéraire (GR)', type: 'text', placeholder: 'GR 65', hint: 'Plusieurs itinéraires : séparez-les par un tiret (GR 65 - GR 70).' },
    { key: 'ibp', label: 'IBP index', type: 'number', inputmode: 'numeric', min: 1, max: 399 },
    { key: 'description', label: 'Description', type: 'textarea', wide: true },
  ];
  const dlg = $('#edit-dialog');
  let editing = null;

  function origText(f, r) {
    const v = r.orig ? r.orig[f.key] : null;
    if (v == null || v === '') return f.key === 'ibp' ? 'aucune (IBP estimé automatiquement)' : 'vide';
    return f.key === 'date' ? fmtDate(v) : String(v);
  }

  function openEdit(id, { fresh = false } = {}) {
    const r = randos.find((x) => x.id === id);
    if (!r) return;
    editing = r;
    $('#edit-title').textContent = fresh ? 'Compléter la nouvelle rando' : 'Modifier la rando';
    $('#edit-sub').innerHTML = `<span>${esc(r.file.split('/').pop())}</span><a href="/#rando=${r.id}" target="_blank" rel="noopener">Voir la fiche sur le site</a>`;
    const fieldHtml = FIELDS.map((f) => {
      const id = `f-${f.key}`;
      let value = r[f.key] ?? '';
      if (f.key === 'ibp' && r.ibpSource === 'estime') value = '';
      const changed = r.orig && String(r[f.key] ?? '') !== String(r.orig[f.key] ?? '') && !(f.key === 'ibp' && r.ibpSource !== 'manuel');
      const hint = f.key === 'ibp'
        ? (r.ibpSource === 'estime' ? `Laissez vide pour garder l'estimation automatique (≈ ${r.ibp}).` : "Laissez vide pour utiliser la valeur d'origine.")
        : f.hint || '';
      const common = `id="${id}" name="${f.key}" ${f.required ? 'required aria-required="true"' : ''} aria-describedby="${id}-hint ${id}-err"`;
      const control = f.type === 'textarea'
        ? `<textarea ${common} rows="4">${esc(value)}</textarea>`
        : `<input ${common} type="${f.type}" value="${esc(value)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}
            ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.min ? `min="${f.min}" max="${f.max}"` : ''} autocomplete="off">`;
      return `<div class="field${f.wide ? ' field--wide' : ''}">
        <label class="field__label" for="${id}">${f.label}${changed ? '<span class="mark">✎ modifié</span>' : ''}</label>
        ${control}
        ${hint ? `<p class="field__hint" id="${id}-hint">${esc(hint)}</p>` : `<span id="${id}-hint" hidden></span>`}
        ${changed ? `<p class="field__orig">D'origine : ${esc(origText(f, r))} <button type="button" class="link-btn" data-reset="${f.key}">Rétablir</button></p>` : ''}
        <p class="field-error" id="${id}-err" hidden></p>
      </div>`;
    }).join('');
    const ro = `<div class="readonly">
      <span>Distance <strong>${nf1.format(r.distanceKm)} km</strong></span>
      <span>D+ <strong>${r.dplus == null ? 'n.c.' : nf0.format(r.dplus) + ' m'}</strong></span>
      <span>Origine <strong>${r.source !== 'perso' ? 'blog' : 'ajoutée ici'}</strong></span>
      ${r.blogUrl ? `<a href="${esc(r.blogUrl)}" target="_blank" rel="noopener">Article du blog</a>` : ''}
    </div>`;
    $('#edit-fields').innerHTML = ro + fieldHtml;
    $('#edit-error').hidden = true;
    if (!dlg.open) dlg.showModal();
    $('#f-name').focus();
  }

  $('#edit-fields').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reset]');
    if (!b || !editing) return;
    const k = b.dataset.reset;
    const input = $(`#f-${k}`);
    input.value = k === 'ibp' ? '' : editing.orig[k] ?? '';
    b.closest('.field__orig').textContent = 'Valeur d\'origine rétablie (pensez à enregistrer).';
    input.focus();
  });

  function validate(form) {
    let ok = true;
    const setErr = (key, msg) => {
      const input = $(`#f-${key}`), err = $(`#f-${key}-err`);
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      err.hidden = !msg; err.textContent = msg || '';
      if (msg && ok) { input.focus(); ok = false; }
    };
    setErr('name', form.name.value.trim() ? '' : 'Le nom est obligatoire.');
    const ibp = form.ibp.value.trim();
    setErr('ibp', !ibp || (Number(ibp) >= 1 && Number(ibp) <= 399) ? '' : "L'IBP doit être un nombre entre 1 et 399.");
    setErr('date', !form.date.value || /^\d{4}-\d{2}-\d{2}$/.test(form.date.value) ? '' : 'Date invalide.');
    return ok;
  }

  $('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!editing || !validate(form)) return;
    const body = Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key].value]));
    const btn = $('#edit-submit');
    btn.disabled = true; btn.textContent = 'Enregistrement…';
    try {
      await call('PATCH', `/randos/${editing.id}`, body);
      dlg.close();
      toast('Modifications enregistrées. Elles sont visibles sur le site.');
      await load();
    } catch (err) {
      $('#edit-error').hidden = false;
      $('#edit-error').textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Enregistrer les modifications';
    }
  });

  for (const d of [dlg, $('#confirm-dialog')]) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }

  // ------------------------------------------------------------ Suppression / restauration
  const confirmDlg = $('#confirm-dialog');
  let pendingDelete = null;
  function askDelete(id) {
    const r = randos.find((x) => x.id === id);
    if (!r) return;
    pendingDelete = r;
    $('#confirm-title').textContent = `Supprimer « ${r.name} » ?`;
    $('#confirm-text').textContent = r.source !== 'perso'
      ? "Cette rando vient du blog : elle sera retirée du site mais restera sur le blog. Vous pourrez la réafficher depuis l'onglet « Masquées »."
      : "La rando sera retirée du site et son fichier GPX placé dans la corbeille. Vous pourrez la restaurer depuis l'onglet « Corbeille ».";
    confirmDlg.showModal();
    $('[data-close]', confirmDlg).focus();
  }
  $('#confirm-ok').addEventListener('click', async () => {
    const r = pendingDelete;
    if (!r) return;
    const btn = $('#confirm-ok');
    btn.disabled = true; btn.textContent = 'Suppression…';
    try {
      await call('DELETE', `/randos/${r.id}`);
      confirmDlg.close();
      await load();
      toast(`« ${r.name} » a été retirée du site.`, {
        action: r.source !== 'perso'
          ? { label: 'Annuler', run: () => restore(r.id) }
          : { label: 'Voir la corbeille', run: () => setTab('trash') },
      });
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      btn.disabled = false; btn.textContent = 'Supprimer';
    }
  });

  async function restore(id) {
    try {
      await call('POST', `/randos/${id}/restore`);
      await load();
      toast('La rando est de nouveau en ligne.');
    } catch (e) { toast(e.message, { error: true }); }
  }
  async function untrash(id) {
    try {
      await call('POST', `/trash/${id}/restore`);
      await load();
      toast('La rando a été restaurée et remise en ligne.');
    } catch (e) { toast(e.message, { error: true }); }
  }

  // ------------------------------------------------------------ Ajout de GPX
  const dz = $('#dropzone');
  const input = $('#file-input');
  async function uploadFiles(files) {
    const list = [...files].filter((f) => f.size);
    if (!list.length) return;
    let last = null;
    for (const file of list) {
      const li = document.createElement('li');
      li.className = 'upload-item';
      li.innerHTML = `<span class="upload-item__name">${esc(file.name)}</span><span class="upload-item__status">Envoi et analyse…</span>`;
      $('#upload-list').prepend(li);
      const status = $('.upload-item__status', li);
      if (!/\.gpx$/i.test(file.name)) {
        li.classList.add('upload-item--error');
        status.textContent = 'Ce n\'est pas un fichier .gpx';
        continue;
      }
      try {
        const { rando } = await call('POST', '/upload', file, { 'X-Filename': encodeURIComponent(file.name) });
        li.classList.add('upload-item--ok');
        status.textContent = `Ajoutée : ${nf1.format(rando.distanceKm)} km, ${rando.dplus ?? '?'} m D+`;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn--outline btn--sm'; b.textContent = 'Compléter les infos';
        b.dataset.edit = rando.id; b.dataset.fresh = '1';
        li.appendChild(b);
        last = rando;
      } catch (e) {
        li.classList.add('upload-item--error');
        status.textContent = e.message;
      }
    }
    await load();
    if (last && list.length === 1) openEdit(last.id, { fresh: true });
  }
  input.addEventListener('change', () => { uploadFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('is-over')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); });
  // Empêche le navigateur d'ouvrir un fichier lâché à côté de la zone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // ------------------------------------------------------------ Synchronisation avec le blog
  let syncTimer = null;
  async function watchSync() {
    const btn = $('#sync-btn');
    btn.disabled = true;
    $('span', btn).textContent = 'Synchronisation en cours…';
    $('svg', btn).classList.add('spin');
    $('#sync-status').textContent = "Lecture du blog et téléchargement des nouveaux GPX. Cela peut prendre une à deux minutes.";
    $('#sync-log-box').hidden = false;
    clearInterval(syncTimer);
    syncTimer = setInterval(async () => {
      try {
        const job = await call('GET', '/sync');
        $('#sync-log').textContent = job.log || '';
        if (job.running) return;
        clearInterval(syncTimer);
        btn.disabled = false;
        $('span', btn).textContent = 'Synchroniser avec le blog';
        $('svg', btn).classList.remove('spin');
        $('#sync-status').textContent = job.ok
          ? `Synchronisation terminée le ${fmtDate(job.finishedAt)} à ${new Date(job.finishedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`
          : 'La synchronisation a échoué. Consultez le détail ci-dessous.';
        toast(job.ok ? 'Blog synchronisé.' : 'La synchronisation a échoué.', { error: !job.ok });
        load();
      } catch { /* on réessaie au prochain tour */ }
    }, 2000);
  }
  $('#sync-btn').addEventListener('click', async () => {
    try { await call('POST', '/sync'); } catch (e) { if (!/409|cours/.test(e.message)) { toast(e.message, { error: true }); return; } }
    watchSync();
  });

  // ------------------------------------------------------------ Événements
  function setTab(t) { tab = t; shown = PAGE; render(); $('#liste').focus({ preventScroll: false }); }
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; shown = PAGE; render(); }));
  let qTimer;
  $('#admin-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { shown = PAGE; render(); }, 120); });
  $('#more-btn').addEventListener('click', () => { shown += PAGE; render(); });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-edit],[data-delete],[data-restore],[data-untrash]');
    if (!t) return;
    if (t.dataset.edit) openEdit(t.dataset.edit, { fresh: !!t.dataset.fresh });
    else if (t.dataset.delete) askDelete(t.dataset.delete);
    else if (t.dataset.restore) restore(t.dataset.restore);
    else if (t.dataset.untrash) untrash(t.dataset.untrash);
  });

  load();
})();
