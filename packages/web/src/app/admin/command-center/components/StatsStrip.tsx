'use client';
import type { Stats } from '@/lib/command-center-types';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';

export function StatsStrip({ stats }: { stats: Stats | null }) {
  return (
    <StatTileGrid className="sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        accent="blue"
        label="Active jobs"
        value={stats?.activeJobs?.toLocaleString() ?? '—'}
      />
      <StatTile
        accent="green"
        label="Avg ETA"
        value={
          stats?.avgEtaMinutes !== null && stats?.avgEtaMinutes !== undefined
            ? `${stats.avgEtaMinutes.toFixed(0)} min`
            : '—'
        }
      />
      <StatTile
        accent="navy"
        label="Jobs (24h)"
        value={stats?.jobsLast24h?.toLocaleString() ?? '—'}
      />
      <StatTile
        accent="amber"
        label="Jobs / hr"
        value={stats?.jobsPerHour !== undefined ? stats.jobsPerHour.toFixed(2) : '—'}
      />
    </StatTileGrid>
  );
}
