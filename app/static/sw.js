// AutoBank service worker: keeps the app shell available offline. API responses are never cached.
const CACHE = "autobank-v3";
const SHELL = [
  "/", "/static/css/app.css", "/static/js/main.js", "/static/js/api.js", "/static/js/ui.js", "/static/js/flows.js",
  "/static/js/charts.js", "/static/js/views/accounts.js", "/static/js/views/auth.js", "/static/js/views/cards.js",
  "/static/js/views/home.js", "/static/js/views/payments.js", "/static/js/views/profile.js",
  "/static/js/views/savings.js", "/static/js/views/search.js", "/static/js/views/stats.js",
  "/static/manifest.webmanifest", "/static/img/icon.svg", "/static/img/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first so a deploy is picked up immediately; the cache is only the offline fallback.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/"))),
  );
});
