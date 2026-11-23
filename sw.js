// Offline základ hry. Vlastní soubory: nejdřív síť (ať se hned projeví úpravy), jinak uložená kopie.
const CACHE = 'lovci-v8';
const ZAKLAD = ['./', 'index.html', 'styl.css?v=8', 'hra.js?v=8', 'samolepky.js?v=8', 'manifest.webmanifest', 'ikony/ikona-192.png',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ZAKLAD)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { const k = r.clone(); caches.open(CACHE).then(c => c.put(e.request, k)); return r; }).catch(() => caches.match(e.request)));
  } else if (u.hostname === 'unpkg.com') {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
