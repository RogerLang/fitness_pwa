const SHELL_CACHE = "fitness-pwa-shell-v158";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./rescue.html",
  "./assets/css/styles.css",
  "./assets/css/training-motion.css",
  "./assets/css/nav-motion.css",
  "./assets/css/glass-cards.css",
  "./assets/css/exercise-card.css",
  "./assets/css/page-unification.css",
  "./assets/css/planning.css",
  "./assets/css/visual-hierarchy.css",
  "./assets/css/visual-refinements-v105.css",
  "./assets/css/progress.css",
  "./assets/css/settings.css",
  "./assets/css/history.css",
  "./assets/css/pwa-update.css",
  "./js/pwa/sw-register.js",
  "./js/core/app-storage.js",
  "./js/core/app.js",
  "./js/core/app-body.js",
  "./js/core/app-backup.js",
  "./js/training/training-progression.js",
  "./js/training/training-next-workout.js",
  "./js/training/training-draft.js",
  "./js/training/training-render.js",
  "./js/training/training-session-data.js",
  "./js/training/training-history.js",
  "./js/training/training-progress.js",
  "./js/training/training-insights.js",
  "./js/training/training-maintenance.js",
  "./js/training/training.js",
  "./js/training/planning.js",
  "./js/training/training-motion.js",
  "./js/training/training-keyboard-viewport.js",
  "./js/ui/nav-motion.js",
  "./js/sync/sync-remote.js",
  "./js/sync/sync.js",
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

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith("fitness-pwa-") && key !== SHELL_CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
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
