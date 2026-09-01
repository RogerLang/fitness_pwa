const CACHE = "fitness-pwa-v5";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./v2.js","./v2-fix.js","./v3-ui.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", event => {
  if(event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then(resp=>{ const copy=resp.clone(); caches.open(CACHE).then(c=>c.put(event.request,copy)); return resp; })
    .catch(()=>caches.match(event.request).then(hit=>hit||caches.match("./index.html"))));
});
