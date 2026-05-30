'use client';
import type { Stats } from '@/lib/command-center-types';

export function StatsStrip({ stats }: { stats: Stats | null }) {
  const items = [
    { label: 'Active jobs', value: stats?.activeJobs?.toLocaleString() ?? '—', color: '#3b82f6' },
    {
      label: 'Avg ETA',
      value: stats?.avgEtaMinutes != null ? `${stats.avgEtaMinutes.toFixed(0)} min` : '—',
      color: '#22c55e',
    },
    { label: 'Jobs (24h)', value: stats?.jobsLast24h?.toLocaleString() ?? '—', color: '#1e293b' },
    {
      label: 'Jobs / hr',
      value: stats?.jobsPerHour !== undefined ? stats.jobsPerHour.toFixed(2) : '—',
      color: '#f59e0b',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-4 rounded-full"
              style={{ backgroundColor: it.color }}
            />
            <span className="text-2xl font-bold tracking-tight text-zinc-900">{it.value}</span>
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}
