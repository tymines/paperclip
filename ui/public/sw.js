// Bump CACHE_NAME on every change that must invalidate stale clients. The
// byte change here is what lets a browser holding an OLD/broken service worker
// detect that /sw.js has updated and install this one.
const CACHE_NAME = "paperclip-v3";

self.addEventListener("install", () => {
  // Activate immediately instead of waiting for all old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache from any prior service worker version — this is what
      // clears a broken app shell that was cached while the backend was down.
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));

      // Take control of all open pages right now.
      await self.clients.claim();

      // The pages currently on screen were rendered by the OLD service worker
      // (possibly the broken black shell). claim() controls them but does NOT
      // refresh them, so force a one-time reload so they re-fetch fresh,
      // network-first content. activate() only fires once per SW version, so
      // this cannot loop.
      //
      // IMPORTANT: these navigate() calls must stay fire-and-forget. Awaiting
      // them inside activate()'s waitUntil deadlocks the page: the forced
      // navigation's fetch event is queued until this worker finishes
      // activating, but activation cannot finish while waitUntil is waiting
      // on navigate() to resolve. The result is a permanently hung document
      // request (page never commits, main thread unresponsive). Firing
      // without await lets activation complete, the worker becomes active,
      // and the queued navigation then proceeds through the fetch handler.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate(client.url).catch(() => undefined);
      }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and API calls
  if (request.method !== "GET" || url.pathname.startsWith("/api")) {
    return;
  }

  // Network-first for everything — cache is only an offline fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        if (request.mode === "navigate") {
          return caches.match("/") || new Response("Offline", { status: 503 });
        }
        return caches.match(request);
      })
  );
});
