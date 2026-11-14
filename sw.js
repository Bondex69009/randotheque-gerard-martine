/* Randothèque – service worker : permet d'installer le site comme une appli et de rouvrir
   les pages déjà consultées sans réseau. Toujours le réseau d'abord (les données changent souvent),
   la copie locale seulement en secours. Les fonds de carte et polices (autres sites) ne sont pas gardés. */
const CACHE = 'randotheque-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Seulement les adresses http(s) du site : jamais les blob: et data: (ex. les « workers » de la carte 3D,
  // qui ne doivent pas passer par ici), ni les fonds de carte et polices d'autres sites
  if (req.method !== 'GET' || !/^https?:$/.test(url.protocol) || url.origin !== self.location.origin) return;
  // Requêtes de scripts de « workers » : laissées au navigateur
  if (req.destination === 'worker' || req.destination === 'sharedworker') return;
  // Fichiers lourds (GPX, audio) : réseau seul
  if (/\.(gpx|mp3|m4a|ogg|wav)$/i.test(url.pathname)) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))),
  );
});
