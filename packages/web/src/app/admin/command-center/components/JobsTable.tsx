'use client';
import { cn } from '@/lib/utils';
import { formatAge, formatVehicle, type UnifiedJob } from '@/lib/command-center-types';
import { StatusPill } from './StatusPill';

const SOURCE_LABEL: Record<string, string> = {
  towbook: 'Towbook',
  aaa_salesforce: 'AAA',
  manual: 'Manual',
};

export function JobsTable({
  jobs,
  selectedJobId,
  onSelect,
}: {
  jobs: UnifiedJob[];
  selectedJobId: string | null;
  onSelect: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-400">
        <div className="max-w-md text-center">
          <p className="font-medium text-zinc-200">No active jobs yet</p>
          <p className="mt-2">
            Connect an integration on the{' '}
            <a className="text-emerald-400 underline" href="/admin/integrations">
              Integrations
            </a>{' '}
            page, or create a manual job to populate the dispatch board.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
          <tr>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-left">Caller</th>
            <th className="px-3 py-2 text-left">Vehicle</th>
            <th className="px-3 py-2 text-left">Pickup</th>
            <th className="px-3 py-2 text-left">ETA</th>
            <th className="px-3 py-2 text-left">Driver</th>
            <th className="px-3 py-2 text-left">Age</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr
              key={j.id}
              onClick={() => onSelect(j.id)}
              className={cn(
                'cursor-pointer border-t border-zinc-800 transition hover:bg-zinc-800/60',
                j.id === selectedJobId && 'bg-zinc-800/80',
              )}
            >
              <td className="px-3 py-2">
                <StatusPill status={j.status} />
              </td>
              <td className="px-3 py-2 text-zinc-300">{SOURCE_LABEL[j.source] ?? j.source}</td>
              <td className="px-3 py-2">
                <div className="font-medium text-zinc-100">{j.callerName || '—'}</div>
                <div className="text-xs text-zinc-500">{j.callerPhone || ''}</div>
              </td>
              <td className="px-3 py-2 text-zinc-300">{formatVehicle(j)}</td>
              <td className="px-3 py-2 max-w-[280px] truncate text-zinc-300">
                {j.pickupAddress || '—'}
              </td>
              <td className="px-3 py-2 text-zinc-300">{j.etaMinutes ? `${j.etaMinutes} min` : '—'}</td>
              <td className="px-3 py-2 text-zinc-300">{j.driver?.name || '—'}</td>
              <td className="px-3 py-2 text-zinc-400">{formatAge(j.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
