// FILE: service-worker.js
/* Snake+ Service Worker (offline-first app shell) */

const VERSION = "v1.0.3";
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
  "./icons/maskable-512.png"
];

// Install
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Cache what we can. If one request fails (common when icon files aren't uploaded yet),
      // we still want the service worker to install.
      const results = await Promise.allSettled(APP_SHELL.map((p) => cache.add(p)));
      // Optional: remove any rejected entries from console noise
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          // eslint-disable-next-line no-console
          console.warn("SW cache skip:", APP_SHELL[i], r.reason);
        }
      });
      await self.skipWaiting();
    })()
  );
});

// Activate
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

// Fetch
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  const isNav =
    req.mode === "navigate" ||
    (req.method === "GET" &&
      req.headers.get("accept") &&
      req.headers.get("accept").includes("text/html"));

  // Network-first for HTML
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

  // Cache-first for static
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        if (req.method === "GET" && fresh && fresh.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        return new Response("Offline", { status: 503 });
      }
    })()
  );
});
