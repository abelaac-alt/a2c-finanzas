const CACHE = 'a2c-finanzas-v55';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=55',
  './invite-registration.css?v=55',
  './resource-money.css?v=55',
  './privacy-friends.css?v=55',
  './groups-v54.css?v=55',
  './config.js?v=55',
  './privacy-friends.js?v=55',
  './app.js?v=55',
  './invite-registration.js?v=55',
  './resource-money.js?v=55',
  './groups-v54.js?v=55',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './logo-a2c.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const appCode = sameOrigin && (
    url.pathname.endsWith('/') ||
    /\.(?:html|js|css|webmanifest)$/.test(url.pathname)
  );

  if (appCode) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
