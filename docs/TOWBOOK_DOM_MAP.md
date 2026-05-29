# Towbook DOM Map — Verified May 2026

This document contains the exact DOM selectors and navigation flow for automating Towbook via Playwright. These were verified by logging into a live Towbook account (Roadside Towing and Recovery Inc / Auto Lyft USA, Inc).

## Login Flow

| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Navigate | `https://app.towbook.com/Security/Login` |
| 2 | Fill username | `#Username` (type: text) |
| 3 | Fill password | `#Password` (type: password) |
| 4 | Click submit | `button` with text "Log in" |
| 5 | Wait for redirect | URL becomes `https://app.towbook.com/` |

## Dispatch Board Navigation

| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Navigate | `https://app.towbook.com/DS4/` |
| 2 | Open search panel | Click `#a-search` (link with id "a-search") |
| 3 | Wait for panel | Wait for `#gscus` to be visible |

## Phone Number Search

| Step | Action | Selector |
|------|--------|----------|
| 1 | Fill phone number | `#gscus` (placeholder: "customer name, phone number, or account name") |
| 2 | Click search | `#getResults` (input type: button, value: "Get Results!") |
| 3 | Wait for results | Wait for results table to populate (DOM update) |

## Quick Search (Alternative)

There is also a quick search bar in the top nav:
- Selector: `#x-quick-search`
- Placeholder: "Search by Call #, Invoice #, Customer"
- This may also accept phone numbers but the dedicated Search panel is more reliable.

## Results Parsing

After clicking "Get Results!", the dispatch board updates with matching calls. Each call row contains:
- Call status (color-coded: Waiting, Dispatched, Enroute, On Scene, Being Towed, Destination Arrival)
- Vehicle information
- Customer name
- Driver assigned
- ETA information

The results appear in the main dispatch area. Parse the DOM for active/enroute calls matching the search.

## Dispatch Row Column IDs (`<li class="entryRow">` → `[columnid]`)

Verified against a live DS4 board (git 18f8999, 3 jobs):

| columnid | Field |
|----------|-------|
| 2 | Vehicle |
| 4 | ETA |
| 5 | Driver |
| 9 | Account |
| 14 | Status |
| 22 | Contact — "Name (xxx) xxx-xxxx" |

### Pickup / Destination address columns — UNCONFIRMED

The pickup ("Tow From") and destination ("Tow To") address columns were **not
present** in the verified capture above — the original scraper shipped
`destination: ''` and never captured pickup. Their `columnid`s are unknown; it
is also possible the DS4 **list view does not expose these columns at all** (the
full addresses may only live in the call-detail panel), in which case capturing
them requires detail-page navigation rather than a list-row parse.

To resolve: run one scrape and read the `[towbook-debug] columnid N = "…"`
diagnostic lines now emitted by `TowbookAdapter.dumpDiagnostics` (logged every
scrape; full HTML also dumped when `TOWBOOK_DEBUG_DUMP=1`). Then set:

- `TOWBOOK_PICKUP_COLUMN_IDS` — comma-separated columnid(s) for the pickup address
- `TOWBOOK_DROPOFF_COLUMN_IDS` — comma-separated columnid(s) for the destination address

First match wins; values are accepted only if they pass a lenient address sanity
check (so a mis-pointed id can't inject a phone/ETA). Until set, pickup and
destination are captured as empty (never a wrong address).

## Key Notes

- No CAPTCHA on login
- No MFA required
- No auto-logout (sessions persist indefinitely)
- The search panel is a slide-down overlay on the dispatch page, not a separate URL
- Multiple companies may be visible (use company filter on left sidebar if needed)
