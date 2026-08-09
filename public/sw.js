const CACHE = 'atlas-shell-v3';

const CORE_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE_SHELL))
  );

  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names =>
        Promise.all(
          names
            .filter(name =>
              name.startsWith('roam-shell-') ||
              (
                name.startsWith('atlas-shell-') &&
                name !== CACHE
              )
            )
            .map(name => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // Region assets are exclusively managed by RegionDownloader.
  // Never intercept them here.
  if (
    url.pathname.startsWith('/region-packages/') ||
    url.pathname.startsWith('/regions/')
  ) {
    return;
  }

  // SPA navigation: network first, cached app shell fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();

          caches.open(CACHE)
            .then(cache =>
              cache.put('/index.html', copy)
            );

          return response;
        })
        .catch(() =>
          caches.open(CACHE)
            .then(cache =>
              cache.match('/index.html')
            )
        )
    );

    return;
  }

  const isShellAsset =
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/assets/');

  if (!isShellAsset) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();

          caches.open(CACHE)
            .then(cache =>
              cache.put(event.request, copy)
            );
        }

        return response;
      })
      .catch(() =>
        caches.open(CACHE)
          .then(cache =>
            cache.match(event.request)
          )
      )
  );
});
