'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/utils';

/**
 * Who has rung in asking where their truck is.
 *
 * Chris, 2026-08-23: "notify the office this person on this job called for an
 * eta - provide an alert so we can monitor that call".
 *
 * Sorted by call COUNT first, not recency. Somebody on their third call is a
 * bigger problem than somebody who rang thirty seconds ago, and a plain
 * reverse-chronological list buries exactly the person about to complain.
 *
 * The raw ETA string is shown here and ONLY here. Emily is forbidden from
 * reading it to a caller — it says things like "5 hrs 54 mins late" — but the
 * office needs to see the lateness the customer was not told about.
 *
 * Colours are LITERAL on this route. The dark palette lives in `.dark {}` and
 * nothing sets it outside /admin; /m/flip shipped unreadable for exactly that.
 */

interface EtaCheck {
  id: string;
  jobId: string;
  customerName: string | null;
  customerPhone: string;
  vehicle: string | null;
  driverName: string | null;
  pickup: string | null;
  destination: string | null;
  jobStatus: string | null;
  etaRaw: string | null;
  calls: number;
  firstCalledAt: string;
  lastCalledAt: string;
  handledAt: string | null;
}

const since = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/** "(5 hrs 54 mins late)" is the only part of the ETA string worth a headline. */
const lateness = (eta: string | null) => {
  const m = eta?.match(/\(([^)]*\blate\b[^)]*)\)/i);
  return m ? m[1] : null;
};

export default function RoadsideBoard() {
  const [rows, setRows] = useState<EtaCheck[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<EtaCheck[] | { data: EtaCheck[] }>(
        '/v1/admin/command-center/eta-checks',
      );
      setRows(Array.isArray(res) ? res : res.data);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    // Someone waiting on a truck is a live situation; a minute is the most
    // staleness that is useful here.
    const t = setInterval(() => void load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  const handled = async (id: string) => {
    setBusy(id);
    try {
      await api(`/v1/admin/command-center/eta-checks/${id}/handled`, {
        method: 'POST',
        json: {},
      });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const repeat = (rows ?? []).filter((r) => r.calls > 1);
  const once = (rows ?? []).filter((r) => r.calls === 1);

  return (
    <div
      style={{ background: '#0b1120', minHeight: '100vh', color: '#e2e8f0' }}
      className="px-4 py-5 font-sans"
    >
      <div className="mx-auto max-w-xl">
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-white">Roadside — ETA calls</h1>
          <button onClick={() => void load()} className="text-xs text-slate-400 underline">
            refresh
          </button>
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-rose-700 bg-rose-950 p-3 text-sm text-rose-100">
            {err}
          </div>
        )}

        {repeat.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-400">
              Called more than once — {repeat.length}
            </div>
            {repeat.map((r) => (
              <Card key={r.id} r={r} hot onDone={handled} busy={busy === r.id} />
            ))}
          </div>
        )}

        {once.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400">
              Called once — {once.length}
            </div>
            {once.map((r) => (
              <Card key={r.id} r={r} onDone={handled} busy={busy === r.id} />
            ))}
          </div>
        )}

        {rows && rows.length === 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-center text-sm text-slate-400">
            Nobody has called about a tow.
          </div>
        )}

        {!rows && <div className="py-10 text-center text-sm text-slate-500">Loading…</div>}
      </div>
    </div>
  );
}

function Card({
  r,
  hot,
  onDone,
  busy,
}: {
  r: EtaCheck;
  hot?: boolean;
  onDone: (id: string) => void;
  busy: boolean;
}) {
  const late = lateness(r.etaRaw);
  return (
    <div
      className="mb-2 rounded-lg p-3"
      style={{
        background: hot ? '#450a0a' : '#1c1917',
        border: `2px solid ${hot ? '#f87171' : '#f59e0b'}`,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-base font-bold text-white">
          {r.customerName || 'Unknown caller'}
        </span>
        {r.calls > 1 && (
          <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white">
            {r.calls}× calls
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">{since(r.lastCalledAt)}</span>
      </div>

      <div className="mt-1 text-sm text-slate-300">
        {[r.vehicle, r.driverName ? `driver ${r.driverName}` : null, r.jobStatus]
          .filter(Boolean)
          .join(' · ')}
      </div>

      {(r.pickup || r.destination) && (
        <div className="mt-1 text-xs text-slate-400">
          {r.pickup}
          {r.destination ? ` → ${r.destination}` : ''}
        </div>
      )}

      {/* Office-only. Emily never says this out loud. */}
      {late ? (
        <div className="mt-2 rounded bg-rose-950 px-2 py-1 text-xs font-bold text-rose-200">
          Board says: {late}
        </div>
      ) : (
        r.etaRaw && <div className="mt-2 text-xs text-slate-500">Board ETA: {r.etaRaw}</div>
      )}

      <div className="mt-3 flex gap-2">
        <a
          href={`tel:${r.customerPhone}`}
          className="flex-1 rounded-md bg-emerald-600 py-2.5 text-center text-sm font-bold text-white"
        >
          Call {r.customerPhone}
        </a>
        <button
          onClick={() => onDone(r.id)}
          disabled={busy}
          className="rounded-md border border-slate-600 px-3 text-sm text-slate-300 disabled:opacity-50"
        >
          {busy ? '…' : 'Done'}
        </button>
      </div>
    </div>
  );
}
