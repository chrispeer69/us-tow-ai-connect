'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/utils';

/**
 * Every call to the 844 line, every message Emily took, and who has rung in
 * asking where their truck is.
 *
 * Chris, 2026-08-23: "notify the office this person on this job called for an
 * eta - provide an alert so we can monitor that call".
 * Chris, 2026-10-27: "I need to see every incoming call and every message -
 * urgent calls must be shown in red with a notice or alarm". Plus, per call:
 * the number, where they are calling from, whether they have a car waiting
 * (with the Towbook call #), and for a motor club the rep's full name, direct
 * callback number, email and why they called.
 *
 * ETA checks sort by call COUNT first, not recency. Somebody on their third
 * call is a bigger problem than somebody who rang thirty seconds ago.
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

/** A live Towbook/AAA job matched on the caller's number — reference only. */
interface JobRef {
  source: 'towbook' | 'aaa_portal';
  customerName: string | null;
  vehicle: string | null;
  callNumber: string | null;
  poNumber: string | null;
  pickup: string | null;
  destination: string | null;
  status: string | null;
  driverName: string | null;
}

/** A message Emily took instead of transferring the call — her third move
 *  besides answer-it or hand-it-away. See dispatch_messages / ai-connect.service.ts. */
interface DispatchMessage {
  id: string;
  providerCallId: string | null;
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
  jobCustomerName: string | null;
  jobVehicle: string | null;
  job: JobRef | null;
}

/** Who the caller said they were — Retell post-call analysis. */
interface CallerDetails {
  callerType: string | null;
  fullName: string | null;
  company: string | null;
  callbackNumber: string | null;
  email: string | null;
  purpose: string | null;
  vehicleLocation: string | null;
  transferred: boolean;
  transferReason: string | null;
}

/** One row per call to the 844 line, with transcript + recording. */
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
  endedAt: string | null;
  createdAt: string;
  live: boolean;
  caller: CallerDetails;
  message: { id: string; urgency: string; topic: string; handledAt: string | null } | null;
  jobCustomerName: string | null;
  jobVehicle: string | null;
  job: JobRef | null;
}

interface InboundCallDetail {
  transcript: string | null;
  summary: string | null;
  recordingUrl: string | null;
}

interface BoardContext {
  tenantId: string;
  companyName: string | null;
  isRoadside: boolean;
}

const BRANCH_LABEL: Record<string, string> = {
  update: 'ETA check',
  new_tow: 'New tow',
  motor_club: 'Motor club',
  unknown: 'Unsorted',
};

/** Where a number is from, by area code. Local and neighbouring codes only —
 *  a wrong city is worse than none, so anything else shows the bare code. */
const AREA_CODES: Record<string, string> = {
  '614': 'Columbus, OH', '380': 'Columbus, OH', '740': 'Central/SE Ohio', '220': 'Central/SE Ohio',
  '937': 'Dayton, OH', '326': 'Dayton, OH', '513': 'Cincinnati, OH', '283': 'Cincinnati, OH',
  '419': 'Toledo / NW Ohio', '567': 'Toledo / NW Ohio', '216': 'Cleveland, OH', '440': 'Cleveland area, OH',
  '436': 'Cleveland area, OH', '330': 'Akron/Canton, OH', '234': 'Akron/Canton, OH',
  '304': 'West Virginia', '681': 'West Virginia', '412': 'Pittsburgh, PA', '724': 'Western PA',
  '859': 'Lexington, KY', '502': 'Louisville, KY', '606': 'Eastern KY', '317': 'Indianapolis, IN',
  '260': 'Fort Wayne, IN', '765': 'Indiana', '313': 'Detroit, MI', '248': 'Detroit area, MI',
  '734': 'SE Michigan',
  '800': 'Toll-free (call centre)', '833': 'Toll-free (call centre)', '844': 'Toll-free (call centre)',
  '855': 'Toll-free (call centre)', '866': 'Toll-free (call centre)', '877': 'Toll-free (call centre)',
  '888': 'Toll-free (call centre)',
};

const digits10 = (p: string | null) => {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

const fmtPhone = (p: string | null) => {
  const d = digits10(p);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || 'Unknown number';
};

const phoneRegion = (p: string | null) => {
  const d = digits10(p);
  if (d.length !== 10) return null;
  return AREA_CODES[d.slice(0, 3)] ?? `Area code ${d.slice(0, 3)}`;
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

const clock = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** "(5 hrs 54 mins late)" is the only part of the ETA string worth a headline. */
const lateness = (eta: string | null) => {
  const m = eta?.match(/\(([^)]*\blate\b[^)]*)\)/i);
  return m ? m[1] : null;
};

type CallerKind = 'motor_club' | 'customer_waiting' | 'customer' | 'unknown';

/** Motor club if Emily or the branch says so; a customer with a car waiting if
 *  the number matches a live job; otherwise a customer by branch. */
const callerKind = (c: InboundCall): CallerKind => {
  const t = (c.caller.callerType ?? '').toLowerCase();
  if (t.includes('motor') || t.includes('club') || c.branch === 'motor_club') return 'motor_club';
  if (c.job) return 'customer_waiting';
  if (t.includes('customer') || c.branch === 'update' || c.branch === 'new_tow') return 'customer';
  return 'unknown';
};

/** A call is urgent if Emily flagged the message she took on it urgent. */
const callIsUrgent = (c: InboundCall) => c.message?.urgency === 'urgent' && !c.message.handledAt;

// ─── alarm ──────────────────────────────────────────────────────────────
//
// Browsers refuse to play sound until the page has been tapped once, so the
// alarm has an explicit "turn sound on" step, remembered per browser. Without
// sound the banner, the flashing tab title and the phone vibration still fire.

const SOUND_KEY = 'roadside-alarm-sound';

function useAlarmSound() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SOUND_KEY) === '1') setEnabled(true);
    } catch {
      /* storage blocked — sound stays off until tapped */
    }
  }, []);

  const ctx = () => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
    }
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    return ctxRef.current;
  };

  const tone = (freqs: number[], step: number, type: OscillatorType, gainLevel: number) => {
    const ac = ctx();
    if (!ac) return;
    freqs.forEach((f, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const t0 = ac.currentTime + i * step;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(gainLevel, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + step * 0.95);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + step);
    });
  };

  return {
    enabled,
    enable: () => {
      setEnabled(true);
      try {
        window.localStorage.setItem(SOUND_KEY, '1');
      } catch {
        /* ignore */
      }
      tone([660, 880], 0.15, 'sine', 0.3);
    },
    disable: () => {
      setEnabled(false);
      try {
        window.localStorage.setItem(SOUND_KEY, '0');
      } catch {
        /* ignore */
      }
    },
    /** Two-tone siren, about two seconds. */
    alarm: () => {
      if (enabled) tone([960, 640, 960, 640, 960, 640, 960, 640], 0.25, 'square', 0.25);
      try {
        navigator.vibrate?.([400, 150, 400, 150, 400]);
      } catch {
        /* ignore */
      }
    },
    /** Soft double chime for an ordinary new call or message. */
    chime: () => {
      if (enabled) tone([880, 1320], 0.18, 'sine', 0.2);
    },
  };
}

export default function RoadsideBoard() {
  const [ctxInfo, setCtxInfo] = useState<BoardContext | null>(null);
  const [rows, setRows] = useState<EtaCheck[] | null>(null);
  const [messages, setMessages] = useState<DispatchMessage[] | null>(null);
  const [calls, setCalls] = useState<InboundCall[] | null>(null);
  const [callLimit, setCallLimit] = useState(200);
  const [phoneFilter, setPhoneFilter] = useState('');
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [callDetail, setCallDetail] = useState<InboundCallDetail | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  /** Urgent ids someone has already acknowledged — they stay red, but the
   *  siren stops repeating for them. A NEW urgent item starts it again. */
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const seenRef = useRef<Set<string> | null>(null);
  const sound = useAlarmSound();
  const filterRef = useRef('');
  filterRef.current = phoneFilter;

  const load = useCallback(async (phone?: string, limit?: number) => {
    const qs = new URLSearchParams();
    if (phone) qs.set('phone', phone);
    qs.set('limit', String(limit ?? 200));
    // allSettled, not all: one failing feed must not blank the other two. The
    // old Promise.all hid every call on the board if the ETA list errored.
    const [ctxRes, etaRes, msgRes, callRes] = await Promise.allSettled([
      api<BoardContext>('/v1/admin/command-center/roadside-board-context'),
      api<EtaCheck[] | { data: EtaCheck[] }>('/v1/admin/command-center/eta-checks'),
      api<DispatchMessage[] | { data: DispatchMessage[] }>('/v1/admin/command-center/dispatch-messages?all=1'),
      api<InboundCall[] | { data: InboundCall[] }>(`/v1/admin/command-center/inbound-calls?${qs}`),
    ]);
    const unwrap = <T,>(v: T[] | { data: T[] }) => (Array.isArray(v) ? v : v.data);
    const next: Record<string, string> = {};
    if (ctxRes.status === 'fulfilled') setCtxInfo(ctxRes.value);
    if (etaRes.status === 'fulfilled') setRows(unwrap(etaRes.value));
    else next.eta = `ETA checks: ${(etaRes.reason as Error).message}`;
    if (msgRes.status === 'fulfilled') setMessages(unwrap(msgRes.value));
    else next.messages = `Messages: ${(msgRes.reason as Error).message}`;
    if (callRes.status === 'fulfilled') setCalls(unwrap(callRes.value));
    else next.calls = `Calls: ${(callRes.reason as Error).message}`;
    setErrs(next);
    setLastLoaded(new Date());
  }, []);

  useEffect(() => {
    void load(filterRef.current || undefined, callLimit);
    // A live board: 20 seconds is the most staleness that is useful when
    // somebody is standing next to a broken-down car.
    const t = setInterval(() => void load(filterRef.current || undefined, callLimit), 20000);
    return () => clearInterval(t);
  }, [load, callLimit]);

  // ── what needs attention ──
  const openMessages = (messages ?? []).filter((m) => !m.handledAt);
  const doneMessages = (messages ?? []).filter((m) => m.handledAt);
  const urgentMessages = openMessages.filter((m) => m.urgency === 'urgent');
  const repeat = (rows ?? []).filter((r) => r.calls > 1);
  const once = (rows ?? []).filter((r) => r.calls === 1);
  const liveCalls = (calls ?? []).filter((c) => c.live);
  const urgentIds = [...urgentMessages.map((m) => m.id), ...repeat.filter((r) => !r.handledAt).map((r) => r.id)];
  const unacked = urgentIds.filter((id) => !acked.has(id));

  // New calls/messages since the last poll: chime. Skipped on first load so
  // opening the page does not ring for everything already on it.
  useEffect(() => {
    if (!calls || !messages) return;
    const ids = new Set([...calls.map((c) => c.id), ...messages.map((m) => m.id)]);
    if (seenRef.current) {
      const fresh = [...ids].some((id) => !seenRef.current!.has(id));
      if (fresh && unacked.length === 0) sound.chime();
    }
    seenRef.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls, messages]);

  // Siren now, and again every 30 seconds, until every urgent item is
  // acknowledged.
  const unackedKey = unacked.join(',');
  useEffect(() => {
    if (!unackedKey) return;
    sound.alarm();
    const t = setInterval(() => sound.alarm(), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unackedKey, sound.enabled]);

  // Flash the tab title so it shows from another tab or a locked phone's
  // switcher.
  useEffect(() => {
    const base = 'Roadside — calls';
    if (!unackedKey && urgentIds.length === 0) {
      document.title = liveCalls.length ? `(${liveCalls.length} live) ${base}` : base;
      return;
    }
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? `🚨 ${urgentIds.length} URGENT` : base;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = base;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unackedKey, urgentIds.length, liveCalls.length]);

  // Mark handled server-side, flip the button to a checkmark right away. ETA
  // rows drop a moment later; messages move to the "done" list.
  const handled = async (id: string) => {
    setBusy(id);
    try {
      await api(`/v1/admin/command-center/eta-checks/${id}/handled`, { method: 'POST', json: {} });
      setRows((cur) =>
        (cur ?? []).map((r) => (r.id === id ? { ...r, handledAt: new Date().toISOString() } : r)),
      );
      setTimeout(() => setRows((cur) => (cur ?? []).filter((r) => r.id !== id)), 1400);
    } catch (e) {
      setErrs((cur) => ({ ...cur, action: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const messageHandled = async (id: string) => {
    setBusy(id);
    try {
      await api(`/v1/admin/command-center/dispatch-messages/${id}/handled`, { method: 'POST', json: {} });
      setMessages((cur) =>
        (cur ?? []).map((m) => (m.id === id ? { ...m, handledAt: new Date().toISOString() } : m)),
      );
    } catch (e) {
      setErrs((cur) => ({ ...cur, action: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const showCallsFor = (phone: string) => {
    setPhoneFilter(phone);
    void load(phone, callLimit);
    document.getElementById('calls')?.scrollIntoView({ behavior: 'smooth' });
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
      setErrs((cur) => ({ ...cur, action: (e as Error).message }));
    }
  };

  const errList = Object.values(errs);

  return (
    <div style={{ background: '#0b1120', minHeight: '100vh', color: '#e2e8f0' }} className="px-4 py-5 font-sans">
      <style>{`@keyframes roadside-pulse { 0%,100% { background:#7f1d1d } 50% { background:#dc2626 } }`}</style>
      <div className="mx-auto max-w-xl">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h1 className="text-lg font-bold text-white">Roadside — calls &amp; messages</h1>
          <div className="flex items-baseline gap-3">
            {lastLoaded && <span className="text-xs text-slate-500">{since(lastLoaded.toISOString())}</span>}
            <button onClick={() => void load(phoneFilter || undefined, callLimit)} className="text-xs text-slate-400 underline">
              refresh
            </button>
          </div>
        </div>

        {ctxInfo && !ctxInfo.isRoadside && (
          <div className="mb-3 rounded-lg border-2 border-amber-500 bg-amber-950 p-3 text-sm text-amber-100">
            This login is on <b>{ctxInfo.companyName ?? 'another company'}</b>, not Roadside Towing. Emily&apos;s
            calls and messages are filed under Roadside, so this board will look empty. Switch company or sign in
            with the Roadside login.
          </div>
        )}

        {/* The alarm. Sticky so it stays on screen while scrolling the call list. */}
        {urgentIds.length > 0 && (
          <div
            className="sticky top-0 z-10 mb-3 rounded-lg border-2 border-rose-300 p-3 text-white shadow-lg"
            style={{ animation: unacked.length ? 'roadside-pulse 1s infinite' : undefined, background: '#7f1d1d' }}
          >
            <div className="text-base font-bold">
              🚨 {urgentIds.length} URGENT — needs a callback now
            </div>
            <div className="mt-1 text-sm">
              {urgentMessages.length > 0 && <>{urgentMessages.length} urgent message{urgentMessages.length > 1 ? 's' : ''}</>}
              {urgentMessages.length > 0 && repeat.length > 0 && ' · '}
              {repeat.length > 0 && <>{repeat.length} caller{repeat.length > 1 ? 's' : ''} rang more than once about a late truck</>}
            </div>
            <div className="mt-2 flex gap-3">
              {unacked.length > 0 && (
                <button
                  onClick={() => setAcked(new Set([...acked, ...urgentIds]))}
                  className="rounded-md bg-white px-3 py-1.5 text-sm font-bold text-rose-800"
                >
                  Silence alarm
                </button>
              )}
              <span className="self-center text-xs text-rose-100">
                Stays red until each one is ticked off below.
              </span>
            </div>
          </div>
        )}

        {!sound.enabled ? (
          <button
            onClick={sound.enable}
            className="mb-3 w-full rounded-lg border border-sky-600 bg-sky-950 py-2 text-sm font-bold text-sky-100"
          >
            🔔 Tap to turn on the alarm sound
          </button>
        ) : (
          <div className="mb-3 text-right text-xs text-slate-500">
            alarm sound on ·{' '}
            <button onClick={sound.disable} className="underline">
              turn off
            </button>
          </div>
        )}

        {errList.length > 0 && (
          <div className="mb-3 rounded-lg border border-rose-700 bg-rose-950 p-3 text-sm text-rose-100">
            {errList.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}

        {liveCalls.length > 0 && (
          <div className="mb-3 rounded-lg border-2 border-emerald-500 bg-emerald-950 p-3 text-sm text-emerald-100">
            📞 On the line with Emily now:{' '}
            {liveCalls.map((c) => fmtPhone(c.fromNumber)).join(', ')}
          </div>
        )}

        <div className="mb-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-sky-400">
            Messages for dispatch — {openMessages.length} open
          </div>
          {messages && openMessages.length === 0 && (
            <div className="mb-2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-center text-sm text-slate-400">
              No open messages.
            </div>
          )}
          {openMessages.map((m) => (
            <MessageCard key={m.id} m={m} onDone={messageHandled} onCalls={showCallsFor} busy={busy === m.id} />
          ))}
          {doneMessages.length > 0 && (
            <>
              <button onClick={() => setShowDone((s) => !s)} className="text-xs text-slate-400 underline">
                {showDone ? 'hide' : 'show'} {doneMessages.length} called back in the last 7 days
              </button>
              {showDone && (
                <div className="mt-2 opacity-60">
                  {doneMessages.map((m) => (
                    <MessageCard key={m.id} m={m} onDone={messageHandled} onCalls={showCallsFor} busy={false} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {repeat.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-400">
              Called more than once about their truck — {repeat.length}
            </div>
            {repeat.map((r) => (
              <Card key={r.id} r={r} hot onDone={handled} onCalls={showCallsFor} busy={busy === r.id} />
            ))}
          </div>
        )}

        {once.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400">
              Asked where their truck is — {once.length}
            </div>
            {once.map((r) => (
              <Card key={r.id} r={r} onDone={handled} onCalls={showCallsFor} busy={busy === r.id} />
            ))}
          </div>
        )}

        <div id="calls" className="mb-2 mt-6 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Every call{phoneFilter ? ` · ${phoneFilter}` : ''}
            {calls ? ` — ${calls.length}` : ''}
          </div>
          {phoneFilter && (
            <button
              onClick={() => {
                setPhoneFilter('');
                void load(undefined, callLimit);
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
            if (e.key === 'Enter') void load(phoneFilter || undefined, callLimit);
          }}
          placeholder="Filter by phone number…"
          className="mb-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        {!calls && !errs.calls && <div className="py-10 text-center text-sm text-slate-500">Loading…</div>}
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
        {calls && calls.length >= callLimit && callLimit < 500 && (
          <button
            onClick={() => setCallLimit(500)}
            className="mt-1 w-full rounded-md border border-slate-700 py-2 text-sm text-slate-300"
          >
            Load older calls
          </button>
        )}

        <AbPanel />
      </div>
    </div>
  );
}

/** One row of GET /v1/admin/flip-engine/ab-slim-gemini — see ab-slim-gemini.ts. */
interface AbDayRow {
  day: string;
  arm: 'slim_gemini' | 'legacy';
  calls: number;
  connected: number;
  eligible_connected: number;
  offer_made: number;
  offer_made_rate: number | null;
  offer_accepted: number;
  offer_accepted_rate: number | null;
  hard_refusals: number;
  hangup_before_offer: number;
  eta_violations: number;
  avg_cost_per_min: number | null;
  cost_per_min_connected_ex_fees: number | null;
  avg_llm_tokens: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
}
interface AbTotals {
  connected: number;
  eligibleConnected: number;
  accepted: number;
  costDollars: number;
  billedMinutes: number;
}
interface AbReport {
  rows: AbDayRow[];
  totals: { slim_gemini: AbTotals; legacy: AbTotals };
  state: { env_pct: number; effective_pct: number; rolled_back?: boolean; reason?: string; rolled_back_at?: string };
  days: number;
  csv: string;
}

/**
 * Outbound A/B, slim + Gemini vs legacy (2026-10-10). Collapsed by default and
 * fetched only when opened — it is a review table, not a live board.
 */
function AbPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AbReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      setData(await api<AbReport>('/v1/admin/flip-engine/ab-slim-gemini?days=30'));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const money = (v: number | null) => (v == null ? '—' : `$${v.toFixed(3)}`);
  const perMin = (t: AbTotals) => (t.billedMinutes > 0 ? t.costDollars / t.billedMinutes : null);
  const acc = (t: AbTotals) => (t.eligibleConnected > 0 ? t.accepted / t.eligibleConnected : null);
  const label = (a: string) => (a === 'slim_gemini' ? 'slim+Gemini' : 'legacy');

  const downloadCsv = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data.csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `emily-ab-slim-gemini-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mb-6 mt-8">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!data) void load();
        }}
        className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-wider text-violet-400"
      >
        <span>Outbound A/B — slim + Gemini vs legacy</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-slate-300">
          {err && <div className="mb-2 text-rose-300">{err}</div>}
          {!data && !err && <div className="text-slate-500">Loading…</div>}
          {data && (
            <>
              <div className="mb-2">
                Share to slim+Gemini: <b className="text-white">{data.state.effective_pct}%</b>
                {data.state.env_pct !== data.state.effective_pct && <> (env {data.state.env_pct}%)</>}
                {data.state.rolled_back && (
                  <div className="mt-1 rounded border border-rose-700 bg-rose-950 p-2 text-rose-100">
                    Auto-rolled back {data.state.rolled_back_at?.slice(0, 16).replace('T', ' ')}: {data.state.reason}
                  </div>
                )}
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2">
                {(['slim_gemini', 'legacy'] as const).map((a) => (
                  <div key={a} className="rounded border border-slate-700 p-2">
                    <div className="font-bold text-white">{label(a)}</div>
                    <div>{data.totals[a].connected} connected</div>
                    <div>accepted {pct(acc(data.totals[a]))} ({data.totals[a].accepted}/{data.totals[a].eligibleConnected})</div>
                    <div>{money(perMin(data.totals[a]))}/min <span className="text-slate-500">(connected, excl. call fee)</span></div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full whitespace-nowrap text-left">
                  <thead className="text-slate-500">
                    <tr>
                      {['Day', 'Arm', 'Conn', 'Offer', 'Won', 'Refused', 'Hung up', 'ETA', '$/min all-in', '$/min ex fee', 'Tokens', 'p50/p95 ms'].map((h) => (
                        <th key={h} className="pr-3 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.day + r.arm} className="border-t border-slate-800">
                        <td className="pr-3">{r.day.slice(5)}</td>
                        <td className="pr-3">{label(r.arm)}</td>
                        <td className="pr-3">{r.connected}</td>
                        <td className="pr-3">{pct(r.offer_made_rate)}</td>
                        <td className="pr-3">{pct(r.offer_accepted_rate)}</td>
                        <td className="pr-3">{r.hard_refusals}</td>
                        <td className="pr-3">{r.hangup_before_offer}</td>
                        <td className={`pr-3 ${r.eta_violations ? 'text-rose-400' : ''}`}>{r.eta_violations}</td>
                        <td className="pr-3">{money(r.avg_cost_per_min)}</td>
                        <td className="pr-3">{money(r.cost_per_min_connected_ex_fees)}</td>
                        <td className="pr-3">{r.avg_llm_tokens ?? '—'}</td>
                        <td className="pr-3">{r.latency_p50_ms ?? '—'}/{r.latency_p95_ms ?? '—'}</td>
                      </tr>
                    ))}
                    {data.rows.length === 0 && (
                      <tr>
                        <td colSpan={12} className="py-2 text-slate-500">No A/B calls yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex gap-4">
                <button onClick={downloadCsv} className="text-sky-400 underline">Download CSV</button>
                <button onClick={() => void load()} className="text-slate-400 underline">refresh</button>
              </div>
              <div className="mt-2 text-slate-500">
                Connected = over 30s. Offer and Won are per connected flip-eligible call. "Ex fee" leaves out the $0.10 Branded Call charge every dial pays; the rollback uses it. Last {data.days} days.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Red ✕ = still needs a callback. Tap it once you've called them back and
 *  it flips to a green ✓ — see `handled`/`messageHandled` for the timing. */
function DoneToggle({
  done,
  urgent,
  busy,
  onClick,
}: {
  done: boolean;
  urgent: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || done}
      aria-label={done ? 'called back' : 'call back needed'}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold text-white disabled:opacity-90"
      style={{ background: done ? '#16a34a' : urgent ? '#dc2626' : '#475569' }}
    >
      {busy ? '…' : done ? '✓' : '✕'}
    </button>
  );
}

/** The live Towbook/AAA job on this caller's number: the car that is waiting. */
function JobLine({ job }: { job: JobRef }) {
  return (
    <div className="mt-2 rounded-md border border-amber-600 bg-amber-950 px-2 py-1.5 text-xs text-amber-100">
      <div className="font-bold">
        🚗 Car waiting on a tow
        {job.callNumber ? ` — Towbook #${job.callNumber}` : job.source === 'aaa_portal' ? ' — AAA job' : ''}
        {job.poNumber ? ` · PO ${job.poNumber}` : ''}
      </div>
      <div className="mt-0.5">
        {[job.customerName, job.vehicle, job.status, job.driverName ? `driver ${job.driverName}` : null]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {(job.pickup || job.destination) && (
        <div className="mt-0.5 text-amber-200/80">
          {job.pickup || 'pickup unknown'}
          {job.destination ? ` → ${job.destination}` : ''}
        </div>
      )}
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
        <span className="text-base font-bold text-white">{r.customerName || 'Unknown caller'}</span>
        {r.calls > 1 && (
          <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white">{r.calls}× calls</span>
        )}
        <span className="ml-auto text-xs text-slate-400">{since(r.lastCalledAt)}</span>
      </div>

      <div className="mt-1 text-sm text-slate-300">
        {[r.vehicle, r.driverName ? `driver ${r.driverName}` : null, r.jobStatus].filter(Boolean).join(' · ')}
      </div>

      {(r.pickup || r.destination) && (
        <div className="mt-1 text-xs text-slate-400">
          {r.pickup}
          {r.destination ? ` → ${r.destination}` : ''}
        </div>
      )}

      {/* Office-only. Emily never says this out loud. */}
      {late ? (
        <div className="mt-2 rounded bg-rose-950 px-2 py-1 text-xs font-bold text-rose-200">Board says: {late}</div>
      ) : (
        r.etaRaw && <div className="mt-2 text-xs text-slate-500">Board ETA: {r.etaRaw}</div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <a
          href={`tel:${r.customerPhone}`}
          className="flex-1 rounded-md bg-emerald-600 py-2.5 text-center text-sm font-bold text-white"
        >
          Call {fmtPhone(r.customerPhone)}
        </a>
        <button
          onClick={() => onCalls(r.customerPhone)}
          className="rounded-md border border-slate-600 px-3 py-2.5 text-sm text-slate-300"
        >
          Calls
        </button>
        <DoneToggle done={!!r.handledAt} urgent={!!hot} busy={busy} onClick={() => onDone(r.id)} />
      </div>
    </div>
  );
}

/** A message Emily took for dispatch. Urgent ones are sorted first by the API. */
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
  const urgent = m.urgency === 'urgent' && !m.handledAt;
  const region = phoneRegion(m.callerPhone);
  return (
    <div
      className="mb-2 rounded-lg p-3"
      style={{
        background: urgent ? '#450a0a' : '#0c1e2e',
        border: `2px solid ${urgent ? '#f87171' : '#38bdf8'}`,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-base font-bold text-white">{m.callerName || fmtPhone(m.callerPhone)}</span>
        {m.urgency === 'urgent' && (
          <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white">URGENT</span>
        )}
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">{m.topic.replace(/_/g, ' ')}</span>
        <span className="ml-auto text-xs text-slate-400" title={clock(m.takenAt)}>
          {since(m.takenAt)}
        </span>
      </div>

      <div className="mt-1 text-xs text-slate-400">
        {fmtPhone(m.callerPhone)}
        {region ? ` · ${region}` : ''} · {clock(m.takenAt)}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{m.message}</p>

      {m.job && <JobLine job={m.job} />}

      <div className="mt-1 text-xs text-slate-400">
        {m.jobNumber ? `Job #${m.jobNumber} · ` : ''}
        {m.callbackRequested ? 'wants a callback' : 'no callback requested'}
        {m.callbackWindow ? ` · ${m.callbackWindow}` : ''}
        {m.handledAt ? ` · called back ${since(m.handledAt)}` : ''}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <a
          href={`tel:${m.callerPhone}`}
          className="flex-1 rounded-md bg-emerald-600 py-2.5 text-center text-sm font-bold text-white"
        >
          Call {fmtPhone(m.callerPhone)}
        </a>
        <button
          onClick={() => onCalls(m.callerPhone)}
          className="rounded-md border border-slate-600 px-3 py-2.5 text-sm text-slate-300"
        >
          Calls
        </button>
        <DoneToggle done={!!m.handledAt} urgent={urgent} busy={busy} onClick={() => onDone(m.id)} />
      </div>
    </div>
  );
}

const KIND_BADGE: Record<CallerKind, { label: string; bg: string }> = {
  motor_club: { label: 'Motor club', bg: '#6d28d9' },
  customer_waiting: { label: 'Customer — car waiting', bg: '#b45309' },
  customer: { label: 'Customer', bg: '#0369a1' },
  unknown: { label: 'Caller', bg: '#475569' },
};

/** A motor-club rep's details. Missing ones are shown as missing, not hidden —
 *  the office needs to know a callback number was never taken. */
function MotorClubBlock({ c }: { c: InboundCall }) {
  const d = c.caller;
  const row = (label: string, value: ReactNode | null) => (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-violet-300">{label}</span>
      {value ?? <span className="text-amber-400">not captured</span>}
    </div>
  );
  return (
    <div className="mt-2 space-y-0.5 rounded-md border border-violet-700 bg-violet-950 px-2 py-1.5 text-xs text-violet-50">
      {row('Name', d.fullName)}
      {row('Company', d.company)}
      {row(
        'Callback',
        d.callbackNumber ? (
          <a href={`tel:${d.callbackNumber}`} className="font-bold underline">
            {d.callbackNumber}
          </a>
        ) : null,
      )}
      {row(
        'Email',
        d.email ? (
          <a href={`mailto:${d.email}`} className="underline">
            {d.email}
          </a>
        ) : null,
      )}
      {row('Purpose', d.purpose ?? c.summary)}
    </div>
  );
}

/** One call to the 844 line. Transcript loads only when opened. */
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
  const kind = callerKind(c);
  const urgent = callIsUrgent(c);
  const region = phoneRegion(c.fromNumber);
  const when = c.startedAt ?? c.createdAt;
  return (
    <div
      className="mb-2 rounded-lg p-3"
      style={{
        background: urgent ? '#450a0a' : '#0f172a',
        border: `${urgent || c.live ? 2 : 1}px solid ${urgent ? '#f87171' : c.live ? '#10b981' : '#334155'}`,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <a href={c.fromNumber ? `tel:${c.fromNumber}` : undefined} className="text-base font-bold text-white underline">
          {fmtPhone(c.fromNumber)}
        </a>
        <span className="rounded px-1.5 py-0.5 text-xs font-bold text-white" style={{ background: KIND_BADGE[kind].bg }}>
          {KIND_BADGE[kind].label}
        </span>
        {urgent && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white">URGENT</span>}
        {c.live && <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-xs font-bold text-white">LIVE</span>}
        <span className="ml-auto text-xs text-slate-400" title={clock(when)}>
          {since(when)}
        </span>
      </div>

      <div className="mt-1 text-xs text-slate-400">
        {region ? `📍 ${region}` : 'Location unknown'}
        {c.caller.vehicleLocation ? ` · car at ${c.caller.vehicleLocation}` : ''}
      </div>
      <div className="mt-0.5 text-xs text-slate-400">
        {clock(when)} · {BRANCH_LABEL[c.branch] ?? c.branch} · {c.live ? 'in progress' : fmtDuration(c.durationSeconds)}
        {c.caller.transferred ? ' · transferred to dispatch' : ''}
        {c.ustdJobNumber ? ` · booked USTD #${c.ustdJobNumber}` : ''}
        {c.message ? ` · left a message${c.message.handledAt ? ' (called back)' : ''}` : ''}
      </div>

      {c.job && <JobLine job={c.job} />}
      {kind === 'motor_club' && <MotorClubBlock c={c} />}
      {kind !== 'motor_club' && c.caller.fullName && (
        <div className="mt-1 text-xs text-slate-300">Caller: {c.caller.fullName}</div>
      )}

      {c.summary && !expanded && kind !== 'motor_club' && (
        <p className="mt-2 line-clamp-2 text-xs text-slate-300">{c.summary}</p>
      )}

      <button onClick={onToggle} className="mt-2 text-xs text-sky-400 underline">
        {expanded ? 'hide transcript' : 'transcript & recording'}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
          {!detail && <p className="text-xs text-slate-400">Loading…</p>}
          {detail && (
            <>
              {detail.summary && <p className="text-sm text-slate-200">{detail.summary}</p>}
              {detail.recordingUrl && <audio controls src={detail.recordingUrl} className="w-full" preload="none" />}
              {detail.transcript ? (
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
                  {detail.transcript}
                </pre>
              ) : (
                <p className="text-xs text-slate-500">
                  {c.live ? 'Call still in progress — transcript arrives when it ends.' : 'No transcript for this call.'}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
