/* Session 77 — service worker for flip win alerts.
 *
 * This exists for exactly one reason: a service worker keeps running after the
 * page is closed, so it can receive a push and raise a notification on a phone
 * that is locked in a pocket. The in-page popup and the Notification API on the
 * board itself only work while the board is alive.
 *
 * Deliberately does NOT cache anything. A monitoring screen that serves a stale
 * cached shell would show yesterday's wins and look fine doing it, which is
 * worse than not loading at all. Network is the only source of truth here.
 */

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every old tab to close —
  // otherwise the first install does not receive pushes until the phone is
  // restarted, which reads as "it doesn't work".
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  /** @type {{title?: string, body?: string, url?: string, tag?: string}} */
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with a non-JSON body should still buzz. Silence here would be the
    // worst outcome: the win happened, and the phone stayed quiet.
    payload = { title: 'Flip win', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Flip win';
  const options = {
    body: payload.body || '',
    icon: '/flip-icon.svg',
    badge: '/flip-icon.svg',
    // Buzz. On Android this is the difference between noticing and not.
    vibrate: [200, 100, 200],
    tag: payload.tag || 'flip-win',
    // Do NOT collapse silently over a previous win: renotify makes the device
    // alert again even when the tag matches an existing notification.
    renotify: true,
    requireInteraction: false,
    data: { url: payload.url || '/m/flip' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/m/flip';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Reuse an already-open board rather than stacking a second window every
      // time a win is tapped.
      for (const client of clientList) {
        if (client.url.includes('/m/flip') && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
