const CACHE = 'a2c-finanzas-v66-3-permissions';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=58',
  './a2c-redesign-v64.css?v=64',
  './a2c-redesign-v65.css?v=65',
  './a2c-fixes-v66.css?v=66',
  './a2c-fixes-v66-1.css?v=66.1',
  './permissions-v66-3.css?v=66.3',
  './scheduled-v63.css?v=63',
  './modern-theme-v59.css?v=61',
  './invite-registration.css?v=58',
  './resource-money.css?v=58',
  './privacy-friends.css?v=58',
  './groups-v54.css?v=59',
  './config.js?v=58',
  './privacy-friends.js?v=58',
  './app.js?v=66.3',
  './invite-registration.js?v=58',
  './resource-money.js?v=65',
  './groups-v54.js?v=65',
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
