/**
 * Session-44 reports validation seed — root entrypoint.
 *
 * Thin shim: the real CLI lives in the api package
 * (packages/api/src/modules/reports/seed/run.ts) so `pg`, `ioredis`, `dotenv`,
 * and the drizzle schema resolve from there. Importing it runs `main()` with
 * the process args.
 *
 * Run (from repo root):
 *   packages/api/node_modules/.bin/tsx scripts/seed-reports.ts            # dry-run
 *   DATABASE_URL=… REDIS_URL=… packages/api/node_modules/.bin/tsx scripts/seed-reports.ts --apply
 *   …                                                                     --cleanup
 *
 * Or directly from the api package:
 *   pnpm --filter @ustow/api exec tsx src/modules/reports/seed/run.ts --apply
 */
import '../packages/api/src/modules/reports/seed/run';
