const SHELL_CACHE = "fitness-pwa-shell-v63";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./rescue.html",
  "./styles.css?v=63",
  "./training-motion.css?v=63",
  "./nav-motion.css?v=63",
  "./glass-cards.css?v=63",
  "./app.js?v=63",
  "./training-progression.js?v=63",
  "./training-draft.js?v=63",
  "./training-render.js?v=63",
  "./training-insights.js?v=63",
  "./training-maintenance.js?v=63",
  "./training.js?v=63",
  "./training-motion.js?v=63",
  "./nav-motion.js?v=63",
  "./sync.js?v=63",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith("fitness-pwa-") && key !== SHELL_CACHE)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response?.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
      cache.put("./index.html", response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    return (await cache.match(request)) ||
      (await cache.match("./index.html")) ||
      (await cache.match("./")) ||
      Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response?.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);

  if (cached) {
    network.catch(() => {});
    return cached;
  }
  return (await network) || Response.error();
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
