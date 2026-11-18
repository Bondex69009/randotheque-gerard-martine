/* Randothèque – mesure d'audience maison, sans cookie ni stockage dans le navigateur.
   Rien n'est écrit sur l'appareil du visiteur ; l'adresse IP n'est jamais enregistrée par le serveur.
   Les autres scripts signalent une action avec window.rtStat('gpx', 'Nom de la rando', 'id'). */
(function () {
  'use strict';
  var me = document.currentScript;
  var noop = function () {};
  window.rtStat = noop;
  if (!me || !window.fetch || !window.JSON || !window.URLSearchParams) return;

  // Serveur de statistiques (hébergement PHP, dossier stats-serveur/ du dépôt rando-theque).
  var PROD = 'https://randotheque.anthony-bondon.fr/stats/api.php';
  var DEV = 'http://localhost:8099/api.php'; // php -S localhost:8099 -t stats-serveur
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var END = me.getAttribute('data-endpoint') || (local ? DEV : PROD);
  var SITE = me.getAttribute('data-site');
  if (!END || !SITE) return;

  // Robots et navigateurs pilotés par un programme : rien n'est envoyé.
  var n = navigator, d = document, ua = n.userAgent || '';
  if (n.webdriver || /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|prerender|phantom|selenium|puppeteer|playwright|electron/i.test(ua)) return;
  if (!/^Mozilla\/5\.0 \(/.test(ua)) return;

  function send(data, beacon) {
    data.s = SITE;
    var body = JSON.stringify(data);
    if (beacon && n.sendBeacon) {
      try { if (n.sendBeacon(END + '?a=collect', new Blob([body], { type: 'text/plain' }))) return null; } catch (e) { /* repli fetch */ }
    }
    return fetch(END + '?a=collect', {
      method: 'POST', body: body, keepalive: true, credentials: 'omit', mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Compteur intégré au blog : un simple affichage, sans visite.
  if (me.hasAttribute('data-widget')) {
    send({ t: 'wd', tc: n.maxTouchPoints || 0 });
    return;
  }

  var q = new URLSearchParams(location.search);
  var h = new URLSearchParams(location.hash.slice(1));
  var utm = {
    source: q.get('utm_source') || q.get('ref') || '',
    medium: q.get('utm_medium') || '',
    campaign: q.get('utm_campaign') || '',
    gclid: q.has('gclid') || q.has('gbraid') || q.has('wbraid') ? 1 : 0,
    msclkid: q.has('msclkid') ? 1 : 0,
    fbclid: q.has('fbclid') ? 1 : 0,
  };
  // Porte d'entrée de la visite (le site tient en une page : la suite est dans l'adresse après #)
  var landing = h.get('rando') ? 'fiche' : h.get('vs') ? 'vs' : h.get('q') ? 'recherche'
    : h.get('view') === 'map' ? 'carte' : Array.from(h.keys()).length ? 'filtres' : 'accueil';
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || n.standalone === true;
  var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;

  // Les actions attendent la réponse de la page vue (sinon le serveur ne saurait pas à quelle visite les rattacher).
  var hit = null, ready = false, queue = [];
  var shown = 0, since = 0;
  function startClock() { since = d.visibilityState === 'visible' ? Date.now() : 0; }
  function stopClock() { if (since) { shown += Date.now() - since; since = 0; } }

  function flush() { ready = true; var list = queue; queue = []; list.forEach(function (x) { send(x, true); }); }
  function pageview() {
    shown = 0; startClock();
    var r = send({
      t: 'pv', r: d.referrer, u: utm, lg: standalone ? 'appli' : landing, id: h.get('rando') || h.get('vs') || '',
      tc: n.maxTouchPoints || 0, w: screen.width || 0, lang: (n.languages && n.languages[0]) || n.language || '',
      th: dark ? 'dark' : 'light', a: standalone ? 1 : 0,
    });
    if (!r) { flush(); return; }
    r.then(function (res) { return res.status === 200 ? res.json() : null; })
      .then(function (j) { hit = j; flush(); }, flush);
  }

  function ping() {
    stopClock();
    if (hit && hit.id) send({ t: 'ping', id: hit.id, k: hit.k, d: Math.round(shown / 1000) }, true);
  }
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') ping(); else startClock(); });
  addEventListener('pagehide', ping);

  // Une même action répétée dans la seconde (double clic) n'est comptée qu'une fois.
  var lastKey = '', lastAt = 0;
  window.rtStat = function (event, label, id) {
    var key = event + '|' + (id || label || '');
    var now = Date.now();
    if (key === lastKey && now - lastAt < 1000) return;
    lastKey = key; lastAt = now;
    var data = { t: 'ev', e: String(event), l: String(label || '').slice(0, 200), id: String(id || '').slice(0, 120) };
    if (ready) send(data, true); else queue.push(data);
  };

  // Liens vers d'autres sites, et installation de l'appli.
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (/^https?:$/.test(url.protocol) && url.host !== location.host) window.rtStat('outbound', url.host.replace(/^www\./, ''));
  }, true);
  addEventListener('appinstalled', function () { window.rtStat('install', 'Appli installée'); });

  if (d.prerendering) d.addEventListener('prerenderingchange', pageview, { once: true });
  else pageview();
})();
