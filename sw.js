const SHELL_CACHE = "fitness-pwa-shell-v81";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./rescue.html",
  "./assets/css/styles.css?v=72",
  "./assets/css/training-motion.css?v=72",
  "./assets/css/nav-motion.css?v=72",
  "./assets/css/glass-cards.css?v=72",
  "./assets/css/exercise-card.css?v=72",
  "./js/pwa/sw-register.js?v=72",
  "./js/core/app-storage.js?v=72",
  "./js/core/app.js?v=72",
  "./js/core/app-body.js?v=72",
  "./js/core/app-backup.js?v=72",
  "./js/training/training-progression.js?v=72",
  "./js/training/training-draft.js?v=72",
  "./js/training/training-render.js?v=72",
  "./js/training/training-insights.js?v=72",
  "./js/training/training-maintenance.js?v=72",
  "./js/training/training.js?v=72",
  "./js/training/training-motion.js?v=72",
  "./js/ui/nav-motion.js?v=72",
  "./js/sync/sync-remote.js?v=72",
  "./js/sync/sync.js?v=72",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-192-maskable.png",
  "./assets/icons/icon-512-maskable.png"
];

async function cacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL_ASSETS.map(async asset => {
    const request = new Request(asset, { cache: "reload" });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Shell asset failed: ${asset}`);
    await cache.put(asset, response);
  }));
}

self.addEventListener("install", event => {
  event.waitUntil(cacheShell());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith("fitness-pwa-") && key !== SHELL_CACHE)
        .map(key => caches.delete(key))
    ))
  );
});

async function appShellNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = (await cache.match("./index.html")) || (await cache.match("./"));
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response?.ok && response.type === "basic") {
      cache.put("./index.html", response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response?.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    return Response.error();
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(appShellNavigation(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
