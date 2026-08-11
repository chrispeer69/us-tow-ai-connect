-- Session 73 — script attribution + the daily call-review loop.
--
-- Until now nothing recorded WHICH script text produced a call, so no win
-- could be attributed to any script revision. These three columns are the
-- prerequisite for every experiment: stamped at render time by the flip
-- orchestrator, they let win rate be sliced by script version, scenario, and
-- A/B variant.

ALTER TABLE "outbound_call_logs" ADD COLUMN IF NOT EXISTS "script_version" varchar(40);--> statement-breakpoint
ALTER TABLE "outbound_call_logs" ADD COLUMN IF NOT EXISTS "scenario" varchar(40);--> statement-breakpoint
ALTER TABLE "outbound_call_logs" ADD COLUMN IF NOT EXISTS "script_variant" varchar(24) DEFAULT 'control';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "outbound_call_logs_version_idx" ON "outbound_call_logs" ("tenant_id", "script_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_call_logs_scenario_idx" ON "outbound_call_logs" ("tenant_id", "scenario", "call_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_call_logs_call_time_idx" ON "outbound_call_logs" ("tenant_id", "call_time");
