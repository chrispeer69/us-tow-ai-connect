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

/** A message Emily took instead of transferring the call — her third move
 *  besides answer-it or hand-it-away. See dispatch_messages / ai-connect.service.ts. */
interface DispatchMessage {
  id: string;
  callerName: string | null;
  callerPhone: string;
  jobNumber: string | null;
  topic: string;
  urgency: string;
  message: string;
  callbackRequested: boolean;
  callbackWindow: string | null;
  takenAt: string;
  handledAt: string | null;
}

/** One row per call to the 844 line, with transcript + recording — captured
 *  since migration 0056, unreachable from any UI until this page. */
interface InboundCall {
  id: string;
  providerCallId: string;
  fromNumber: string | null;
  toNumber: string | null;
  branch: string;
  durationSeconds: number | null;
  disconnectionReason: string | null;
  recordingUrl: string | null;
  summary: string | null;
  ustdJobNumber: string | null;
  startedAt: string | null;
  createdAt: string;
}

interface InboundCallDetail extends InboundCall {
  transcript: string | null;
}

const BRANCH_LABEL: Record<string, string> = {
  update: 'ETA check',
  new_tow: 'New tow',
  motor_club: 'Motor club',
  unknown: 'Unsorted',
};

const fmtDuration = (secs: number | null) => {
  if (!secs) return '—';
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
};

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
  const [messages, setMessages] = useState<DispatchMessage[] | null>(null);
  const [calls, setCalls] = useState<InboundCall[] | null>(null);
  const [phoneFilter, setPhoneFilter] = useState('');
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [callDetail, setCallDetail] = useState<InboundCallDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (phone?: string) => {
    try {
      const qs = phone ? `?phone=${encodeURIComponent(phone)}` : '';
      const [etaRes, msgRes, callRes] = await Promise.all([
        api<EtaCheck[] | { data: EtaCheck[] }>('/v1/admin/command-center/eta-checks'),
        api<DispatchMessage[] | { data: DispatchMessage[] }>(
          '/v1/admin/command-center/dispatch-messages',
        ),
        api<InboundCall[] | { data: InboundCall[] }>(
          `/v1/admin/command-center/inbound-calls${qs}`,
        ),
      ]);
      setRows(Array.isArray(etaRes) ? etaRes : etaRes.data);
      setMessages(Array.isArray(msgRes) ? msgRes : msgRes.data);
      setCalls(Array.isArray(callRes) ? callRes : callRes.data);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load(phoneFilter || undefined);
    // Someone waiting on a truck is a live situation; a minute is the most
    // staleness that is useful here.
    const t = setInterval(() => void load(phoneFilter || undefined), 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const handled = async (id: string) => {
    setBusy(id);
    try {
      await api(`/v1/admin/command-center/eta-checks/${id}/handled`, {
        method: 'POST',
        json: {},
      });
      await load(phoneFilter || undefined);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const messageHandled = async (id: string) => {
    setBusy(id);
    try {
      await api(`/v1/admin/command-center/dispatch-messages/${id}/handled`, {
        method: 'POST',
        json: {},
      });
      await load(phoneFilter || undefined);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const showCallsFor = (phone: string) => {
    setPhoneFilter(phone);
    void load(phone);
  };

  const toggleCall = async (call: InboundCall) => {
    if (expandedCallId === call.id) {
      setExpandedCallId(null);
      setCallDetail(null);
      return;
    }
    setExpandedCallId(call.id);
    setCallDetail(null);
    try {
      const res = await api<InboundCallDetail | { data: InboundCallDetail }>(
        `/v1/admin/command-center/inbound-calls/${call.id}`,
      );
      setCallDetail('data' in res ? res.data : res);
    } catch (e) {
      setErr((e as Error).message);
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
          <button
            onClick={() => void load(phoneFilter || undefined)}
            className="text-xs text-slate-400 underline"
          >
            refresh
          </button>
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-rose-700 bg-rose-950 p-3 text-sm text-rose-100">
            {err}
          </div>
        )}

        {messages && messages.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-sky-400">
              Messages for dispatch — {messages.length}
            </div>
            {messages.map((m) => (
              <MessageCard
                key={m.id}
                m={m}
                onDone={messageHandled}
                onCalls={showCallsFor}
                busy={busy === m.id}
              />
            ))}
          </div>
        )}

        {repeat.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-400">
              Called more than once — {repeat.length}
            </div>
            {repeat.map((r) => (
              <Card key={r.id} r={r} hot onDone={handled} onCalls={showCallsFor} busy={busy === r.id} />
            ))}
          </div>
        )}

        {once.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400">
              Called once — {once.length}
            </div>
            {once.map((r) => (
              <Card key={r.id} r={r} onDone={handled} onCalls={showCallsFor} busy={busy === r.id} />
            ))}
          </div>
        )}

        {rows && rows.length === 0 && (!messages || messages.length === 0) && (
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-center text-sm text-slate-400">
            Nobody has called about a tow.
          </div>
        )}

        {!rows && <div className="py-10 text-center text-sm text-slate-500">Loading…</div>}

        <div className="mb-2 mt-6 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Recent calls{phoneFilter ? ` · ${phoneFilter}` : ''}
          </div>
          {phoneFilter && (
            <button
              onClick={() => {
                setPhoneFilter('');
                void load();
              }}
              className="text-xs text-slate-400 underline"
            >
              clear filter
            </button>
          )}
        </div>
        <input
          value={phoneFilter}
          onChange={(e) => setPhoneFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(phoneFilter || undefined);
          }}
          placeholder="Filter by phone number…"
          className="mb-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        {calls && calls.length === 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-center text-sm text-slate-400">
            No calls found.
          </div>
        )}
        {(calls ?? []).map((c) => (
          <CallCard
            key={c.id}
            c={c}
            expanded={expandedCallId === c.id}
            detail={expandedCallId === c.id ? callDetail : null}
            onToggle={() => void toggleCall(c)}
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  r,
  hot,
  onDone,
  onCalls,
  busy,
}: {
  r: EtaCheck;
  hot?: boolean;
  onDone: (id: string) => void;
  onCalls: (phone: string) => void;
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
          onClick={() => onCalls(r.customerPhone)}
          className="rounded-md border border-slate-600 px-3 text-sm text-slate-300"
        >
          Calls
        </button>
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

/** A message Emily took for dispatch — her third move besides answer-it or
 *  transfer. Urgent ones are sorted first by the API. */
function MessageCard({
  m,
  onDone,
  onCalls,
  busy,
}: {
  m: DispatchMessage;
  onDone: (id: string) => void;
  onCalls: (phone: string) => void;
  busy: boolean;
}) {
  const urgent = m.urgency === 'urgent';
  return (
    <div
      className="mb-2 rounded-lg p-3"
      style={{
        background: urgent ? '#450a0a' : '#0c1e2e',
        border: `2px solid ${urgent ? '#f87171' : '#38bdf8'}`,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-base font-bold text-white">{m.callerName || m.callerPhone}</span>
        {urgent && (
          <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white">
            URGENT
          </span>
        )}
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">
          {m.topic.replace(/_/g, ' ')}
        </span>
        <span className="ml-auto text-xs text-slate-400">{since(m.takenAt)}</span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{m.message}</p>

      <div className="mt-1 text-xs text-slate-400">
        {m.jobNumber ? `Job #${m.jobNumber} · ` : ''}
        {m.callbackRequested ? 'wants a callback' : 'no callback requested'}
        {m.callbackWindow ? ` · ${m.callbackWindow}` : ''}
      </div>

      <div className="mt-3 flex gap-2">
        <a
          href={`tel:${m.callerPhone}`}
          className="flex-1 rounded-md bg-emerald-600 py-2.5 text-center text-sm font-bold text-white"
        >
          Call {m.callerPhone}
        </a>
        <button
          onClick={() => onCalls(m.callerPhone)}
          className="rounded-md border border-slate-600 px-3 text-sm text-slate-300"
        >
          Calls
        </button>
        <button
          onClick={() => onDone(m.id)}
          disabled={busy}
          className="rounded-md border border-slate-600 px-3 text-sm text-slate-300 disabled:opacity-50"
        >
          {busy ? '…' : 'Done'}
        </button>
      </div>
    </div>
  );
}

/** One call to the 844 line. Collapsed by default — transcript is the
 *  heaviest thing on this page and nobody needs it until they ask for it. */
function CallCard({
  c,
  expanded,
  detail,
  onToggle,
}: {
  c: InboundCall;
  expanded: boolean;
  detail: InboundCallDetail | null;
  onToggle: () => void;
}) {
  return (
    <div className="mb-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
      <button onClick={onToggle} className="flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{c.fromNumber || 'Unknown number'}</div>
          <div className="mt-0.5 text-xs text-slate-400">
            {BRANCH_LABEL[c.branch] ?? c.branch} · {fmtDuration(c.durationSeconds)}
            {c.ustdJobNumber ? ` · job #${c.ustdJobNumber}` : ''}
          </div>
        </div>
        <span className="shrink-0 text-xs text-slate-500">{since(c.createdAt)}</span>
      </button>

      {c.summary && !expanded && <p className="mt-2 truncate text-xs text-slate-400">{c.summary}</p>}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
          {!detail && <p className="text-xs text-slate-400">Loading…</p>}
          {detail && (
            <>
              {detail.summary && <p className="text-sm text-slate-200">{detail.summary}</p>}
              {detail.recordingUrl && (
                <audio controls src={detail.recordingUrl} className="w-full" preload="none" />
              )}
              {detail.transcript ? (
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
                  {detail.transcript}
                </pre>
              ) : (
                <p className="text-xs text-slate-500">No transcript for this call.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
