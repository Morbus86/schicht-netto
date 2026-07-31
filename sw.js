// Service Worker v3 – Netzwerk-first für die Seite (online immer frisch),
// Cache-first für Assets, Offline-Fallback aus Cache.
const CACHE = "schicht-netto-v3";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const req = e.request;
  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isHTML) {
    // Netzwerk-first: online stets aktuell, offline aus Cache
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    );
  } else {
    // Assets: cache-first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
