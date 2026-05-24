/**
 * Pure, deterministic synthetic-data generator for the reporting dashboard
 * (Session 44 validation). No DB, no I/O, no clock reads beyond the injected
 * `now` — given the same `{ now, seed }` it returns byte-identical data, which
 * is what makes the seed script idempotent.
 *
 * The shapes here are written to be inserted verbatim by `run.ts` against
 * tenant-zero. Nothing in this file touches `reports.service.ts` — it only
 * mirrors the columns each aggregator reads (see docs/sessions/S44_DECISIONS.md).
 */

/** Tenant-zero — the ONLY tenant this seed ever writes to. */
export const TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** Default RNG seed (the session number) — override with --seed=N. */
export const DEFAULT_SEED = 44;

// ─── synthetic markers (must match cleanup queries in run.ts) ───────────────
export const MARKERS = {
  jobSourceIdPrefix: 's44-',
  driverPhonePrefix: '+1555044',
  pingSource: 'seed-s44',
  smsSidPrefix: 'SEED-S44-',
} as const;

const MS_PER_DAY = 86_400_000;
const DAYS = 90;
const DRIVER_COUNT = 15;
const PING_DAYS = 7;

// ─── deterministic RNG (mulberry32) ─────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed: number) {
  const r = mulberry32(seed);
  return {
    next: r,
    /** Integer in [lo, hi] inclusive. */
    int: (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1)),
    /** Float in [lo, hi). */
    float: (lo: number, hi: number) => lo + r() * (hi - lo),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)],
    /** Weighted pick: weights need not be normalized. */
    weighted: <T>(xs: readonly T[], weights: readonly number[]): T => {
      const total = weights.reduce((s, w) => s + w, 0);
      let x = r() * total;
      for (let i = 0; i < xs.length; i++) {
        x -= weights[i];
        if (x <= 0) return xs[i];
      }
      return xs[xs.length - 1];
    },
  };
}

// ─── row shapes (plain objects → parameterized inserts in run.ts) ───────────
export interface SeedDriver {
  id: string;
  name: string;
  phone: string;
  status: string;
  lat: number;
  lng: number;
}

export interface SeedJob {
  source: string;
  sourceJobId: string;
  sourcePayload: Record<string, unknown>;
  status: string;
  callerPhone: string;
  callerName: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  pickupAddress: string;
  serviceType: string;
  priority: string;
  assignedDriverId: string | null;
  etaMinutes: number | null;
  acceptedAt: Date | null;
  dispatchedAt: Date | null;
  arrivedAt: Date | null;
  completedAt: Date | null;
  autoDecision: string | null;
  autoDecisionReason: string | null;
  autoDecidedAt: Date | null;
  createdAt: Date;
}

export interface SeedSms {
  direction: 'inbound' | 'outbound';
  toPhone: string;
  fromPhone: string;
  body: string;
  twilioSid: string;
  status: string;
  sentAt: Date;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface SeedPing {
  driverPhone: string;
  driverName: string;
  lat: number;
  lng: number;
  heading: number;
  speedMph: number;
  accuracyM: number;
  batteryPct: number;
  source: string;
  recordedAt: Date;
}

export interface SeedDataset {
  drivers: SeedDriver[];
  jobs: SeedJob[];
  sms: SeedSms[];
  pings: SeedPing[];
  summary: SeedSummary;
}

export interface SeedSummary {
  now: string;
  seed: number;
  windowDays: number;
  drivers: number;
  jobs: { total: number; accepted: number; declined: number; expired: number };
  jobsByStatus: Record<string, number>;
  jobsBySource: Record<string, number>;
  completed: number;
  withDispatch: number;
  perDriverCompleted: Array<{ name: string; completed: number }>;
  sms: { total: number; inbound: number; outbound: number };
  pings: number;
}

// ─── static pools for realistic-looking values (Central Ohio) ───────────────
const DRIVER_NAMES = [
  'Diego Alvarez', 'Tasha Brooks', 'Liam O’Connor', 'Priya Patel', 'Marcus Webb',
  'Elena Sokolova', 'DeShawn Carter', 'Mei Lin', 'Gabriel Santos', 'Hannah Fischer',
  'Omar Haddad', 'Nadia Petrov', 'Tyrone Jackson', 'Sofia Romano', 'Kenji Watanabe',
] as const;

const CALLER_FIRST = ['Jordan', 'Casey', 'Riley', 'Avery', 'Morgan', 'Quinn', 'Drew', 'Sam', 'Alex', 'Jamie'];
const CALLER_LAST = ['Miller', 'Davis', 'Garcia', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Lee', 'Clark'];
const MAKES = [
  ['Toyota', ['Camry', 'Corolla', 'RAV4']],
  ['Honda', ['Civic', 'Accord', 'CR-V']],
  ['Ford', ['F-150', 'Escape', 'Explorer']],
  ['Chevrolet', ['Silverado', 'Malibu', 'Equinox']],
  ['Nissan', ['Altima', 'Rogue', 'Sentra']],
] as const;
const COLORS = ['Black', 'White', 'Silver', 'Blue', 'Red', 'Gray'];
const STREETS = ['Main St', 'High St', 'Broad St', 'Cleveland Ave', 'Hamilton Rd', 'Morse Rd', 'I-70 W', 'I-71 N', 'SR-315'];
const CITIES = ['Columbus', 'Dublin', 'Westerville', 'Hilliard', 'Gahanna', 'Reynoldsburg', 'Grove City'];
const SERVICE_TYPES = ['LIGHT_TOW', 'ROADSIDE', 'JUMP_START', 'LOCKOUT', 'TIRE_CHANGE', 'FUEL_DELIVERY', 'ACCIDENT_RECOVERY'];
const SOURCES = ['aaa', 'towbook', 'direct'] as const;
const SOURCE_WEIGHTS = [45, 35, 20];

// Central Ohio bounding box (rough) for plausible lat/lng.
const OH = { latMin: 39.85, latMax: 40.18, lngMin: -83.18, lngMax: -82.78 };

function startOfUtcDay(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Precompute a descending per-driver completed-job target that sums exactly to
 * `total`, with every driver in [50, 200] when feasible. Base = floor(total/n);
 * a zero-sum linear delta fans the values out so the bottom driver sits at ~50
 * and the ranking is clean. Returns counts indexed by driver position.
 */
function perDriverTargets(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  let remainder = total - base * n;
  // Linear zero-sum delta centred on the middle driver; D pulls the bottom to ~50.
  const mid = (n - 1) / 2;
  const D = Math.max(0, Math.min(base - 50, 200 - base)); // keep band within [50,200]
  const targets = Array.from({ length: n }, (_, i) => {
    const delta = mid === 0 ? 0 : Math.round((D * (mid - i)) / mid);
    return base + delta;
  });
  // Hand the integer remainder to the top drivers so the sum is exact.
  for (let i = 0; i < n && remainder > 0; i++, remainder--) targets[i]++;
  return targets;
}

export function generateDataset(opts: { now?: Date; seed?: number } = {}): SeedDataset {
  const now = opts.now ?? new Date();
  const seed = opts.seed ?? DEFAULT_SEED;
  const rng = makeRng(seed);

  // ── drivers ──
  const drivers: SeedDriver[] = Array.from({ length: DRIVER_COUNT }, (_, i) => {
    const n = i + 1;
    return {
      id: `00000000-0000-4d44-8000-${String(n).padStart(12, '0')}`,
      name: DRIVER_NAMES[i],
      phone: `${MARKERS.driverPhonePrefix}${String(n).padStart(4, '0')}`,
      status: rng.pick(['available', 'off_duty', 'on_job']),
      lat: rng.float(OH.latMin, OH.latMax),
      lng: rng.float(OH.lngMin, OH.lngMax),
    };
  });

  const today0 = startOfUtcDay(now);

  // ── jobs (first pass: everything except driver assignment) ──
  type Pending = SeedJob & { _completed: boolean };
  const jobs: Pending[] = [];
  let seq = 0;
  for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset--) {
    const dayStart = new Date(today0.getTime() - dayOffset * MS_PER_DAY);
    const isToday = dayOffset === 0;
    // Latest createdAt allowed today: ~30 min before `now`, leaving room for
    // the dispatch/complete deltas to stay <= now.
    const dayCeil = isToday ? now.getTime() - 30 * 60_000 : dayStart.getTime() + MS_PER_DAY - 1;
    const count = rng.int(12, 30);
    for (let k = 0; k < count; k++) {
      seq++;
      const createdAt = new Date(rng.int(dayStart.getTime(), Math.max(dayStart.getTime(), dayCeil)));
      const source = rng.weighted(SOURCES, SOURCE_WEIGHTS);
      const outcome = rng.weighted(['accepted', 'declined', 'expired'] as const, [60, 25, 15]);

      const first = rng.pick(CALLER_FIRST);
      const last = rng.pick(CALLER_LAST);
      const [make, models] = rng.pick(MAKES);
      const job: Pending = {
        source,
        sourceJobId: `${MARKERS.jobSourceIdPrefix}${String(seq).padStart(6, '0')}`,
        sourcePayload: { synthetic: true, seed: 's44', outcome },
        status: 'cancelled',
        callerPhone: `+1614${rng.int(2000000, 9999999)}`,
        callerName: `${first} ${last}`,
        vehicleYear: String(rng.int(2008, 2024)),
        vehicleMake: make,
        vehicleModel: rng.pick(models as readonly string[]),
        vehicleColor: rng.pick(COLORS),
        pickupAddress: `${rng.int(100, 9999)} ${rng.pick(STREETS)}, ${rng.pick(CITIES)}, OH`,
        serviceType: rng.pick(SERVICE_TYPES),
        priority: rng.weighted(['normal', 'high'] as const, [85, 15]),
        assignedDriverId: null,
        etaMinutes: null,
        acceptedAt: null,
        dispatchedAt: null,
        arrivedAt: null,
        completedAt: null,
        autoDecision: null,
        autoDecisionReason: null,
        autoDecidedAt: null,
        createdAt,
        _completed: false,
      };

      if (outcome === 'accepted') {
        const responseSeconds = rng.int(90, 480); // 90s .. 8min (drives response-time)
        const dispatchedAt = new Date(createdAt.getTime() + responseSeconds * 1000);
        const acceptedAt = new Date(createdAt.getTime() + Math.round(responseSeconds * 0.4) * 1000);
        job.acceptedAt = acceptedAt;
        job.dispatchedAt = dispatchedAt;
        job.autoDecision = 'accept';
        job.autoDecisionReason = 'Within service area and hours (synthetic)';
        job.autoDecidedAt = acceptedAt;
        job.etaMinutes = rng.int(15, 75);

        // Status among accepted: recent days lean en_route; rest mostly complete.
        const recent = dayOffset <= 2;
        const st = rng.weighted(
          ['completed', 'en_route', 'cancelled'] as const,
          recent ? [40, 50, 10] : [90, 2, 8],
        );
        const arrivedAt = new Date(dispatchedAt.getTime() + rng.int(8, 40) * 60_000);
        if (st === 'completed') {
          const completedAt = new Date(arrivedAt.getTime() + rng.int(15, 90) * 60_000);
          if (completedAt.getTime() <= now.getTime()) {
            job.status = 'completed';
            job.arrivedAt = arrivedAt;
            job.completedAt = completedAt;
            job._completed = true;
          } else {
            job.status = 'en_route'; // would finish in the future → still running
            job.arrivedAt = arrivedAt.getTime() <= now.getTime() ? arrivedAt : null;
          }
        } else if (st === 'en_route') {
          job.status = 'en_route';
          job.arrivedAt = arrivedAt.getTime() <= now.getTime() ? arrivedAt : null;
        } else {
          job.status = 'cancelled';
        }
      } else {
        // declined / expired — never accepted, never dispatched.
        job.status = 'cancelled';
        job.autoDecision = outcome === 'declined' ? 'decline' : 'expired';
        job.autoDecisionReason =
          outcome === 'declined' ? 'Outside distance rule (synthetic)' : 'Offer timed out (synthetic)';
        job.autoDecidedAt = new Date(createdAt.getTime() + rng.int(30, 600) * 1000);
      }

      jobs.push(job);
    }
  }

  // ── assign drivers to completed jobs against an exact per-driver target ──
  const completedJobs = jobs.filter((j) => j._completed);
  const targets = perDriverTargets(completedJobs.length, DRIVER_COUNT);
  // Build a shuffled pool: driver i appears targets[i] times.
  const pool: number[] = [];
  targets.forEach((t, i) => {
    for (let k = 0; k < t; k++) pool.push(i);
  });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  completedJobs.forEach((job, idx) => {
    job.assignedDriverId = drivers[pool[idx]].id;
  });
  // Accepted-but-not-completed jobs also get a (random) driver for realism;
  // they don't affect top-drivers (no completed_at).
  for (const job of jobs) {
    if (!job._completed && job.acceptedAt) job.assignedDriverId = rng.pick(drivers).id;
  }

  // ── sms: 2..5 per completed job, mixed direction ──
  const sms: SeedSms[] = [];
  let smsSeq = 0;
  const tenantPhone = '+16148326197';
  for (const job of completedJobs) {
    const k = rng.int(2, 5);
    const span = (job.completedAt!.getTime() - job.createdAt.getTime()) || 5 * 60_000;
    for (let m = 0; m < k; m++) {
      smsSeq++;
      const outbound = m % 2 === 0; // start outbound (dispatch notice), alternate
      const at = new Date(job.createdAt.getTime() + Math.round((span * (m + 1)) / (k + 1)));
      sms.push({
        direction: outbound ? 'outbound' : 'inbound',
        toPhone: outbound ? job.callerPhone : tenantPhone,
        fromPhone: outbound ? tenantPhone : job.callerPhone,
        body: outbound
          ? rng.pick(['Your tow is on the way.', 'Driver en route, ETA shortly.', 'Track your driver at the link.'])
          : rng.pick(['Thank you!', 'How long?', 'Ok, I see them.', 'Great, thanks.']),
        twilioSid: `${MARKERS.smsSidPrefix}${String(smsSeq).padStart(7, '0')}`,
        status: 'delivered',
        sentAt: at,
        deliveredAt: new Date(at.getTime() + rng.int(1, 8) * 1000),
        createdAt: at,
      });
    }
  }

  // ── driver pings: hourly for the last 7 days, per driver ──
  const pings: SeedPing[] = [];
  for (const d of drivers) {
    for (let h = PING_DAYS * 24 - 1; h >= 0; h--) {
      const recordedAt = new Date(now.getTime() - h * 3_600_000);
      pings.push({
        driverPhone: d.phone,
        driverName: d.name,
        lat: d.lat + rng.float(-0.04, 0.04),
        lng: d.lng + rng.float(-0.04, 0.04),
        heading: rng.float(0, 359.99),
        speedMph: rng.float(0, 65),
        accuracyM: rng.float(3, 25),
        batteryPct: rng.int(15, 100),
        source: MARKERS.pingSource,
        recordedAt,
      });
    }
  }

  // ── summary ──
  const byStatus: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let accepted = 0;
  let declined = 0;
  let expired = 0;
  let withDispatch = 0;
  for (const j of jobs) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    bySource[j.source] = (bySource[j.source] ?? 0) + 1;
    if (j.acceptedAt) accepted++;
    if (j.dispatchedAt) withDispatch++;
    if (j.autoDecision === 'decline') declined++;
    if (j.autoDecision === 'expired') expired++;
  }
  const perDriver = drivers
    .map((d) => ({ name: d.name, completed: completedJobs.filter((j) => j.assignedDriverId === d.id).length }))
    .sort((a, b) => b.completed - a.completed);

  const summary: SeedSummary = {
    now: now.toISOString(),
    seed,
    windowDays: DAYS,
    drivers: drivers.length,
    jobs: { total: jobs.length, accepted, declined, expired },
    jobsByStatus: byStatus,
    jobsBySource: bySource,
    completed: completedJobs.length,
    withDispatch,
    perDriverCompleted: perDriver,
    sms: {
      total: sms.length,
      inbound: sms.filter((s) => s.direction === 'inbound').length,
      outbound: sms.filter((s) => s.direction === 'outbound').length,
    },
    pings: pings.length,
  };

  // Strip the internal `_completed` flag from the public job rows.
  const publicJobs: SeedJob[] = jobs.map(({ _completed, ...rest }) => rest);
  return { drivers, jobs: publicJobs, sms, pings, summary };
}
