// Fallback sorgente. La build sostituisce questo file con una versione che
// include automaticamente tutti gli asset hashed prodotti da Astro.
const CACHE = 'tre-milano-shell-v4-fallback';
const SHELL = ['/', '/cerca/', '/milano/', '/preferiti/', '/profilo/', '/metodologia/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable.svg', '/images/hero-milano.webp', '/images/galleria-milano.webp', '/images/venue-cocktail.webp', '/images/venue-navigli.webp', '/images/venue-ristorante.webp'];
const NETWORK_ONLY_PATHS = ['/api/'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('tre-milano-shell-') && key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (NETWORK_ONLY_PATHS.some((path) => url.pathname.startsWith(path))) {
    event.respondWith(fetch(event.request));
    return;
  }

  const isSearchShellNavigation = event.request.mode === 'navigate'
    && (url.pathname === '/cerca' || url.pathname.startsWith('/cerca/'));
  if (isSearchShellNavigation) {
    event.respondWith(
      fetch(event.request).catch(async () => (
        (await caches.match('/cerca/', { ignoreSearch: true })) || caches.match('/')
      )),
    );
    return;
  }

  // Le altre URL con query restano network-only: nessun parametro personale
  // viene usato come chiave o risposta in Cache Storage.
  if (url.search) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())));
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || caches.match('/')),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') {
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())));
        }
        return response;
      });
    }),
  );
});
