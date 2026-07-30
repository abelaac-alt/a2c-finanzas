const CACHE='a2c-v7-1';
const APP_ASSETS=[
  './','./index.html','./styles.css?v=70','./logo-a2c.png','./icon-192.png','./icon-512.png',
  './config.js','./manifest.webmanifest',
  './src/core.js?v=70','./src/store.js?v=70','./src/ui.js?v=70','./src/auth.js?v=70',
  './src/dashboard.js?v=70','./src/transactions.js?v=70','./src/resources.js?v=70',
  './src/budgets.js?v=70','./src/messages.js?v=70','./src/profile.js?v=70',
  './src/native.js?v=70','./src/app.js?v=70'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const requestUrl=new URL(event.request.url);
  const sameOrigin=requestUrl.origin===self.location.origin;
  event.respondWith(
    fetch(event.request).then(response=>{
      if(sameOrigin&&response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      }
      return response;
    }).catch(async()=>{
      const cached=await caches.match(event.request);
      if(cached)return cached;
      if(sameOrigin&&event.request.mode==='navigate')return caches.match('./index.html');
      return Response.error();
    })
  );
});
