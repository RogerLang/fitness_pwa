const SHELL_CACHE = "fitness-pwa-shell-v64";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./rescue.html",
  "./styles.css?v=63",
  "./training-motion.css?v=63",
  "./nav-motion.css?v=63",
  "./glass-cards.css?v=63",
  "./sw-register.js?v=64",
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
