/* Roadside Driver PWA — minimal app-shell service worker.
 *
 * Caches the driver app shell so the home screen still loads when the driver
 * is in a dead spot. Network-first for /api/driver/* so live data is always
 * fresh when connectivity exists.
 *
 * The cache version is bumped on every release of the bundle. There's
 * no auto-update mechanism — the page reload uses `skipWaiting()` to
 * activate the new SW on first navigation after deploy.
 */
const CACHE = 'roadside-driver-v1';
const SHELL = [
  '/driver',
  '/driver/map',
  '/driver/history',
  '/driver/profile',
  '/driver-manifest.json',
  '/driver-icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(SHELL).catch(() => undefined),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // API requests: network-first, never cache (driver state is live).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response('{"status":"offline"}', { status: 503 })));
    return;
  }

  // App shell: cache-first with network fallback + cache update.
  if (url.pathname.startsWith('/driver')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const clone = resp.clone();
              caches.open(CACHE).then((c) => c.put(event.request, clone));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || networkFetch;
      }),
    );
  }
});

// Web-push handler scaffolding — VAPID keys are not configured yet so this
// will never fire in production. Documented in docs/ASSUMPTIONS.md.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = { title: 'Roadside', body: 'New dispatch' };
  try {
    payload = event.data.json();
  } catch {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Roadside', {
      body: payload.body || '',
      icon: '/driver-icon.svg',
      data: payload,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/driver'));
});
