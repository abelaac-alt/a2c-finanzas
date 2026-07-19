const CACHE = 'a2c-finanzas-v56';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=56',
  './invite-registration.css?v=56',
  './resource-money.css?v=56',
  './privacy-friends.css?v=56',
  './groups-v54.css?v=56',
  './config.js?v=56',
  './privacy-friends.js?v=56',
  './app.js?v=56',
  './invite-registration.js?v=56',
  './resource-money.js?v=56',
  './groups-v54.js?v=56',
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
