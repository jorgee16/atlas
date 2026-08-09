const CACHE = 'atlas-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(name =>
            name.startsWith('roam-shell-') ||
            (
              name.startsWith('atlas-shell-') &&
              name !== CACHE
            )
          )
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Region downloads live in their own versioned caches. Never use a global
  // caches.match() here: during an update it can return the old region asset
  // before RegionDownloader has a chance to fetch and verify the new bytes.
  // Only the small application shell belongs to this service worker cache.
  if (!SHELL.includes(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE)
      .then(cache =>
        fetch(event.request)
          .then(response => {
            cache.put(
              event.request,
              response.clone()
            );

            return response;
          })
          .catch(() => cache.match(event.request))
      )
  );
});
