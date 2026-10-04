const CACHE = 'ledgerly-shell-v6-signature';
const SHELL = ['./', './index.html', './Personal_Debt_Dashboard.html', './ledgerly_update.html', './manifest.webmanifest', './logo.svg'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/auth/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    if (requestUrl.origin === self.location.origin) caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))));
});
