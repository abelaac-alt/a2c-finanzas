const CACHE='a2c-v81-810';
const ASSETS=['./','./index.html','./styles.css','./config.js','./manifest.webmanifest','./logo-a2c.png','./icon-192.png','./icon-512.png','./src/core.js','./src/store.js','./src/ui.js','./src/auth.js','./src/transactions.js','./src/scheduled.js','./src/statistics.js','./src/budgets.js','./src/goals.js','./src/resources.js','./src/dashboard.js','./src/messages.js','./src/profile.js','./src/native.js','./src/app.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy));return response;}).catch(()=>caches.match('./index.html')));return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;})));
});
