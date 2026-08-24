'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/utils';

/**
 * Alpha Automotive's crash-lead call review board.
 *
 * A different system from the towing flip board (/m/flip) — this reads
 * transcripts, recordings and outcome stats from a separate service
 * (github.com/chrispeer69/retell-middleware, its own Postgres) through
 * Command Center's `/v1/alpha-crash-calls/*` proxy. Push delivery is the one
 * thing shared with the towing board: the same VAPID/`/v1/admin/flip-push/*`
 * plumbing, registered under this page's own service-worker scope so the two
 * boards' subscriptions don't collide.
 */

const REFRESH_MS = 60_000;

const POSITIVE_OUTCOMES = new Set([
  'interested_transfer',
  'interested_callback',
  'interested_not_scheduled',
  'estimate_requested',
  'booked',
  'information_requested',
]);

const OUTCOME_LABEL: Record<string, string> = {
  interested_transfer: 'Wants to talk now',
  interested_callback: 'Wants a callback',
  interested_not_scheduled: 'Interested',
  estimate_requested: 'Wants an estimate',
  booked: 'Booked',
  information_requested: 'Wants info',
  do_not_call: 'Do not call',
  wrong_number: 'Wrong number',
  unavailable: 'Unavailable',
  no_current_need: 'No current need',
  already_repaired: 'Already repaired',
  total_loss: 'Total loss',
  soft_no: 'Not interested',
  transfer_failed: 'Transfer failed',
  emergency: 'Emergency mentioned',
  invalid: 'Invalid call',
};

interface AlphaCallSummary {
  id: string;
  call_id: string;
  contact_id: string | null;
  direction: string | null;
  created_at: string | null;
  customer_name: string | null;
  duration_ms: number | null;
  recording_url: string | null;
  call_outcome: string | null;
  call_summary: string | null;
  preferred_callback_time: string | null;
  in_voicemail: boolean | null;
}

interface AlphaCallDetail extends AlphaCallSummary {
  transcript: string | null;
}

interface StatsResponse {
  total: number;
  voicemail: number;
  by_outcome: Record<string, number>;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function clockTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDuration(ms: number | null): string {
  if (!ms) return '—';
  const secs = Math.round(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function startOfDayIso(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

/** The Push API wants the VAPID public key as a Uint8Array; browsers don't
 *  convert base64url for you. See FlipBoard.tsx for the same helper. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

type PushState = 'idle' | 'subscribing' | 'on' | 'blocked' | 'error' | 'unsupported';

export default function AlphaFlipsBoard() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [calls, setCalls] = useState<AlphaCallSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [positiveOnly, setPositiveOnly] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AlphaCallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [pushState, setPushState] = useState<PushState>('idle');
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [notifyState, setNotifyState] = useState<'unsupported' | 'default' | 'granted' | 'denied'>(
    'default',
  );

  const busyRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifyState(Notification.permission as 'default' | 'granted' | 'denied');
      if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        void (async () => {
          const reg = await navigator.serviceWorker.getRegistration('/alpha/');
          const sub = await reg?.pushManager.getSubscription();
          if (sub) setPushState('on');
        })();
      }
    } else {
      setNotifyState('unsupported');
    }
  }, []);

  const load = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        api<{ data: StatsResponse }>(`/v1/alpha-crash-calls/stats?since=${startOfDayIso(6)}`),
        api<{ data: { calls: AlphaCallSummary[] } }>('/v1/alpha-crash-calls?limit=100'),
      ]);
      setStats(statsRes.data);
      setCalls(listRes.data.calls);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

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

  const toggleExpand = useCallback(
    async (row: AlphaCallSummary) => {
      if (expandedId === row.call_id) {
        setExpandedId(null);
        setDetail(null);
        return;
      }
      setExpandedId(row.call_id);
      setDetail(null);
      setDetailLoading(true);
      try {
        const res = await api<{ data: AlphaCallDetail }>(
          `/v1/alpha-crash-calls/${encodeURIComponent(row.call_id)}`,
        );
        setDetail(res.data);
      } catch (err) {
        setPushNote((err as Error).message);
      } finally {
        setDetailLoading(false);
      }
    },
    [expandedId],
  );

  const askNotify = async () => {
    if (!('Notification' in window)) return;
    const p = await Notification.requestPermission();
    setNotifyState(p as 'default' | 'granted' | 'denied');
    if (p === 'granted') void enablePush();
  };

  const enablePush = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported');
      setPushNote('This browser cannot do background push. On iPhone, add this page to your Home Screen first.');
      return;
    }
    if (Notification.permission === 'denied') {
      setPushState('blocked');
      return;
    }
    setPushState('subscribing');
    setPushNote(null);
    try {
      const key = await api<{ data: { enabled: boolean; publicKey: string | null } }>(
        '/v1/admin/flip-push/public-key',
      );
      if (!key.data.enabled || !key.data.publicKey) {
        setPushState('error');
        setPushNote('Push is not configured on the server yet (VAPID keys missing).');
        return;
      }

      // Own scope so this subscription doesn't collide with the towing flip
      // board's — same worker file, both are generic push displayers.
      const reg = await navigator.serviceWorker.register('/flip-sw.js', { scope: '/alpha/' });
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key.data.publicKey),
        });
      }

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      await api('/v1/admin/flip-push/subscribe', {
        method: 'POST',
        json: {
          endpoint: json.endpoint,
          keys: json.keys,
          label: `alpha-flips · ${navigator.platform || 'device'}`,
        },
      });
      setPushState('on');
      setPushNote(null);
    } catch (err) {
      setPushState('error');
      setPushNote((err as Error).message);
    }
  }, []);

  const sendTestPush = useCallback(async () => {
    try {
      const res = await api<{ data: { sent: number; removed: number; skipped: boolean } }>(
        '/v1/admin/flip-push/test',
        { method: 'POST' },
      );
      const d = res.data;
      setPushNote(
        d.skipped
          ? 'Nothing sent — no registered devices, or push is not configured.'
          : `Sent to ${d.sent} device${d.sent === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setPushNote((err as Error).message);
    }
  }, []);

  const today = calls.filter((c) => c.created_at && new Date(c.created_at) >= new Date(startOfDayIso(0)));
  const positiveToday = today.filter((c) => c.call_outcome && POSITIVE_OUTCOMES.has(c.call_outcome));
  const shown = positiveOnly
    ? calls.filter((c) => c.call_outcome && POSITIVE_OUTCOMES.has(c.call_outcome))
    : calls;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4 text-white">
      <header className="sticky top-0 z-10 -mx-4 border-b border-stone-800 bg-[#1c1917] px-4 pb-3 pt-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold text-white">Alpha Crash Leads</h1>
          <span className="text-[11px] text-stone-400">
            {updatedAt ? `updated ${clockTime(updatedAt.toISOString())}` : 'loading…'}
          </span>
        </div>

        <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-stone-800">
          {busy && <div className="h-full w-1/3 animate-pulse rounded bg-orange-400" />}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatTile label="Calls today" value={today.length} tone="plain" big />
          <StatTile label="Interested today" value={positiveToday.length} tone="win" big />
          <StatTile label="Calls, 7 days" value={stats?.total ?? 0} tone="plain" />
          <StatTile label="Voicemail, 7 days" value={stats?.voicemail ?? 0} tone="plain" />
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setPositiveOnly((v) => !v)}
            className={`min-h-11 flex-1 rounded-lg border px-3 text-sm font-semibold transition ${
              positiveOnly
                ? 'border-orange-400 bg-orange-500/25 text-orange-100'
                : 'border-stone-700 bg-stone-800/60 text-stone-300'
            }`}
          >
            {positiveOnly ? '✓ Interested only' : 'Interested only'}
          </button>
          <button
            onClick={() => void loadRef.current()}
            disabled={busy}
            className="min-h-11 rounded-lg border border-stone-700 bg-stone-800/60 px-4 text-sm font-medium text-stone-200 active:bg-stone-700 disabled:opacity-50"
          >
            {busy ? '…' : 'Refresh'}
          </button>
        </div>

        {pushState !== 'on' && notifyState !== 'denied' && (
          <button
            onClick={() => void askNotify()}
            disabled={pushState === 'subscribing'}
            className="mt-2 min-h-11 w-full rounded-lg border border-orange-500 bg-orange-500/20 px-3 text-sm font-semibold text-orange-100 disabled:opacity-60"
          >
            {pushState === 'subscribing' ? 'Setting up…' : 'Alert me when someone is interested'}
          </button>
        )}

        {pushState === 'on' && (
          <div className="mt-2 flex items-center gap-2">
            <span className="flex-1 rounded-lg border border-orange-600 bg-orange-500/15 px-3 py-2 text-xs font-semibold text-orange-200">
              ✓ Alerts on — this device will buzz on interest, even locked
            </span>
            <button
              onClick={() => void sendTestPush()}
              className="min-h-11 rounded-lg border border-stone-600 bg-stone-800 px-3 text-xs font-medium text-stone-200 active:bg-stone-700"
            >
              Test
            </button>
          </div>
        )}

        {notifyState === 'denied' && (
          <p className="mt-2 rounded-lg border border-amber-600 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
            Notifications are blocked for this site — turn them on in your browser&apos;s site settings.
          </p>
        )}

        {pushNote && (
          <p className="mt-2 rounded-lg border border-stone-600 bg-stone-800/80 px-3 py-2 text-xs text-stone-200">
            {pushNote}
          </p>
        )}
      </header>

      {error && (
        <p className="mt-3 rounded-lg border border-amber-600 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
          Couldn&apos;t refresh: {error}
          {calls.length ? ' — showing the last good data.' : ''}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {shown.length === 0 && !busy && (
          <p className="rounded-xl border border-stone-800 bg-stone-900/60 px-4 py-10 text-center text-sm text-stone-400">
            {positiveOnly ? 'No interested calls yet.' : 'No calls yet.'}
          </p>
        )}
        {shown.map((row) => (
          <CallCard
            key={row.call_id}
            row={row}
            expanded={expandedId === row.call_id}
            detail={expandedId === row.call_id ? detail : null}
            detailLoading={expandedId === row.call_id && detailLoading}
            onToggle={() => void toggleExpand(row)}
          />
        ))}
      </div>
    </main>
  );
}

function CallCard({
  row,
  expanded,
  detail,
  detailLoading,
  onToggle,
}: {
  row: AlphaCallSummary;
  expanded: boolean;
  detail: AlphaCallDetail | null;
  detailLoading: boolean;
  onToggle: () => void;
}) {
  const positive = row.call_outcome && POSITIVE_OUTCOMES.has(row.call_outcome);
  const label = row.call_outcome ? (OUTCOME_LABEL[row.call_outcome] ?? row.call_outcome) : 'Pending analysis';

  return (
    <article
      className={`rounded-xl border px-3 py-3 ${
        positive ? 'border-orange-500 bg-orange-500/10' : 'border-stone-800 bg-stone-900/60'
      }`}
    >
      <button onClick={onToggle} className="flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">
            {row.customer_name || 'Unknown caller'}
          </div>
          <div className="mt-0.5 text-xs text-stone-400">
            {row.direction === 'inbound' ? 'inbound' : 'outbound'} · {fmtDuration(row.duration_ms)}
            {row.in_voicemail ? ' · voicemail' : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${
              positive ? 'bg-orange-500 text-orange-950' : 'bg-stone-700 text-stone-300'
            }`}
          >
            {label}
          </span>
          <div className="mt-1 text-[11px] text-stone-400">{timeAgo(row.created_at)}</div>
        </div>
      </button>

      {row.call_summary && !expanded && (
        <p className="mt-2 truncate text-xs text-stone-400">{row.call_summary}</p>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-stone-800 pt-3">
          {detailLoading && <p className="text-xs text-stone-400">Loading…</p>}
          {detail && (
            <>
              {detail.call_summary && (
                <p className="text-sm text-stone-200">{detail.call_summary}</p>
              )}
              {detail.preferred_callback_time && (
                <p className="text-xs text-orange-300">
                  Callback requested: {detail.preferred_callback_time}
                </p>
              )}
              {detail.recording_url && (
                <audio controls src={detail.recording_url} className="w-full" preload="none" />
              )}
              {detail.transcript ? (
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-stone-950 p-3 text-xs text-stone-300">
                  {detail.transcript}
                </pre>
              ) : (
                <p className="text-xs text-stone-500">No transcript recorded for this call.</p>
              )}
            </>
          )}
        </div>
      )}
    </article>
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
  tone: 'win' | 'plain';
  big?: boolean;
}) {
  const toneCls =
    tone === 'win'
      ? 'border-orange-500 bg-orange-500/15 text-orange-200'
      : 'border-stone-700 bg-stone-800/60 text-stone-200';
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneCls}`}>
      <div className={`${big ? 'text-3xl' : 'text-xl'} font-semibold leading-tight`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}
