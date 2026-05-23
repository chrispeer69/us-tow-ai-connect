-- Session 26 (SaaS Hardening): rate limiter usage statistics.
-- Redis is the hot-path store for per-window counters; this table is the
-- cold archive flushed every 5 minutes by RateLimitStatsAggregator so we
-- have a SQL surface for billing / observability / per-tenant capacity
-- planning. Counters are scoped to a 5-minute window
-- (window_start, endpoint_group). One row per
-- (tenant_id, api_key_id, endpoint_group, window_start).
--
-- `api_key_id` is NULL when the request was IP-keyed (public / webhook /
-- unauthenticated). `endpoint_group` is the coarse bucket: 'public',
-- 'tenant_api', 'admin', 'webhook'.

CREATE TABLE IF NOT EXISTS "api_key_usage_stats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "api_key_id" uuid REFERENCES "tenant_api_keys"("id") ON DELETE SET NULL,
  "identifier" text NOT NULL,
  "endpoint_group" varchar(20) NOT NULL,
  "request_count" integer NOT NULL DEFAULT 0,
  "throttled_count" integer NOT NULL DEFAULT 0,
  "window_start" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_key_usage_stats_window_uniq"
  ON "api_key_usage_stats" ("identifier", "endpoint_group", "window_start");

CREATE INDEX IF NOT EXISTS "api_key_usage_stats_tenant_window_idx"
  ON "api_key_usage_stats" ("tenant_id", "window_start" DESC);

CREATE INDEX IF NOT EXISTS "api_key_usage_stats_window_idx"
  ON "api_key_usage_stats" ("window_start" DESC);
