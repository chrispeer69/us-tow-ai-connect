# Session 49b — Operator TODO

## 1. After deploy — verify migrations applied

`0025_alpha_shops` (idx 23) and `0026_aaa_branded_blocklist` (idx 24)
apply automatically via Railway's `db:migrate:prod` pre-deploy hook.

Verify:

```
SELECT count(*) FROM alpha_shops WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
-- expect 9
SELECT count(*) FROM aaa_branded_blocklist WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
-- expect 4
```

## 2. Review and confirm the 9 seeded Alpha shops

Open `/admin/flip-engine` → Shops tab. Confirm the 9 rows look right.
Edit any shop where the lat/lng is off — the engine uses these
coordinates to pick the nearest shop to the pickup, so accuracy
matters within ~100 meters.

If a shop is missing or has closed, edit/delete it from the same
screen. New shops added here are tenant-zero-only.

## 3. (Optional) Add regional AAA brand variants

Open `/admin/flip-engine` → AAA Blocklist tab. The seed includes the
canonical patterns:

- `Car Care`
- `AAA Auto Repair`
- `AAA Service Center`
- `AAA Tire & Auto`

If your area has AAA-owned shops with names that don't include the
literal `AAA` standalone word and aren't covered by these patterns,
add them. Use the `Check` route (POST `/v1/admin/flip-engine/aaa-blocklist/check`)
to test a candidate name before adding.

## 4. (Optional) Tune flip-engine settings before going live

Open `/admin/flip-engine` → Settings tab.

- **Flip engine enabled** — leave OFF until 49c lands. With 49b alone
  toggling this on does nothing because the poller does not exist yet.
- **No-flip confidence threshold** — default 0.85. Lower means stricter
  exclusions (more single-tire jobs skipped). Raise it if you find
  the AI is missing flip opportunities because it's too cautious.
- **Poll interval** — default 60 seconds.
- **Batch summary size** — default every 10 attempts.
- **Daily report hour** — default 21 (9 PM local).
- **Mention rentals** — default ON. Tells the AI it's OK to mention
  the 35-vehicle CONVINI rental fleet during pitches.

## 5. No env vars to set this session

49b has zero new environment variables. 49c will add `GOOGLE_PLACES_API_KEY`
and `OUTBOUND_FLIP_ENGINE_ENABLED=true`. 49d adds nothing new — it
reuses Session 24's Twilio creds.

## 6. Hard rule reminder for your team

**A AAA call going to a AAA-branded repair location is NEVER flipped.
This is a fireable offense if it ever happens.** The engine enforces
this in code with two layers:

- A hard-coded `\bAAA\b` regex on the destination business name (cannot
  be turned off, runs before any other check).
- The operator-managed `aaa_branded_blocklist` table for regional
  variants the regex misses.

If you ever see a flip attempt logged for a AAA-source job going to a
AAA-branded shop, file a bug immediately and pause the engine
(`flip_engine_enabled = false`) until the matcher is patched.
