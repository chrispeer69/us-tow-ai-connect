'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/utils';

/**
 * Session 81 — the USTA board, for a phone.
 *
 * Chris, 2026-08-22: he wants somewhere that reports results and red-alerts him
 * to problems and successes — especially callers who want to talk to him
 * directly, now or at a set time.
 *
 * Built for the moment a notification lands: he is holding a phone, possibly
 * driving, and the only question is "who do I ring and what do I say". So the
 * people waiting for him are at the top at full size, and the statistics are
 * small and underneath. A dashboard that leads with numbers would bury the one
 * thing that is time-sensitive.
 *
 * Colours are LITERAL on this route. The dark palette lives in `.dark {}` and
 * `[data-theme='dark']{}` and NOTHING sets either outside /admin — the /m/flip
 * page shipped unreadable in Session 77 for exactly this reason.
 */

interface Request {
  id: string;
  company: string | null;
  contactName: string | null;
  phone: string;
  urgency: string;
  preferredTime: string | null;
  note: string | null;
  recordingUrl: string | null;
  createdAt: string;
}

interface Callback {
  id: string;
  phone: string;
  company: string | null;
  durationSeconds: number | null;
  summary: string | null;
  recordingUrl: string | null;
  createdAt: string;
}

interface Board {
  requests: Request[];
  callbacks: Callback[];
  today: {
    dialed?: number; pitched?: number; voicemails?: number;
    warm?: number; callbacks?: number; optouts?: number;
  };
  problems: Array<{ kind: string; n: number }>;
}

const since = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export default function UstaBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: Board }>('/v1/admin/campaigns/board/summary');
      setBoard(res.data);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    // He may leave this open on a desk. A minute is often enough to catch a
    // request before the caller gives up.
    const t = setInterval(() => void load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  const handled = async (id: string) => {
    setBusy(id);
    try {
      await api(`/v1/admin/campaigns/board/requests/${id}/handled`, { method: 'POST', json: {} });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const t = board?.today ?? {};
  const urgent = (board?.requests ?? []).filter((r) => r.urgency === 'now');
  const rest = (board?.requests ?? []).filter((r) => r.urgency !== 'now');

  return (
    <div style={{ background: '#0b1120', minHeight: '100vh', color: '#e2e8f0' }}
         className="px-4 py-5 font-sans">
      <div className="mx-auto max-w-xl">

        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-white">US Tow Alliance</h1>
          <button onClick={() => void load()} className="text-xs text-slate-400 underline">
            refresh
          </button>
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-rose-700 bg-rose-950 p-3 text-sm text-rose-100">
            {err}
          </div>
        )}

        {/* ---- problems: red, loud, above everything ------------------- */}
        {(board?.problems ?? []).map((p) => (
          <div key={p.kind}
               className="mb-3 rounded-lg border-2 border-rose-500 bg-rose-950 p-3 text-sm font-semibold text-rose-100">
            {p.kind === 'stalled'
              ? `${p.n} call${p.n === 1 ? '' : 's'} stuck with no result — the dialler may be wedged`
              : `${p.n} call error${p.n === 1 ? '' : 's'} in the last 24h`}
          </div>
        ))}

        {/* ---- people waiting for Chris -------------------------------- */}
        {urgent.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-400">
              Call now — {urgent.length} waiting
            </div>
            {urgent.map((r) => <RequestCard key={r.id} r={r} hot onDone={handled} busy={busy === r.id} />)}
          </div>
        )}

        {rest.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400">
              Wants to talk — {rest.length}
            </div>
            {rest.map((r) => <RequestCard key={r.id} r={r} onDone={handled} busy={busy === r.id} />)}
          </div>
        )}

        {board && urgent.length === 0 && rest.length === 0 && (
          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900 p-4 text-center text-sm text-slate-400">
            Nobody waiting on a call back.
          </div>
        )}

        {/* ---- today ---------------------------------------------------- */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <Stat label="Dialed" value={t.dialed ?? 0} />
          <Stat label="Pitched" value={t.pitched ?? 0} colour="#34d399" />
          <Stat label="Callbacks" value={t.callbacks ?? 0} colour="#60a5fa" />
          <Stat label="Voicemails" value={t.voicemails ?? 0} />
          <Stat label="Warm" value={t.warm ?? 0} colour="#fbbf24" />
          <Stat label="Opt-outs" value={t.optouts ?? 0} colour="#fb7185" />
        </div>

        {/* ---- who rang us --------------------------------------------- */}
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          Rang us back
        </div>
        {(board?.callbacks ?? []).length === 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm text-slate-500">
            No callbacks yet.
          </div>
        )}
        {(board?.callbacks ?? []).map((c) => (
          <div key={c.id} className="mb-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-white">{c.company ?? 'Unknown company'}</span>
              <a href={`tel:${c.phone}`} className="text-sm text-sky-400 underline">{c.phone}</a>
              <span className="ml-auto text-xs text-slate-500">
                {c.durationSeconds ?? 0}s · {since(c.createdAt)}
              </span>
            </div>
            {c.summary && <p className="mt-1 text-xs text-slate-400">{c.summary}</p>}
            {c.recordingUrl && (
              <audio controls preload="none" src={c.recordingUrl} className="mt-2 w-full" style={{ height: 32 }} />
            )}
          </div>
        ))}

        {!board && <div className="py-10 text-center text-sm text-slate-500">Loading…</div>}
      </div>
    </div>
  );
}

function RequestCard({
  r, hot, onDone, busy,
}: { r: Request; hot?: boolean; onDone: (id: string) => void; busy: boolean }) {
  return (
    <div className="mb-2 rounded-lg p-3"
         style={{
           background: hot ? '#450a0a' : '#1c1917',
           border: `2px solid ${hot ? '#f87171' : '#f59e0b'}`,
         }}>
      <div className="text-base font-bold text-white">
        {r.company || r.contactName || 'A towing company'}
      </div>
      {r.contactName && r.company && (
        <div className="text-sm text-slate-300">{r.contactName}</div>
      )}
      {r.note && <p className="mt-1 text-sm text-slate-300">{r.note}</p>}
      <div className="mt-1 text-xs text-slate-400">
        {r.preferredTime ? `Wants: ${r.preferredTime}` : hot ? 'Wants a call now' : 'No time given'}
        {' · '}{since(r.createdAt)}
      </div>

      {/* A phone number on a phone should be one tap, not a copy-paste. */}
      <div className="mt-3 flex gap-2">
        <a href={`tel:${r.phone}`}
           className="flex-1 rounded-md bg-emerald-600 py-2.5 text-center text-sm font-bold text-white">
          Call {r.phone}
        </a>
        <button onClick={() => onDone(r.id)} disabled={busy}
                className="rounded-md border border-slate-600 px-3 text-sm text-slate-300 disabled:opacity-50">
          {busy ? '…' : 'Done'}
        </button>
      </div>

      {r.recordingUrl && (
        <audio controls preload="none" src={r.recordingUrl} className="mt-2 w-full" style={{ height: 32 }} />
      )}
    </div>
  );
}

function Stat({ label, value, colour }: { label: string; value: number; colour?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-center">
      <div className="text-lg font-bold" style={{ color: colour ?? '#e2e8f0' }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
