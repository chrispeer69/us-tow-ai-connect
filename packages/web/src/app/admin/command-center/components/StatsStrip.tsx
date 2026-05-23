'use client';
import type { Stats } from '@/lib/command-center-types';

export function StatsStrip({ stats }: { stats: Stats | null }) {
  const tiles = [
    {
      label: 'Active jobs',
      value: stats?.activeJobs?.toLocaleString() ?? '—',
    },
    {
      label: 'Avg ETA',
      value:
        stats?.avgEtaMinutes !== null && stats?.avgEtaMinutes !== undefined
          ? `${stats.avgEtaMinutes.toFixed(0)} min`
          : '—',
    },
    {
      label: 'Jobs (24h)',
      value: stats?.jobsLast24h?.toLocaleString() ?? '—',
    },
    {
      label: 'Jobs / hr',
      value: stats?.jobsPerHour !== undefined ? stats.jobsPerHour.toFixed(2) : '—',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
        >
          <p className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">{t.value}</p>
        </div>
      ))}
    </div>
  );
}
