// FILE: service-worker.js
/* Snake+ Service Worker (offline-first for app shell) */

const VERSION = "v1.0.0";
const CACHE_NAME = `snakeplus-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })()
  );
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("snakeplus-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Fetch:
// - Navigation requests: network-first (so updates deploy cleanly), fallback to cache
// - Static assets: cache-first
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  // HTML navigations
  const isNav =
    req.mode === "navigate" ||
    (req.method === "GET" &&
      req.headers.get("accept") &&
      req.headers.get("accept").includes("text/html"));

  if (isNav) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match("./index.html");
          return cached || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Everything else: cache-first, then network, then fallback
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        // Cache successful GET responses
        if (req.method === "GET" && fresh && fresh.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        // Optional: fallback to root for missing assets
        return cached || new Response("Offline", { status: 503 });
      }
    })()
  );
});
