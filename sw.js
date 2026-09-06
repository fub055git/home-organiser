// Service worker. Everything is precached: after the first load the app never
// needs the network again.
//
// This file lives at the project root on purpose. A worker's default scope is
// the directory it is served from, so a worker in src/ could only intercept
// requests under src/ -- it has to sit at the root to control the whole app.
//
// Two traps this avoids:
//   1. A stale index.html pinned forever. CACHE is versioned, old caches are
//      deleted on activate, and clients.claim() takes over immediately.
//   2. Absolute paths. Every URL is resolved relative to the worker's own
//      scope, so the app still works if it is served from a subpath.
//
// Note what is NOT here: IndexedDB. The Cache API holds code and assets only.
// Bumping CACHE ships new code and leaves every item, location and photo
// untouched.

const CACHE = 'home-organiser-v13';

const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/app.js',
  'src/pwa.js',
  'src/store.js',
  'src/schema.js',
  'src/backup.js',
  'src/tree.js',
  'src/ui.js',
  'src/locations.js',
  'src/categories.js',
  'src/items.js',
  'src/find.js',
  'src/tips.js',
  'src/review.js',
  'src/suggestions.js',
  'src/photo.js',
  'src/settings.js',
].map((p) => new URL(p, self.registration.scope).toString());

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is all-or-nothing; add individually so one missing optional asset
    // cannot leave the app with no cache at all.
    await Promise.all(ASSETS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the shell from cache, refresh it in the background.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const shell = new URL('index.html', self.registration.scope).toString();
      const cache = await caches.open(CACHE);
      const cached = await cache.match(shell);
      const network = fetch(req)
        .then((res) => { if (res.ok) cache.put(shell, res.clone()); return res; })
        .catch(() => null);
      return cached || (await network) || new Response('Offline', { status: 503 });
    })());
    return;
  }

  // Everything else: cache first, revalidate in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => null);
    return cached || (await network) || new Response('Offline', { status: 503 });
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
