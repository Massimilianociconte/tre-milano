import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const astroDir = path.join(distDir, '_astro');
const assetFiles = (await readdir(astroDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => `/_astro/${entry.name}`)
  .sort();

const shell = [
  '/',
  '/cerca/',
  '/milano/',
  '/preferiti/',
  '/profilo/',
  '/metodologia/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable.svg',
  '/images/hero-milano.webp',
  '/images/galleria-milano.webp',
  '/images/venue-cocktail.webp',
  '/images/venue-navigli.webp',
  '/images/venue-ristorante.webp',
  ...assetFiles,
];
const versionHash = createHash('sha256');
for (const resource of shell) {
  const relativePath = resource === '/'
    ? 'index.html'
    : resource.endsWith('/')
      ? path.join(resource.slice(1), 'index.html')
      : resource.slice(1);
  versionHash.update(resource);
  versionHash.update(await readFile(path.join(distDir, relativePath)));
}
const version = versionHash.digest('hex').slice(0, 12);

const source = `const CACHE = 'tre-milano-shell-${version}';
const SHELL = ${JSON.stringify(shell, null, 2)};
const NETWORK_ONLY_PATHS = ['/api/'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('tre-milano-shell-') && key !== CACHE).map((key) => caches.delete(key)),
    )),
  );
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
        .catch(async () => (await caches.match(event.request, { ignoreSearch: true })) || caches.match('/')),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && response.type === 'basic') {
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())));
      }
      return response;
    })),
  );
});
`;

await writeFile(path.join(distDir, 'sw.js'), source, 'utf8');
console.log(`Service worker: ${shell.length} risorse precache, cache ${version}.`);
