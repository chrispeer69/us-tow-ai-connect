'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/utils';

/**
 * Session 77 — Flip Activity, for a phone in the evening.
 *
 * Chris, 2026-08-18: "so that in the evening we can monitor it on mobile",
 * then "only show the wins and when a win occurs alert my phone by popping up
 * a window".
 *
 * Decisions worth keeping:
 *
 *  1. COLOURS ARE LITERAL, NOT THEME VARIABLES. The first build inherited
 *     var(--text-muted) etc., which live in `.dark {}` — a class nothing sets on
 *     this route — so the page rendered on white with every badge washed out.
 *     It "worked" in every automated sense and was unreadable. Nothing here
 *     depends on a theme being applied.
 *  2. WINS ARE THE POINT. Wins-only is a real mode, remembered between visits,
 *     and a new win fires a notification.
 *  3. NEVER ALERT FOR HISTORY. The seen-set is seeded from the first load and
 *     persisted, so opening the page never fires a burst of notifications for
 *     wins that happened hours ago. Only genuinely new ones alert.
 *  4. It never blanks on refresh — an empty screen mid-fetch reads as "no
 *     activity", which is the one wrong answer this screen must never give.
 */

const REFRESH_MS = 60_000;
const SEEN_KEY = 'flip_seen_win_ids';
const WINS_ONLY_KEY = 'flip_wins_only';

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
    return `Non-flip: ${(parts[0] ?? '').replace(/_/g, ' ')}`;
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

function clockTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function MobileFlipActivityPage() {
  const [data, setData] = useState<FlipActivityResponse | null>(null);
  const [winsOnly, setWinsOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [notifyState, setNotifyState] = useState<'unsupported' | 'default' | 'granted' | 'denied'>(
    'default',
  );
  /** The win that just landed, shown as an in-page popup as well as a system
   *  notification — the notification may be suppressed by the OS, the popup
   *  never is. */
  const [popup, setPopup] = useState<FlipActivityRow | null>(null);

  const busyRef = useRef(false);
  const seenRef = useRef<Set<string> | null>(null);

  // Restore preferences before the first fetch resolves.
  useEffect(() => {
    try {
      setWinsOnly(localStorage.getItem(WINS_ONLY_KEY) === '1');
      const raw = localStorage.getItem(SEEN_KEY);
      seenRef.current = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      seenRef.current = new Set();
    }
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifyState(Notification.permission as 'default' | 'granted' | 'denied');
    } else {
      setNotifyState('unsupported');
    }
  }, []);

  const announce = useCallback((win: FlipActivityRow) => {
    setPopup(win);
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {
      /* vibration is a nicety, never a failure */
    }
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification('Flip win', {
          body: `${win.customerName || 'Customer'}${
            win.nearestOurShop ? ` → ${win.nearestOurShop}` : ''
          }`,
          tag: `flip-win-${win.id}`, // dedupes if the OS replays it
          icon: '/favicon.ico',
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      }
    } catch {
      /* notification failure must never break the refresh loop */
    }
  }, []);

  const load = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const qp = new URLSearchParams({ outcome: 'ALL', limit: '100' });
      const res = await api<{ data: FlipActivityResponse }>(
        `/v1/admin/flip-engine/activity?${qp.toString()}`,
      );
      const next = res.data;

      // Alert on genuinely new wins only. On the very first load we seed the
      // set silently: opening the page must never fire five notifications for
      // wins that happened this morning.
      const seen = seenRef.current;
      if (seen) {
        const wins = next.items.filter((r) => bucketOutcome(r) === 'WIN');
        const firstLoad = seen.size === 0 && data === null;
        const fresh = wins.filter((w) => !seen.has(w.id));
        for (const w of wins) seen.add(w.id);
        try {
          localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
        } catch {
          /* private mode — alerting still works for this session */
        }
        if (!firstLoad && fresh.length > 0) announce(fresh[0]);
      }

      setData(next);
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
  }, [announce, data]);

  // Deliberately depends on nothing: re-creating the interval on every fetch
  // would reset the timer forever and it would never actually fire.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void loadRef.current();
    const t = setInterval(() => void loadRef.current(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const askNotify = async () => {
    if (!('Notification' in window)) return;
    const p = await Notification.requestPermission();
    setNotifyState(p as 'default' | 'granted' | 'denied');
  };

  const toggleWinsOnly = () => {
    setWinsOnly((v) => {
      const next = !v;
      try {
        localStorage.setItem(WINS_ONLY_KEY, next ? '1' : '0');
      } catch {
        /* preference is a nicety */
      }
      return next;
    });
  };

  const today = data?.today;
  const items = (data?.items ?? []).filter((r) => !winsOnly || bucketOutcome(r) === 'WIN');

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-4 text-white">
      {popup && <WinPopup row={popup} onClose={() => setPopup(null)} />}

      <header className="sticky top-0 z-10 -mx-4 border-b border-slate-800 bg-[#050a18] px-4 pb-3 pt-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold text-white">Flip Activity</h1>
          <span className="text-[11px] text-slate-400">
            {updatedAt ? `updated ${clockTime(updatedAt)}` : 'loading…'}
          </span>
        </div>

        <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-slate-800">
          {busy && <div className="h-full w-1/3 animate-pulse rounded bg-sky-400" />}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatTile label="Wins today" value={today?.wins ?? 0} tone="win" big />
          <StatTile label="Win rate" value={`${today?.winRate ?? 0}%`} tone="info" big />
          <StatTile label="Calls" value={today?.total ?? 0} tone="plain" />
          <StatTile label="Losses" value={today?.losses ?? 0} tone="plain" />
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={toggleWinsOnly}
            className={`min-h-11 flex-1 rounded-lg border px-3 text-sm font-semibold transition ${
              winsOnly
                ? 'border-emerald-400 bg-emerald-500/25 text-emerald-100'
                : 'border-slate-700 bg-slate-800/60 text-slate-300'
            }`}
          >
            {winsOnly ? '✓ Wins only' : 'Wins only'}
          </button>
          <button
            onClick={() => void loadRef.current()}
            disabled={busy}
            className="min-h-11 rounded-lg border border-slate-700 bg-slate-800/60 px-4 text-sm font-medium text-slate-200 active:bg-slate-700 disabled:opacity-50"
          >
            {busy ? '…' : 'Refresh'}
          </button>
        </div>

        {notifyState === 'default' && (
          <button
            onClick={() => void askNotify()}
            className="mt-2 min-h-11 w-full rounded-lg border border-sky-500 bg-sky-500/20 px-3 text-sm font-semibold text-sky-100"
          >
            Alert me when a win comes in
          </button>
        )}
        {notifyState === 'denied' && (
          <p className="mt-2 rounded-lg border border-amber-600 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
            Notifications are blocked for this site. Turn them on in your browser&apos;s site
            settings — the on-screen popup below still works either way.
          </p>
        )}
      </header>

      {error && (
        <p className="mt-3 rounded-lg border border-amber-600 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
          Couldn&apos;t refresh: {error}
          {data ? ' — showing the last good data.' : ''}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {items.length === 0 && !busy && (
          <p className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-10 text-center text-sm text-slate-400">
            {winsOnly ? 'No wins yet today.' : 'No flip activity yet today.'}
          </p>
        )}
        {items.map((r) => (
          <ActivityCard key={r.id} row={r} />
        ))}
      </div>
    </main>
  );
}

/** The in-page popup. Exists because a system notification can be silently
 *  suppressed by the OS, by focus mode, or by an unsupported browser — this one
 *  cannot be. */
function WinPopup({ row, onClose }: { row: FlipActivityRow; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 30_000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3">
      <div className="w-full max-w-md rounded-xl border-2 border-emerald-400 bg-emerald-950 p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-300">
              Flip win
            </div>
            <div className="mt-1 truncate text-lg font-semibold text-white">
              {row.customerName || 'Customer'}
            </div>
            {row.nearestOurShop && (
              <div className="mt-0.5 truncate text-sm text-emerald-200">→ {row.nearestOurShop}</div>
            )}
            {row.vehicle && <div className="mt-0.5 truncate text-xs text-emerald-300/80">{row.vehicle}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="Dismiss"
            className="min-h-11 min-w-11 shrink-0 rounded-lg bg-emerald-900 text-lg font-bold text-emerald-200 active:bg-emerald-800"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
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
  tone: 'win' | 'info' | 'plain';
  big?: boolean;
}) {
  const toneCls =
    tone === 'win'
      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
      : tone === 'info'
        ? 'border-sky-500 bg-sky-500/15 text-sky-200'
        : 'border-slate-700 bg-slate-800/60 text-slate-200';
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneCls}`}>
      <div className={`${big ? 'text-3xl' : 'text-xl'} font-semibold leading-tight`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}

function ActivityCard({ row }: { row: FlipActivityRow }) {
  const bucket = bucketOutcome(row);
  const offers = offersMade(row);
  const reason = formatNoFlipReason(row.noFlipReason);

  const shell =
    bucket === 'WIN'
      ? 'border-emerald-500 bg-emerald-500/12'
      : bucket === 'LOSS'
        ? 'border-slate-700 bg-slate-900/70'
        : 'border-slate-800 bg-slate-900/40';

  return (
    <article className={`rounded-xl border px-3 py-3 ${shell}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">
            {row.customerName || 'Unknown'}
          </div>
          <div className="truncate text-xs text-slate-400">{row.vehicle || 'vehicle unknown'}</div>
        </div>
        <div className="shrink-0 text-right">
          <OutcomeBadge bucket={bucket} />
          <div className="mt-1 text-[11px] text-slate-400">{timeAgo(row.callTime)}</div>
        </div>
      </div>

      {bucket === 'WIN' && row.nearestOurShop && (
        <div className="mt-2 rounded-lg bg-emerald-500/20 px-2 py-1.5 text-xs font-medium text-emerald-100">
          → {row.nearestOurShop}
        </div>
      )}

      {bucket !== 'WIN' && row.originalDestination && (
        <div className="mt-2 truncate text-xs text-slate-400">{row.originalDestination}</div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {row.destinationType && <Chip>{row.destinationType.replace(/_/g, ' ')}</Chip>}
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
      ? 'bg-emerald-500 text-emerald-950'
      : bucket === 'LOSS'
        ? 'bg-rose-500/25 text-rose-200'
        : 'bg-slate-700 text-slate-300';
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${cls}`}>
      {bucket}
    </span>
  );
}

function Chip({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warn' }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        tone === 'warn' ? 'bg-amber-500/25 text-amber-200' : 'bg-slate-700/80 text-slate-300'
      }`}
    >
      {children}
    </span>
  );
}
