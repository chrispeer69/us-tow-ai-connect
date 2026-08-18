-- Session 77 — Web Push subscriptions, so a win buzzes a locked phone.
--
-- The in-page popup and the Notification API only fire while the board is open.
-- Chris, 2026-08-18: the point is the phone going off in your pocket at 9pm with
-- the app shut. That needs a real push subscription per device, held server side,
-- and a VAPID-signed message sent to the browser vendor's push service.
--
-- One row per DEVICE, not per user. The same person on a phone and a tablet is
-- two subscriptions and should get two buzzes; the endpoint is the identity.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The push service URL for this device. Unique because re-subscribing the
  -- same browser must UPDATE rather than accumulate duplicates — otherwise one
  -- win becomes five buzzes on one handset.
  endpoint text NOT NULL UNIQUE,

  -- The encryption keys the browser generated. Without both, a push cannot be
  -- encrypted for this device and web-push rejects it.
  p256dh text NOT NULL,
  auth   text NOT NULL,

  -- Who/what this is, purely so a stale subscription is identifiable when
  -- someone asks "why is this old phone still buzzing".
  label text,
  user_agent text,

  -- Consecutive send failures. A browser that has uninstalled the PWA returns
  -- 404/410 forever; we delete on those immediately, and use this to retire
  -- endpoints that fail for softer reasons rather than retrying them nightly.
  failure_count integer NOT NULL DEFAULT 0,

  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_tenant_idx
  ON push_subscriptions (tenant_id);
