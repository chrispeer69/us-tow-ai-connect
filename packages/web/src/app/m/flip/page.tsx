'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/utils';

/**
 * Session 77 — Flip Activity, for a phone in the evening.
 *
 * Chris, 2026-08-18: "so that in the evening we can monitor it on mobile".
 *
 * The desk version is a seven-column table, which on a phone is either a
 * horizontal scroll or four-point type. Same data, rebuilt as a stack of cards
 * with one job per card and the outcome readable without zooming.
 *
 * Three decisions worth keeping:
 *
 *  1. WINS ARE THE POINT. This screen is checked to answer one question — "are
 *     we winning tonight?" — so the win count is the biggest thing on it and
 *     wins are visually loud. Losses are present but quiet.
 *  2. It polls itself. Nobody wants to pull-to-refresh a monitoring screen every
 *     two minutes, and the desk version's manual Refresh button is a desk
 *     affordance. It refreshes on a timer and whenever the phone comes back to
 *     the foreground, which is the actual interaction: unlock, glance, pocket.
 *  3. It never blanks. A refresh keeps the previous data on screen and shows a
 *     thin progress line instead — a screen that empties itself every 60s reads
 *     as broken when you glance at it mid-fetch.
 */

const REFRESH_MS = 60_000;

interface FlipActivityRow {
  id: string;
  customerName: string;
  customerPhone: string;
  motorClub: string | null;
  vehicle: string | null;
  issueType: string | null;
  originalDestination: string | null;
  destinationType: string | null;
  flipEligible: boolean;
  noFlipReason: string | null;
  nearestOurShop: string | null;
  offer1Result: string | null;
  offer2Result: string | null;
  offer3Result: string | null;
  flipOutcome: string | null;
  conviniLinkSent: boolean;
  callTime: string;
}

interface FlipActivityResponse {
  items: FlipActivityRow[];
  today: { total: number; wins: number; losses: number; skipped: number; winRate: number };
}

type Bucket = 'WIN' | 'LOSS' | 'SKIPPED';

function bucketOutcome(r: FlipActivityRow): Bucket {
  if (r.flipOutcome && /WIN|ACCEPTED|SUCCESS/i.test(r.flipOutcome)) return 'WIN';
  if (!r.flipEligible) return 'SKIPPED';
  return 'LOSS';
}

/** How far the offer ladder actually got. The single best predictor of a win,
 *  and invisible on the desk table unless you read three separate columns. */
function offersMade(r: FlipActivityRow): number {
  return [r.offer1Result, r.offer2Result, r.offer3Result].filter(
    (o) => o && /ACCEPTED|DECLINED/i.test(o),
  ).length;
}

const NO_FLIP_REASON_LABELS: Record<string, string> = {
  destination_unknown: 'No business identified',
  destination_residence: 'Residential address',
  destination_auto_body: 'Auto body shop',
  destination_is_our_shop: 'Already our shop',
  aaa_branded_hard_block: 'AAA-branded (blocked)',
  regex_address_no_business_name: 'Address only, no name',
  no_signals_matched: 'No signals matched',
  flip_suppressed_no_nearby_shop_within_max_distance: 'No shop in range',
  agent_judged_flip_not_appropriate: 'Agent judged not appropriate',
};

function formatNoFlipReason(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.startsWith('no_flip_category_')) {
    const parts = reason.replace('no_flip_category_', '').split('_conf_');
    return `Non-flip type: ${(parts[0] ?? '').replace(/_/g, ' ')}`;
  }
  return NO_FLIP_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function MobileFlipActivityPage() {
  const [data, setData] = useState<FlipActivityResponse | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // Ref, not state: the poll callback must not be rebuilt (and the interval
  // torn down and recreated) every time a fetch flips `busy`.
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const qp = new URLSearchParams({ outcome: 'ALL', limit: '100' });
      const res = await api<{ data: FlipActivityResponse }>(
        `/v1/admin/flip-engine/activity?${qp.toString()}`,
      );
      setData(res.data);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      // Keep whatever is on screen. A stale number with a visible warning beats
      // an empty screen that looks like zero activity.
      setError((err as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    // Unlock-and-glance is the real interaction, so refresh on focus too —
    // otherwise the first thing seen is up to a minute stale.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const today = data?.today;
  const items = (data?.items ?? []).filter((r) => {
    if (filter === 'ALL') return true;
    return bucketOutcome(r) === filter;
  });

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-4">
      {/* Sticky header: the numbers stay visible while the list scrolls. */}
      <header className="sticky top-0 z-10 -mx-4 bg-[var(--surface-bg)]/95 px-4 pb-3 pt-1 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h1 className="font-semibold text-lg">Flip Activity</h1>
          <span className="text-[11px] text-[var(--text-muted)]">
            {updatedAt ? `updated ${clockTime(updatedAt.toISOString())}` : 'loading…'}
          </span>
        </div>

        {/* Progress line rather than a spinner that replaces content. */}
        <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-white/5">
          {busy && <div className="h-full w-1/3 animate-pulse rounded bg-sky-400/70" />}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatTile
            label="Wins today"
            value={today?.wins ?? 0}
            tone="win"
            big
          />
          <StatTile label="Win rate" value={`${today?.winRate ?? 0}%`} tone="neutral" big />
          <StatTile label="Calls" value={today?.total ?? 0} tone="muted" />
          <StatTile label="Losses" value={today?.losses ?? 0} tone="muted" />
        </div>

        <div className="mt-3 flex gap-2">
          {(['ALL', 'WIN', 'LOSS'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              // min-h-11: a real thumb target, not a desktop-sized chip.
              className={`min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium transition ${
                filter === f
                  ? 'border-sky-400/60 bg-sky-500/15 text-sky-200'
                  : 'border-white/10 bg-white/[0.03] text-[var(--text-muted)]'
              }`}
            >
              {f === 'ALL' ? 'All' : f === 'WIN' ? 'Wins' : 'Losses'}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Couldn&apos;t refresh: {error}
          {data ? ' — showing the last good data.' : ''}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {items.length === 0 && !busy && (
          <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            {filter === 'ALL'
              ? 'No flip activity yet today.'
              : `No ${filter === 'WIN' ? 'wins' : 'losses'} yet today.`}
          </p>
        )}
        {items.map((r) => (
          <ActivityCard key={r.id} row={r} />
        ))}
      </div>

      <button
        onClick={() => void load()}
        disabled={busy}
        className="mt-4 min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] text-sm font-medium text-[var(--text-secondary)] active:bg-white/[0.08] disabled:opacity-50"
      >
        {busy ? 'Refreshing…' : 'Refresh now'}
      </button>
    </main>
  );
}

function StatTile({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string | number;
  tone: 'win' | 'neutral' | 'muted';
  big?: boolean;
}) {
  const toneCls =
    tone === 'win'
      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
      : tone === 'neutral'
        ? 'border-sky-400/25 bg-sky-500/10 text-sky-200'
        : 'border-white/10 bg-white/[0.03] text-[var(--text-secondary)]';
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneCls}`}>
      <div className={big ? 'text-3xl font-semibold leading-tight' : 'text-xl font-semibold leading-tight'}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
    </div>
  );
}

function ActivityCard({ row }: { row: FlipActivityRow }) {
  const bucket = bucketOutcome(row);
  const offers = offersMade(row);
  const reason = formatNoFlipReason(row.noFlipReason);

  // A win gets a coloured edge and a lit background; everything else stays
  // quiet so wins are findable by thumb-scrolling without reading.
  const shell =
    bucket === 'WIN'
      ? 'border-emerald-400/40 bg-emerald-500/[0.08]'
      : bucket === 'LOSS'
        ? 'border-white/10 bg-white/[0.02]'
        : 'border-white/[0.06] bg-white/[0.01]';

  return (
    <article className={`rounded-xl border px-3 py-3 ${shell}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{row.customerName || 'Unknown'}</div>
          <div className="truncate text-xs text-[var(--text-muted)]">
            {row.vehicle || 'vehicle unknown'}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <OutcomeBadge bucket={bucket} />
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">{timeAgo(row.callTime)}</div>
        </div>
      </div>

      {bucket === 'WIN' && row.nearestOurShop && (
        <div className="mt-2 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-200">
          → {row.nearestOurShop}
        </div>
      )}

      {bucket !== 'WIN' && row.originalDestination && (
        <div className="mt-2 truncate text-xs text-[var(--text-muted)]">
          {row.originalDestination}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {row.destinationType && <Chip>{row.destinationType.replace(/_/g, ' ')}</Chip>}
        {/* Offers made is the leading indicator — zero offers on an eligible
            call is an adherence problem, not a bad-luck problem. */}
        {row.flipEligible && (
          <Chip tone={offers === 0 ? 'warn' : 'plain'}>
            {offers === 0 ? 'no offer made' : `${offers} offer${offers > 1 ? 's' : ''}`}
          </Chip>
        )}
        {bucket === 'SKIPPED' && reason && <Chip>{reason}</Chip>}
        {row.motorClub && <Chip>{row.motorClub}</Chip>}
      </div>
    </article>
  );
}

function OutcomeBadge({ bucket }: { bucket: Bucket }) {
  const cls =
    bucket === 'WIN'
      ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
      : bucket === 'LOSS'
        ? 'bg-rose-500/10 text-rose-200/80'
        : 'bg-white/5 text-[var(--text-muted)]';
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide ${cls}`}>
      {bucket}
    </span>
  );
}

function Chip({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warn' }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${
        tone === 'warn'
          ? 'bg-amber-500/15 text-amber-200'
          : 'bg-white/[0.06] text-[var(--text-muted)]'
      }`}
    >
      {children}
    </span>
  );
}
