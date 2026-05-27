# Session 49d — Operator TODO

## 1. Verify manager phone list is populated

`tenants.manager_phones` jsonb. Already populated for tenant zero
during Session 24. Confirm the list contains the numbers you want
to receive flip wins / batch summaries / daily reports. Populated
via the existing `/admin/notifications` settings.

## 2. Configure flip-notifier knobs

Open `/admin/flip-engine` → Settings tab and set:

- **Send batch summaries**: ON (default true).
- **Batch summary size**: 10 (default). Tune up if you want fewer
  summary texts at higher volume.
- **Send daily report**: ON (default true).
- **Daily report hour**: 21 (9 PM local, default).

## 3. After 49c's JobPoller wiring lands

Set `OUTBOUND_FLIP_ENGINE_ENABLED=true` on Railway (`@ustow/api`).
Watch tenant zero's manager phones for the first WIN SMS, batch
summary at the 10th attempt, and daily summary at 9 PM Eastern.

## 4. Coordinate with G$D on the offer-acceptance signal

Today the WIN SMS is dormant because Thinkrr doesn't yet send a
structured "offer accepted" field. Coordinate with Cody / G$D to:

- Add an `outcome` JSON object to the call-completed webhook payload
  with shape `{ flip_offer_accepted: 1 | 2 | 3 | null, convini_link_sent: bool }`.
- OR confirm we should post-process transcripts ourselves (next session).

## 5. No new env vars

49d reuses the existing Twilio creds (Session 24). If those work
for SMS today, the flip notifier streams will work too.
