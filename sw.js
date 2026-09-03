const SHELL_CACHE = "fitness-pwa-shell-v21";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./training-ux-v13.css",
  "./training-ux-v14.css",
  "./performance-v16.css",
  "./progression.css",
  "./app.js",
  "./v2.js",
  "./v2-fix.js",
  "./v3-ui.js",
  "./sync-v4.js",
  "./local-v7.js",
  "./today-sync-v12.js",
  "./training-ux-v13.js",
  "./training-ux-v14.js",
  "./recovery-v15.js",
  "./performance-v16.js",
  "./progression.js",
  "./workout-card-ui.js",
  "./manifest.webmanifest?v=18",
  "./icon-192.png?v=18",
  "./icon-512.png?v=18",
  "./icon-192-maskable.png?v=18",
  "./icon-512-maskable.png?v=18"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith("fitness-pwa-") && key !== SHELL_CACHE)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);

  if (cached) {
    network.catch(() => {});
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;

  if (request.mode === "navigate") {
    return (await cache.match("./index.html")) || (await cache.match("./"));
  }

  return Response.error();
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache authenticated/private API responses or other cross-origin data.
  if (url.origin !== self.location.origin) return;

  event.respondWith(staleWhileRevalidate(request));
});
