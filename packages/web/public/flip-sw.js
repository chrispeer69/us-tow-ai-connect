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
  /** @type {{title?: string, body?: string, url?: string, tag?: string, kind?: string}} */
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with a non-JSON body should still buzz. Silence here would be the
    // worst outcome: the win happened, and the phone stayed quiet.
    payload = { title: 'Flip win', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Flip win';
  // A win and a "nobody answered, go call them" are different urgencies and
  // should not feel identical in a pocket.
  const isWin = (payload.kind || '') === 'win' || /flip win/i.test(title);

  const options = {
    body: payload.body || '',
    icon: '/flip-icon.svg',
    badge: '/flip-icon.svg',

    // A DISTINCTIVE RHYTHM, not a generic buzz.
    //
    // Chris, 2026-08-19: "it is really a generic buzz, won't catch much
    // attention." Every notification on a phone uses roughly the same short
    // pulse, so the only lever a web push actually has is the PATTERN — the
    // sound belongs to the Android channel and cannot be set from here.
    //
    // A win is three long pulses with a gap: unlike anything a text or an email
    // makes, and long enough to feel through a pocket. An unanswered call is a
    // quicker double tap — noticeable, but it does not impersonate a win.
    vibrate: isWin
      ? [300, 120, 300, 120, 300, 300, 600]
      : [150, 100, 150],

    tag: payload.tag || 'flip-win',
    // Do NOT collapse silently over a previous win: renotify makes the device
    // alert again even when the tag matches an existing notification.
    renotify: true,

    // THE BIG ONE for getting noticed. Without this the banner slides away after
    // a few seconds and, on a locked phone, is just one more line in a stack you
    // scroll past. requireInteraction keeps it on screen until it is actually
    // dealt with — the notification is still there when the phone is next picked
    // up, which is the whole point of alerting at 9pm.
    requireInteraction: true,

    // Buttons, so the alert is actionable from the lock screen rather than
    // something to remember to act on later.
    actions: isWin
      ? [{ action: 'open', title: 'See the board' }]
      : [
          { action: 'open', title: 'Open board' },
          { action: 'dismiss', title: 'Dismiss' },
        ],

    data: { url: payload.url || '/m/flip' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // A tap on "Dismiss" should close and do nothing — opening the board there
  // would be the opposite of what the button says.
  if (event.action === 'dismiss') return;
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
