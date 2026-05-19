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

## Key Notes

- No CAPTCHA on login
- No MFA required
- No auto-logout (sessions persist indefinitely)
- The search panel is a slide-down overlay on the dispatch page, not a separate URL
- Multiple companies may be visible (use company filter on left sidebar if needed)
