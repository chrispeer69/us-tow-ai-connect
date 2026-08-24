'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/utils';

/**
 * Last week's crash-lead calls, for pulling transcripts and recordings for
 * training review — a rolling trailing-7-day window, not a fixed calendar
 * week, so the link stays useful without anyone having to update a date.
 *
 * Same `/v1/alpha-crash-calls` proxy as the live board (AlphaFlipsBoard),
 * just windowed to the past week and without the live-monitoring chrome
 * (push alerts, today's win tiles) that board carries.
 */

const PAGE_SIZE = 200;

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
  in_voicemail: boolean | null;
}

interface AlphaCallDetail extends AlphaCallSummary {
  transcript: string | null;
}

function sevenDaysAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
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

function fmtDuration(ms: number | null): string {
  if (!ms) return '—';
  const secs = Math.round(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

export default function LastWeekBoard() {
  const [calls, setCalls] = useState<AlphaCallSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withRecordingOnly, setWithRecordingOnly] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AlphaCallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const since = sevenDaysAgoIso();
      const first = await api<{ data: { total: number; calls: AlphaCallSummary[] } }>(
        `/v1/alpha-crash-calls?since=${encodeURIComponent(since)}&limit=${PAGE_SIZE}&offset=0`,
      );
      let all = first.data.calls;
      const total = first.data.total;
      if (total > PAGE_SIZE) {
        const rest = await Promise.all(
          Array.from({ length: Math.ceil((total - PAGE_SIZE) / PAGE_SIZE) }, (_, i) =>
            api<{ data: { calls: AlphaCallSummary[] } }>(
              `/v1/alpha-crash-calls?since=${encodeURIComponent(since)}&limit=${PAGE_SIZE}&offset=${
                PAGE_SIZE * (i + 1)
              }`,
            ),
          ),
        );
        all = all.concat(...rest.map((r) => r.data.calls));
      }
      setCalls(all);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        setError((err as Error).message);
      } finally {
        setDetailLoading(false);
      }
    },
    [expandedId],
  );

  const shown = (calls ?? []).filter((c) => !withRecordingOnly || c.recording_url);
  const withRecordingCount = (calls ?? []).filter((c) => c.recording_url).length;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4 text-white">
      <header className="sticky top-0 z-10 -mx-4 border-b border-stone-800 bg-[#1c1917] px-4 pb-3 pt-1">
        <Link href="/alpha/flips" className="text-xs text-stone-400 underline">
          ← back to live board
        </Link>
        <div className="mt-1 flex items-baseline justify-between">
          <h1 className="text-lg font-semibold text-white">Last week&apos;s call logs</h1>
        </div>
        <p className="mt-1 text-xs text-stone-400">
          Rolling 7-day window, for pulling audio and transcripts for training review.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-stone-700 bg-stone-800/60 px-3 py-2 text-stone-200">
            <div className="text-2xl font-semibold leading-tight">{calls?.length ?? '—'}</div>
            <div className="text-[11px] uppercase tracking-wide opacity-80">Calls, 7 days</div>
          </div>
          <div className="rounded-xl border border-stone-700 bg-stone-800/60 px-3 py-2 text-stone-200">
            <div className="text-2xl font-semibold leading-tight">{withRecordingCount}</div>
            <div className="text-[11px] uppercase tracking-wide opacity-80">With audio + transcript</div>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setWithRecordingOnly((v) => !v)}
            className={`min-h-11 flex-1 rounded-lg border px-3 text-sm font-semibold transition ${
              withRecordingOnly
                ? 'border-orange-400 bg-orange-500/25 text-orange-100'
                : 'border-stone-700 bg-stone-800/60 text-stone-300'
            }`}
          >
            {withRecordingOnly ? '✓ With audio only' : 'With audio only'}
          </button>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="min-h-11 rounded-lg border border-stone-700 bg-stone-800/60 px-4 text-sm font-medium text-stone-200 active:bg-stone-700 disabled:opacity-50"
          >
            {busy ? '…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <p className="mt-3 rounded-lg border border-amber-600 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
          Couldn&apos;t load: {error}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {!calls && !error && (
          <p className="rounded-xl border border-stone-800 bg-stone-900/60 px-4 py-10 text-center text-sm text-stone-400">
            Loading…
          </p>
        )}
        {calls && shown.length === 0 && (
          <p className="rounded-xl border border-stone-800 bg-stone-900/60 px-4 py-10 text-center text-sm text-stone-400">
            No calls match this filter.
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
  return (
    <article className="rounded-xl border border-stone-800 bg-stone-900/60 px-3 py-3">
      <button onClick={onToggle} className="flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">
            {row.customer_name || 'Unknown caller'}
          </div>
          <div className="mt-0.5 text-xs text-stone-400">
            {row.direction === 'inbound' ? 'inbound' : 'outbound'} · {fmtDuration(row.duration_ms)}
            {row.in_voicemail ? ' · voicemail' : ''}
            {!row.recording_url ? ' · no audio' : ''}
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-stone-400">{timeAgo(row.created_at)}</div>
      </button>

      {row.call_summary && !expanded && (
        <p className="mt-2 truncate text-xs text-stone-400">{row.call_summary}</p>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-stone-800 pt-3">
          {detailLoading && <p className="text-xs text-stone-400">Loading…</p>}
          {detail && (
            <>
              {detail.call_summary && <p className="text-sm text-stone-200">{detail.call_summary}</p>}
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
