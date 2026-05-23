'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/utils';
import type { Stats } from '@/lib/digital-dispatch-types';

const DECISION_COLOR: Record<string, string> = {
  accepted: '#10b981',
  declined: '#dc2626',
  flagged: '#f59e0b',
  manual: '#71717a',
};

export function StatsTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setStats(await api<Stats>(`/v1/admin/digital-dispatch/stats`));
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, []);

  if (err) return <p className="text-sm text-red-400">{err}</p>;
  if (!stats) return <p className="text-sm text-zinc-500">Loading…</p>;

  const tiles = [
    { label: 'Accept rate', value: `${stats.acceptRate.toFixed(1)}%`, color: 'text-emerald-400' },
    { label: 'Accepted', value: stats.totals.accepted.toLocaleString(), color: 'text-emerald-400' },
    { label: 'Declined', value: stats.totals.declined.toLocaleString(), color: 'text-red-400' },
    { label: 'Flagged', value: stats.totals.flagged.toLocaleString(), color: 'text-amber-400' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
          >
            <p className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${t.color}`}>{t.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-200">Decisions over the last 14 days</h3>
        <DailyBarChart daily={stats.daily} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-200">By decision</h3>
          <ul className="space-y-2 text-sm">
            {stats.byDecision.map((d) => (
              <li key={d.decision} className="flex items-center gap-3">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ background: DECISION_COLOR[d.decision] ?? '#71717a' }}
                />
                <span className="flex-1 text-zinc-200">{d.decision}</span>
                <span className="font-medium text-zinc-100">{d.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-200">Top decline reasons</h3>
          {stats.topDeclineReasons.length === 0 ? (
            <p className="text-sm text-zinc-500">No declines on record yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stats.topDeclineReasons.map((r, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-zinc-500">{i + 1}.</span>
                  <span className="flex-1 text-zinc-200 break-words">
                    {r.reason || '(no reason captured)'}
                  </span>
                  <span className="font-medium text-zinc-100">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function DailyBarChart({ daily }: { daily: Stats['daily'] }) {
  // Group by day → { day, accepted, declined, flagged }
  const map = new Map<string, Record<string, number>>();
  for (const row of daily) {
    const day = row.day;
    if (!map.has(day)) map.set(day, {});
    map.get(day)![row.decision] = row.count;
  }
  const sorted = Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  if (sorted.length === 0) {
    return <p className="text-sm text-zinc-500">No decisions in the window yet.</p>;
  }
  const max = Math.max(
    1,
    ...sorted.map(([, counts]) =>
      Object.values(counts).reduce((s, n) => s + n, 0),
    ),
  );

  const width = Math.max(400, sorted.length * 40);
  const barWidth = width / sorted.length - 4;
  const height = 180;

  return (
    <svg viewBox={`0 0 ${width} ${height + 30}`} className="w-full" style={{ minHeight: 200 }}>
      {sorted.map(([day, counts], i) => {
        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        const x = i * (barWidth + 4) + 2;
        let yCursor = height;
        return (
          <g key={day}>
            {(['accepted', 'flagged', 'declined'] as const).map((decision) => {
              const v = counts[decision] ?? 0;
              if (v === 0) return null;
              const h = (v / max) * height;
              yCursor -= h;
              return (
                <rect
                  key={decision}
                  x={x}
                  y={yCursor}
                  width={barWidth}
                  height={h}
                  fill={DECISION_COLOR[decision]}
                />
              );
            })}
            <text
              x={x + barWidth / 2}
              y={height + 12}
              textAnchor="middle"
              fontSize="9"
              fill="#a1a1aa"
            >
              {day.slice(5)}
            </text>
            <text
              x={x + barWidth / 2}
              y={height + 24}
              textAnchor="middle"
              fontSize="9"
              fill="#71717a"
            >
              {total}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
