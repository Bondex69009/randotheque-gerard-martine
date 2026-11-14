/* Randothèque – bouton « Installer l'appli » (sur téléphone et tablette).
   Android / Chrome / Edge / Samsung : la fenêtre d'installation du navigateur.
   iPhone / iPad (Safari) : pas d'installation automatique possible, on montre les 2 gestes à faire.
   Le bouton n'apparaît pas si le site est déjà ouvert comme une appli installée. */
(() => {
  'use strict';
  const btn = document.getElementById('install-app');
  // Service worker (nécessaire à l'installation ; ignoré si ouvert en fichier local)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  if (!btn) return;

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !/Android/.test(ua)); // iPad récent : se présente comme un Mac
  const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const appName = btn.dataset.appName || document.title;
  let deferred = null;

  const show = () => { btn.hidden = false; };
  const hide = () => { btn.hidden = true; };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // on garde la fenêtre du navigateur pour le clic sur notre bouton
    deferred = e;
    if (touch) show();
  });
  window.addEventListener('appinstalled', () => { deferred = null; hide(); });

  // iPhone / iPad : bouton tout de suite. Autres mobiles sans fenêtre d'installation : bouton + explications.
  if (ios) show();
  else if (touch) setTimeout(() => { if (!deferred) show(); }, 2500);

  // ------------------------------------------------------------ Explications (iOS, ou navigateur sans installation directe)
  const shareIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0-12-4 4m4-4 4 4M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const plusIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const dotsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="19" r="1.8" fill="currentColor"/></svg>';
  function helpDialog() {
    let d = document.getElementById('install-help');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'install-help';
      d.className = 'install-help';
      d.setAttribute('aria-labelledby', 'install-help-title');
      d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-install-close]')) d.close(); });
      document.body.appendChild(d);
    }
    const steps = ios
      ? `<li><span class="install-help__ico">${shareIcon}</span><span>Touchez le bouton <strong>Partager</strong> de Safari (en bas de l'écran sur iPhone, en haut sur iPad).</span></li>
         <li><span class="install-help__ico">${plusIcon}</span><span>Faites défiler et choisissez <strong>Sur l'écran d'accueil</strong>, puis <strong>Ajouter</strong>.</span></li>`
      : `<li><span class="install-help__ico">${dotsIcon}</span><span>Ouvrez le <strong>menu du navigateur</strong> (les trois points ⋮).</span></li>
         <li><span class="install-help__ico">${plusIcon}</span><span>Choisissez <strong>Installer l'application</strong> ou <strong>Ajouter à l'écran d'accueil</strong>.</span></li>`;
    d.innerHTML = `
      <div class="install-help__inner">
        <img class="install-help__icon" src="assets/icon-192.png" width="64" height="64" alt="">
        <h2 class="install-help__title" id="install-help-title">Installer ${appName.replace(/[<>&]/g, '')}</h2>
        <p class="install-help__lead">L'appli s'ouvre en plein écran depuis votre écran d'accueil, comme une application.</p>
        <ol class="install-help__steps">${steps}</ol>
        ${ios && !/Safari/.test(ua) ? '<p class="install-help__note">Sur iPhone, l\'installation se fait depuis <strong>Safari</strong> : ouvrez cette page dans Safari.</p>' : ''}
        <button type="button" class="btn btn--primary btn--block" data-install-close>J'ai compris</button>
      </div>`;
    d.showModal();
  }

  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({}));
      deferred = null;
      if (outcome === 'accepted') hide();
      return;
    }
    helpDialog();
  });
})();
