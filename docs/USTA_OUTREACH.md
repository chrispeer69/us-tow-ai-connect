# USTA Outreach — the US Tow Alliance calling campaign

A daily outbound campaign that calls towing companies and invites them to claim
their free profile at USTowAlliance.com. The same number answers when they call
back. Built 2026-08-20 (Session 78).

It lives inside the Command Center as its own vendor, so the conversations are
readable and listenable in the same place as everything else.

---

## The five commands

```bash
cd packages/api

export USTA_API=https://api.ustowaiconnect.com
export USTA_TOKEN=<admin JWT>              # see "Getting a token" below
export USTA_TENANT=34ad702f-83f1-457b-93da-977aa56a9619

node scripts/usta.js status
node scripts/usta.js add towing-list.csv
node scripts/usta.js remove 614-555-0100   # profile claimed
node scripts/usta.js dnc 614-555-0100      # permanent do-not-call
node scripts/usta.js run --dry-run --limit 5
```

Everything the CLI does is also on the **Campaigns** page in the Command Center
(Communications → Campaigns). They call the same endpoints — there is one
implementation, not two.

### Getting a token

```bash
curl -s -X POST https://api.ustowaiconnect.com/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token"
```

---

## What is where

| Thing | Where |
|---|---|
| Vendor (tenant) | `US Tow Alliance` — `34ad702f-83f1-457b-93da-977aa56a9619` |
| Campaign | `USTA Outreach`, slug `usta` — `83831fe6-8bdc-457f-8663-e55f17d43117` |
| Outbound agent | Retell `USTA-Outreach-v1` — `agent_0e40fadbd07e21659e3e06026b`, 60s cap |
| Inbound agent | Retell `USTA-Inbound-v1` — created by `scripts/usta-retell-setup.js`, 90s cap |
| Webhook | `POST /webhooks/retell/campaign/result` |
| UI | `/admin/campaigns` |
| Tables | `campaigns`, `campaign_leads`, `campaign_call_logs`, `campaign_suppressions` (migration 0048) |

---

## First-run checklist

The campaign ships **status = OFF**. It will not dial until every step is done.

1. **Buy and bind the number.** Nothing dials without it.
   ```bash
   RETELL_API_KEY=... node scripts/usta-retell-setup.js --dry-run
   RETELL_API_KEY=... node scripts/usta-retell-setup.js --buy-number
   RETELL_API_KEY=... DB_URL=... node scripts/usta-retell-setup.js --apply
   ```
   `--apply` also patches the outbound agent's post-call schema, creates and
   publishes the inbound agent, and writes the ids back onto the campaign row.

2. **Import a list.** `node scripts/usta.js add list.csv`

3. **Dry run.** `node scripts/usta.js run --dry-run --limit 5`
   Resolves every guard and prints what *would* be dialled. Placing no calls.

4. **One live test call** to a number you control, then listen to it on the
   Campaigns page.

5. **Turn it on.** Set status ACTIVE from the Campaigns page, or:
   ```sql
   update campaigns set status = 'ACTIVE' where slug = 'usta';
   ```

6. **Enable the cron** (optional): set `CAMPAIGN_AUTORUN_ENABLED=true` on
   `@ustow/api`. Without it, batches only run when you run them.

---

## The four guards

Between a lead row and a ringing phone:

1. **Campaign status.** Anything but `ACTIVE` dials nothing. A dry run is still
   allowed against an OFF campaign — that is how you check a list.
2. **Calling window, local to the called number.** 9am–5pm Mon–Fri *where the
   phone rings*, not where the server is. An unknown timezone does **not** dial.
   US federal holidays are skipped.
3. **Attempt and daily caps.** One attempt per number per day, 2 lifetime, 500
   per day per campaign.
4. **Suppression, re-checked immediately before the dial.** Ingest already
   refuses suppressed numbers, but a batch takes minutes and a mid-batch opt-out
   has to land on the batch already running.

Leads are claimed with a conditional `UPDATE` (`QUEUED` → `CALLING`) that
returns the rows it changed, so two overlapping runs cannot dial the same
number.

---

## Dispositions

| Disposition | Meaning | Lead afterwards |
|---|---|---|
| `PITCHED` | A human heard the offer | retired |
| `WARM` | Said they'd claim it | **stays in the list**, flagged |
| `VM` | Voicemail left | retryable once |
| `RETRY` | No answer, busy, or died before the pitch | retryable |
| `GATEKEEPER` | Reached a non-decision-maker; callback time logged | retryable |
| `NOT_INTERESTED` | Declined the offer | retired |
| `DNC` | Asked to be removed | **suppressed permanently** |
| `ERROR` | Provider or config failure | retryable |

**`NOT_INTERESTED` is not `DNC`.** Declining an offer is not withdrawing consent
to ever be called. Conflating them shrinks the list far faster than the real
opt-outs warrant.

**`WARM` never auto-removes.** "Yeah, I'll check it out" is said far more often
than it is done.

### The one thing to know about opt-out detection

Opt-out phrases are matched against the **customer's turns only**, never the
whole transcript. Ray's own script says, verbatim:

> "Understood — I'll take you off the list right now."

A regex over the full transcript matches that agent line and suppresses the
number on every call where Ray correctly handles an opt-out — and on any call
where he says it at all. `campaign-disposition.ts` parses speakers first, and
`campaign-disposition.spec.ts` has a test that fails if anyone removes it.

The same defect is documented in `outbound-voice/pitch-completion.ts`. It has
now bitten twice.

---

## Why this is not in `outbound_call_logs`

That table models a tow: `motor_club`, `vehicle`, `issue_type`,
`original_destination`, `flip_eligible`, `offer_1_result`. An outreach call has
none of them.

More importantly, it is the population the **flip win rate** is measured over.
Pouring hundreds of 30-second campaign calls into it would make that number
unreadable — and on 2026-08-20 we found it was already hard enough to read
(`DECLINED` had been structurally unreachable for eight days because Retell
emits `FAILED` and the normalizer had no branch for it).

Campaign calls get their own table. The tenant, the login, the webhook plumbing
and the transcript/recording viewer are shared — that is the whole reason this
lives in Command Center rather than as a standalone tool.

---

## Changing the script

Ray's prompt lives on the **Retell LLM object**, not in this repo — unlike the
tow script, which is rendered by `flip-scripts.ts` and shipped as a dynamic
variable.

To change it:

1. `POST /create-agent-version {base_version}` — never edit a published version
2. Patch the LLM's `general_prompt`
3. Publish
4. Update `campaigns.outbound_agent_version` to the new number

**Never leave `outbound_agent_version` null.** With no
`override_agent_version`, Retell runs the agent's *latest draft* — so every save
in the Retell dashboard ships to live callers with no review and nothing to roll
back to. The Campaigns page shows a warning when it is unset.

---

## Ingest

Tolerates real paste: `+1`, dashes, parens, extensions (`x204`, `ext. 12`, `#7`),
trailing labels (`(cell)`), tabs, blank lines, a header row or none, and either
column order — the first cell that parses as a phone number wins.

Rejected with a reason, always reported:

- toll-free (`800`, `844`, `888`…) and premium (`900`) — a campaign must never dial these
- N11 service codes (`411`, `911`)
- Canadian NPAs — CAN Tow Alliance is a separate list with separate consent rules
- structurally invalid NANP numbers

Area code → timezone is resolved at ingest and stored. Codes that straddle a
zone boundary (`208`, `509`, `850`, `906`, `915`…) resolve to the **later**
zone deliberately: a late dial is a lost call, an early dial is a 7am cold call.

---

## Compliance notes

- Cold B2B outbound to businesses is lawful; the script identifies the caller
  and honours opt-out immediately, which are the two things that matter most.
- `campaign_suppressions` never expires and is checked tenant-wide, so opting
  out of one campaign opts out of all of them.
- Ray answers "are you an AI?" honestly and immediately, by explicit prompt
  rule. The post-call schema records `asked_if_ai` so that can be audited.
- **Open:** state seller-registration requirements for outbound telemarketing,
  and carrier-type lookup. `campaign_leads.line_type` exists and is populated
  with `unknown` — wiring a real lookup would let the dialler skip mobiles,
  which matter here because a tow operator's business line very often *is* a
  mobile.

---

## Operational gotchas

- **Retell env changes need a real restart, and it is slow** — 20–25 minutes
  from `railway redeploy` to effect. `redeploy` prints nothing and exits 0
  either way. The only proof is observed behaviour.
- **The reconcile sweep is not optional.** Terminal webhooks go missing; on the
  flip dialler this hid a third of one morning's calls, biased toward the long
  ones. `reconcileStalledCalls` runs every 5 minutes.
- **The day boundary here is `America/New_York`**, not UTC. The flip call-review
  report still uses UTC and reports 8pm–8pm as a day; that defect is not
  repeated here.
