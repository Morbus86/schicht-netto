/* Dienstplan PWA — Service Worker
 * HTML: network-first  (verhindert alte Versionen nach einem Update)
 * Statisches: cache-first
 * Backend-Aufrufe (POST / fremde Domain) werden nie angefasst.
 */
const VERSION = 'dienstplan-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // Nur eigene GET-Anfragen cachen. POST an das Backend bleibt unberuehrt.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const wantsHtml = req.mode === 'navigate' ||
                    (req.headers.get('accept') || '').includes('text/html');

  if (wantsHtml) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }))
  );
});
