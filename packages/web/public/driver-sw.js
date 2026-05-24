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
const CACHE = 'roadside-driver-v2';
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

// Web-push handler (Session 29). Payload is JSON sent by the API PushService:
// { title, body, url, tag, jobId }. Delivery requires VAPID keys to be set on
// the API — see docs/sessions/S29_OPERATOR_TODO.md.
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
      badge: '/driver-icon.svg',
      tag: payload.tag || undefined,
      renotify: Boolean(payload.tag),
      data: payload,
    }),
  );
});

// Tap → focus an open driver tab (and navigate it) or open the job URL.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/driver';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/driver') && 'focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
