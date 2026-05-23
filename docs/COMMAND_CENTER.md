# Command Center

The Command Center is the unified live dispatch board at
`/admin/command-center`. It aggregates jobs from every connected adapter
(Towbook, AAA Salesforce, manual) for the active tenant, renders them on a
map + table with real-time updates, and is the surface a dispatcher uses
to assign drivers and transition status.

## UI overview

```
┌──────────────────────────────────────────────────────────────┐
│ Header — title, stats strip, Refresh + Manual-job buttons    │
├──────────┬───────────────────────────────────────┬───────────┤
│ Filters  │              Google Map               │  Job      │
│ Drivers  │   (jobs as colored markers,           │  drawer   │
│ panel    │    drivers as cyan triangles)         │  (assign, │
│          ├───────────────────────────────────────┤   status, │
│          │              Jobs table               │   timeline│
│          │   (status pill, source, caller,       │           │
│          │    vehicle, pickup, ETA, driver, age) │           │
└──────────┴───────────────────────────────────────┴───────────┘
```

- **Stats strip**: active jobs, average ETA, jobs in the last 24 hours,
  jobs/hour. Pulled from `/v1/admin/command-center/stats` and refreshed
  every 30 s.
- **Filters**: status chips (toggle multi-select), source dropdown,
  priority, free-text search across caller, address, and source ID.
- **Map**: dark-themed Google Map with status-colored job markers and
  cyan triangle markers for drivers with recent location pings. Clicking
  a marker opens the side drawer for that job.
- **Jobs table**: sortable rows; click to open the drawer. Live-updates as
  new jobs land via socket.io.
- **Drivers subpanel**: each driver's status pill (`available`, `on_job`,
  `off_duty`) and the age of their last ping. "+ Add" opens a modal.
- **Side drawer**: caller details, vehicle, pickup/dropoff, assign-driver
  dropdown, status-change buttons, AI-decision summary (if the engine
  fired), and a chronological event timeline.

If `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is not set the map area renders a
placeholder card; the rest of the page (table, drawer, drivers) still
works.

## Live updates

The page opens a socket.io connection to `/ws/command-center`. The server
broadcasts three event types to the tenant's room:

| Event           | Payload         | UI behaviour                          |
|-----------------|-----------------|---------------------------------------|
| `job.created`   | UnifiedJob row  | Prepend to the table if it passes the current filters. |
| `job.updated`   | UnifiedJob row  | Patch the existing row (and the open drawer if it's the same job). |
| `driver.updated`| Driver row      | Replace or append in the drivers panel. |

The websocket handshake uses the same `x-tenant-id` placeholder header as
the admin REST guard; flagged for real JWT in `docs/ASSUMPTIONS.md`.

## API reference

All endpoints are mounted under `/v1/admin/command-center` and require the
`AdminAuthGuard` (header `x-tenant-id: <tenant uuid>` in dev).

### Jobs

| Method | Path                       | Notes |
|--------|----------------------------|-------|
| GET    | `/jobs`                    | List, with `status`, `source`, `driver_id`, `priority`, `search`, `limit` (≤200), `offset`. Comma-separated values are supported for `status` and `source`. Returns `{ items, total, limit, offset }`. |
| GET    | `/jobs/:id`                | Full detail + `events: JobEvent[]`. |
| POST   | `/jobs/:id/assign`         | Body `{ driver_id, truck_id }`. Both may be null. |
| POST   | `/jobs/:id/status`         | Body `{ status, notes? }`. Sets `acceptedAt`, `dispatchedAt`, `arrivedAt`, or `completedAt` automatically based on the transition. |
| POST   | `/jobs/manual`             | Create a manual job. Returns the unified job; `source = "manual"`. |

### Drivers & trucks

| Method | Path                       | Notes |
|--------|----------------------------|-------|
| GET    | `/drivers`                 | List for tenant, sorted by name. |
| POST   | `/drivers`                 | `{ name, phone?, status? }`. |
| PUT    | `/drivers/:id`             | Patch; setting `current_lat` / `current_lng` also stamps `last_ping_at`. |
| GET    | `/trucks`                  | List. |
| POST   | `/trucks`                  | `{ name, type?, status?, assigned_driver_id? }`. |
| PUT    | `/trucks/:id`              | Patch. |

### Stats

`GET /stats` returns:

```json
{
  "activeJobs": 7,
  "jobsLast24h": 32,
  "jobsPerHour": 1.33,
  "avgEtaMinutes": 18.5,
  "byStatus": [{ "status": "en_route", "count": 4 }, ...],
  "bySource":  [{ "source": "towbook",  "count": 12 }, ...]
}
```

### Websocket

`io({ path: '/ws/command-center' })` — the client must include
`x-tenant-id` in the handshake headers (or a `tenantId` query param).

## Data model

See `packages/api/src/db/schema.ts` for the full Drizzle definitions. The
canonical table is `unified_jobs`, keyed on
`(tenant_id, source, source_job_id)` as the natural upsert key. Drivers,
trucks, and `job_events` round out the schema; `auto_decision*` columns are
populated by the Digital Dispatch rules engine.
