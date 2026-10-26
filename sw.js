const CACHE = "lista-compras-v4";
const ARQUIVOS = ["./", "./index.html", "./manifest.json", "./icon.svg", "./logo.jpg", "./icon-192.png", "./icon-512.png", "./estoque.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("lista-compras-") && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  if (new URL(e.request.url).pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && ARQUIVOS.some(f => new URL(f,self.registration.scope).href === e.request.url)) {
      const copy = r.clone();
      e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)));
    }
    return r;
  }).catch(async error => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    throw error;
  }));
});
