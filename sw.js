const CACHE="a2c-ejemplo-v32";
const FILES=["./","./index.html","./styles.css?v=32","./app.js?v=32","./config.js?v=32","./manifest.webmanifest","./icon-192.png","./icon-512.png","./logo-a2c.png","./assets/badges/ingresos-top-1.webp","./assets/badges/ingresos-top-2.webp","./assets/badges/ingresos-top-3.webp","./assets/badges/inversiones-top-1.webp","./assets/badges/inversiones-top-2.webp","./assets/badges/inversiones-top-3.webp","./assets/badges/ahorro-top-1.webp","./assets/badges/ahorro-top-2.webp","./assets/badges/ahorro-top-3.webp","./assets/badges/mejor-inversor-top-1.webp","./assets/badges/mejor-inversor-top-2.webp","./assets/badges/mejor-inversor-top-3.webp"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  const appCode=url.origin===self.location.origin&&(url.pathname.endsWith("/")||url.pathname.endsWith(".html")||url.pathname.endsWith(".js")||url.pathname.endsWith(".css"));
  if(appCode){
    event.respondWith(fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      return response;
    }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match("./index.html"))));
  }else{
    event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
  }
});
