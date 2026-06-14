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
  hasIntegrations,
  selectedJobId,
  onSelect,
}: {
  jobs: UnifiedJob[];
  hasIntegrations: boolean;
  selectedJobId: string | null;
  onSelect: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm">
        <div className="max-w-md text-center">
          <p className="font-medium text-zinc-900">No active jobs yet</p>
          {!hasIntegrations ? (
            <p className="mt-2">
              Connect an integration on the{' '}
              <a className="text-blue-600 underline hover:text-blue-700" href="/admin/integrations">
                Integrations
              </a>{' '}
              page, or create a manual job to populate the dispatch board.
            </p>
          ) : (
            <p className="mt-2">
              Your integrations are connected! New jobs will appear here automatically when they are dispatched.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200">
          <tr>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-left">Caller</th>
            <th className="px-3 py-2 text-left">Vehicle</th>
            <th className="px-3 py-2 text-left">Pickup</th>
            <th className="px-3 py-2 text-left">ETA</th>
            <th className="px-3 py-2 text-left">Driver</th>
            <th className="px-3 py-2 text-left">AI call</th>
            <th className="px-3 py-2 text-left">Age</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr
              key={j.id}
              onClick={() => onSelect(j.id)}
              className={cn(
                'cursor-pointer border-t border-zinc-100 transition hover:bg-zinc-50',
                j.id === selectedJobId && 'bg-blue-50/50',
              )}
            >
              <td className="px-3 py-2">
                <StatusPill status={j.status} />
              </td>
              <td className="px-3 py-2 text-zinc-700 font-medium">{SOURCE_LABEL[j.source] ?? j.source}</td>
              <td className="px-3 py-2">
                <div className="font-semibold text-zinc-900">{j.callerName || '—'}</div>
                <div className="text-xs text-zinc-500">{j.callerPhone || ''}</div>
              </td>
              <td className="px-3 py-2 text-zinc-700">{formatVehicle(j)}</td>
              <td className="px-3 py-2 max-w-[280px] truncate text-zinc-700">
                {j.pickupAddress || '—'}
              </td>
              <td className="px-3 py-2 text-zinc-700 font-medium">
                {j.etaMinutes != null
                  ? j.etaMinutes < 0
                    ? `Late (${Math.abs(j.etaMinutes)}m)`
                    : `${j.etaMinutes} min`
                  : '—'}
              </td>
              <td className="px-3 py-2 text-zinc-700">{j.driver?.name || '—'}</td>
              <td className="px-3 py-2">
                <CallResultPill job={j} />
              </td>
              <td className="px-3 py-2 text-zinc-400 text-xs">{formatAge(j.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CallResultPill({ job }: { job: UnifiedJob }) {
  const flip = job.latestFlip;
  const call = job.latestCall;

  if (flip?.flipOutcome && /WIN|ACCEPTED/i.test(flip.flipOutcome)) {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
        Flip win
      </span>
    );
  }
  if (call?.status) {
    const color = call.status === 'completed'
      ? 'bg-blue-100 text-blue-700'
      : call.status === 'failed' || call.status === 'no_answer'
        ? 'bg-rose-100 text-rose-700'
        : 'bg-zinc-100 text-zinc-700';
    return (
      <span className={cn('inline-flex rounded-full px-2 py-1 text-xs font-semibold', color)}>
        {call.status.replace(/_/g, ' ')}
      </span>
    );
  }
  if (flip) {
    return (
      <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">
        Flip checked
      </span>
    );
  }
  return <span className="text-xs text-zinc-400">—</span>;
}
