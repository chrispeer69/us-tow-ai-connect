/**
 * Driver PWA web-push client (Session 29).
 *
 * Registers the existing /driver-sw.js service worker, requests notification
 * permission, fetches the server's VAPID public key, subscribes via the Push
 * API, and registers the subscription with the API through the BFF proxy
 * (`/api/driver/push/*`, which attaches the tenant key server-side).
 *
 * Everything here is best-effort and non-blocking — the driver home page works
 * fully without notification permission.
 */

export type PushState =
  | 'unsupported' // browser lacks SW / Push / Notification APIs
  | 'denied' // user blocked notifications
  | 'default' // not yet asked
  | 'enabled'; // permission granted and subscribed

const SW_URL = '/driver-sw.js';

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Current state without prompting the user. */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  // granted — check whether we hold a live subscription
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'enabled' : 'default';
  } catch {
    return 'default';
  }
}

// VAPID keys are base64url; the Push API wants a Uint8Array.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

interface VapidResp {
  status: string;
  data: { publicKey: string };
}

/**
 * Request permission + subscribe + register with the API.
 * Returns the resulting state. Throws only on unexpected network errors;
 * permission-denied resolves to 'denied' rather than throwing.
 */
export async function enablePush(driverPhone: string): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!driverPhone) throw new Error('Set your phone in Profile first');

  const reg =
    (await navigator.serviceWorker.getRegistration(SW_URL)) ??
    (await navigator.serviceWorker.register(SW_URL));
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';

  const keyResp = await fetch('/api/driver/push/vapid-public-key', { cache: 'no-store' });
  const keyJson = (await keyResp.json()) as VapidResp;
  const publicKey = keyJson?.data?.publicKey;
  if (!publicKey) throw new Error('Push not configured on server yet');

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: lib.dom types applicationServerKey as BufferSource; the Uint8Array
      // generic (ArrayBufferLike) doesn't narrow cleanly under strict TS.
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  const json = sub.toJSON();
  const res = await fetch('/api/driver/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driver_phone: driverPhone,
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      user_agent: navigator.userAgent.slice(0, 500),
    }),
  });
  if (!res.ok) throw new Error(`Subscribe failed: HTTP ${res.status}`);

  return 'enabled';
}

/** Remove the local subscription and tell the API to drop it. */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/driver/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => undefined);
      await sub.unsubscribe();
    }
  } catch {
    /* best-effort */
  }
  return getPushState();
}
