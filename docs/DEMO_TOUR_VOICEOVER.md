# Demo Tour — Screen Recording & Voiceover Script

Companion script for the in-product guided tour at `/demo?tour=1`.
Sixteen scenes, one per tour step. Estimated runtime **3:20–3:50** at a normal
speaking pace.

- **Recording URL:** `https://www.ustowaiconnect.com/demo?tour=1`
- **Browser:** 1920×1080, zoom 100%, no bookmarks bar. The demo is a fixed
  full-height layout — it fills the window and does not scroll.
- **Before recording:** open a fresh private/incognito window. The tour writes a
  "seen" flag to localStorage; `?tour=1` forces it open regardless, but a clean
  window guarantees the default state (job 1 selected, all filters on).
- **Pacing:** click **Next** on the tour card at the end of each scene's
  narration. Let each card sit about one second before you speak.
- **Voice direction:** confident, plain, unhurried. Short sentences. This is an
  operator talking to another operator, not an ad read. No exclamation points.

---

## Scene 1 — Open

**On screen:** Tour card 1 of 16, centered. Command Center behind it.

> This is US Tow AI-Connect. What you're looking at is a dispatch board — the
> real one, running on seeded data. Give me about three minutes and I'll show
> you the two things it does that nothing else in towing does.

---

## Scene 2 — The board

**On screen:** Step 2. Spotlight on the four stat tiles.

> Every job lands in one queue. Your dispatch software, your motor clubs,
> anything typed in by hand — one row each, with status, driver, ETA, and the
> result of the AI's call. Your dispatchers stop living in four browser tabs.

---

## Scene 3 — The moat

**On screen:** Step 3. Spotlight on the jobs table. Point at the Source column.

> Look at the source column. Towbook. AAA. Manual. Here's the part people don't
> believe at first — most dispatch software has no way to connect to it. So we
> don't connect. We log in as you, in a headless browser, and read your board
> every sixty seconds. Five platforms are wired up today. Two are verified
> against live accounts.

---

## Scene 4 — The trigger

**On screen:** Step 4. Still on the jobs table. Point at the AI call column.

> Now the column that matters. Every one of these jobs got a call. And that call
> fires the moment the job hits your board — so the agent already knows the
> customer's name, their vehicle, where the truck is picking them up, and where
> it's dropping them off. It never has to ask who you are. That's the difference
> between this and an AI that dials a spreadsheet.

---

## Scene 5 — Geography

**On screen:** Step 5. Spotlight on the map. Click a pin to show it's live.

> Distance decides what the AI is allowed to say. When it picks one of your
> repair shops to recommend, it picks the one closest to the pickup — because
> that's your driver's detour, not the customer's convenience. Too far out, and
> it doesn't pitch at all.

---

## Scene 6 — Dispatcher control

**On screen:** Step 6. Spotlight on the filter bar. Toggle a status chip.

> Filters move the map and the table together. Your dispatcher narrows the board
> down to what they're actually working. The automation keeps running against
> everything.

---

## Scene 7 — Setup

**On screen:** Step 7. Selection jumps to Taylor Morgan's F-150. Drawer highlighted.

> Here's a real one. Taylor Morgan, Ford F-150, headed to Buckeye Auto Repair.
> That's a shop that isn't yours. You paid a driver to run that tow, and the
> repair money walks out the door at the other end.

---

## Scene 8 — The flip

**On screen:** Step 8. Spotlight on the AI call result panel — flip win, redirect shop.

> Except it didn't. On the confirmation call, the agent worked three offers. A
> free diagnostic with a discount. Then a fast look with a written estimate
> before any work. Then a repair credit with a priority slot held. It stops the
> second one lands. The customer said yes, and this tow is now going to your
> shop. Thirteen structured fields come back from that call — including which
> offer closed it.

---

## Scene 9 — The scripts

**On screen:** Step 9. Spotlight on the Customer call section. Open the Script dropdown.

> None of that lives in a prompt you have to trust. The offers, the wording, the
> branching — it's all written in code and rendered before the call goes out.
> Five scripts your dispatcher can fire by hand. And every single one carries the
> same rules: disclose the AI, never invent a price, one callback number, stop on
> a hard no, end the call if the customer is upset or in danger.

---

## Scene 10 — Human in the loop

**On screen:** Step 10. Spotlight on Assign driver / Update status.

> The sales AI never writes to your dispatch software. It classifies, it calls,
> it logs, it texts your managers. Assigning the truck and moving the status
> stays right here, with a person.

---

## Scene 11 — Guardrails

**On screen:** Step 11. Tour navigates to Flip Engine. Spotlight on the panel.

> Whether to pitch at all isn't a judgment call. It's a rule. An AAA-branded
> destination is a hard block — no override, ever. Your own shop, nothing to
> flip. A body shop gets a soft mention and nothing more, because insurance picks
> body shops. Every outcome carries a reason code, so a no is always explainable.

---

## Scene 12 — Sandbox

**On screen:** Step 12. Spotlight on the classification sandbox JSON.

> And you can prove all of it before it ever dials. The sandbox runs the whole
> pipeline against a real job and shows you exactly what it would have done —
> without placing a call or writing a thing.

---

## Scene 13 — Digital Dispatch

**On screen:** Step 13. Tour navigates to Digital Dispatch.

> That's one engine. Here's the other. Digital Dispatch decides which motor-club
> jobs are worth taking — distance to your closest truck, time of day, service
> type, minimum payout, nine conditions in all. If no rule matches, the default
> is flag. Never a silent accept, never a silent decline. And after it clicks the
> button in the portal, it stores the confirmation off the page, so you know it
> actually landed.

---

## Scene 14 — Notifications

**On screen:** Step 14. Tour navigates to Reports.

> You hear about both outcomes. A win texts your managers the customer, the
> vehicle, where it was going, where it's going now, which offer closed it, and
> the recording. A no-answer texts them too. Plus a daily report broken out by
> shop and by offer.

---

## Scene 15 — Safety

**On screen:** Step 15. Back on Command Center. Spotlight on the header buttons and amber bar.

> And nothing dials by accident. Master switch per company. Auto, manual-only, or
> off for each service type. A duplicate check that survives a restart. A
> fifteen-minute window, so a queued call about an old job gets dropped instead
> of placed. In this public demo, every one of those is closed.

---

## Scene 16 — Close

**On screen:** Step 16, centered card. "Book a live demo" button visible.

> Two engines, one board. Digital Dispatch picks the jobs worth taking. The Flip
> Engine turns the jobs you already have into repair revenue. Both of them run
> off the dispatch software you're already paying for.
>
> Go click through it yourself — the link's below. Or book twenty minutes and
> I'll run it against your own board.

---

## Do not say

These are claims the product does **not** currently support. They are kept out
of the on-screen tour copy on purpose; keep them out of the narration too.

| Don't say | Say instead |
|---|---|
| "It works with all five dispatch platforms today" | "Five platforms wired, two verified against live accounts" |
| "We flip AAA jobs" | AAA is a job **source** and an accept/decline target. Don't pair AAA with flipping. |
| "It knows the service type on every call" | Service type is populated on manual jobs and in the sandbox. Demo the classifier through the sandbox. |
| "We detect when the tow is going to the customer's house" | "Non-repair destinations don't get a pitch." |
| "Live ETA from driver GPS" | ETA is a configured value. Don't claim live GPS. |
| "The AI never touches your system" (unqualified) | "The *sales* AI never writes to your dispatch software. Digital Dispatch does accept and decline — under rules you wrote." |
| "Per-tenant security isolation on the live board" | Don't raise it. Auth on the board is a documented placeholder. |

---

## Short cut (60 seconds)

For a social clip, record scenes **1, 3, 4, 7, 8, 16** and skip the rest. That's
the whole argument: it's your board, the call knows everything, the tow gets
redirected, book a demo.

---

## Links to put under the video

- Watch/try it: `https://www.ustowaiconnect.com/tour`
- Book a live demo: `https://www.ustowaiconnect.com/schedule-demo`
