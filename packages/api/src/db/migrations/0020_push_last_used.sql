-- ============ PUSH: last_used_at (Session 29) ============
-- Web-push delivery (VAPID) landed in Session 29. Subscriptions were already
-- persisted in `driver_push_subscriptions` (migration 0011) but never sent to.
-- Add `last_used_at` to record the last *successful* push delivery, distinct
-- from `last_seen_at` (last subscribe/refresh from the device). Used for
-- observability and future stale-subscription pruning.
ALTER TABLE "driver_push_subscriptions"
  ADD COLUMN IF NOT EXISTS "last_used_at" timestamptz;
