'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  STATUS_FLOW,
  STATUS_LABEL,
  formatVehicle,
  type Driver,
  type UnifiedJob,
  type UnifiedJobStatus,
} from '@/lib/command-center-types';
import { StatusPill } from './StatusPill';

interface Props {
  job: UnifiedJob;
  drivers: Driver[];
  onAssign: (driverId: string | null) => Promise<void> | void;
  onStatusChange: (status: UnifiedJobStatus) => Promise<void> | void;
  onClose: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  towbook: 'Towbook',
  aaa_salesforce: 'AAA Salesforce',
  manual: 'Manual',
};

export function JobDrawer({ job, drivers, onAssign, onStatusChange, onClose }: Props) {
  const [pendingDriver, setPendingDriver] = useState<string>(job.assignedDriverId ?? '');
  const [working, setWorking] = useState(false);

  async function handleAssign(value: string) {
    setPendingDriver(value);
    setWorking(true);
    try {
      await onAssign(value || null);
    } finally {
      setWorking(false);
    }
  }

  async function handleStatus(next: UnifiedJobStatus) {
    setWorking(true);
    try {
      await onStatusChange(next);
    } finally {
      setWorking(false);
    }
  }

  const events = job.events ?? [];

  return (
    <aside className="flex h-full w-full flex-col bg-white">
      <header className="flex items-start justify-between border-b border-zinc-200 p-4">
        <div>
          <div className="flex items-center gap-3">
            <StatusPill status={job.status} />
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              {SOURCE_LABEL[job.source] ?? job.source}
            </span>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-zinc-900">
            {job.callerName || 'Unnamed caller'}
          </h2>
          {job.callerPhone && <p className="text-sm text-zinc-500">{job.callerPhone}</p>}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm text-zinc-700">
        <section>
          <h3 className="text-xs uppercase tracking-wide text-zinc-500">Vehicle</h3>
          <p className="mt-1 font-medium text-zinc-900">{formatVehicle(job)}</p>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-zinc-500">Pickup</h3>
          <p className="mt-1 font-medium text-zinc-900">{job.pickupAddress || '—'}</p>
          {job.pickupLat && job.pickupLng && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {Number(job.pickupLat).toFixed(4)}, {Number(job.pickupLng).toFixed(4)}
            </p>
          )}
        </section>

        {job.dropoffAddress && (
          <section>
            <h3 className="text-xs uppercase tracking-wide text-zinc-500">Dropoff</h3>
            <p className="mt-1 font-medium text-zinc-900">{job.dropoffAddress}</p>
          </section>
        )}

        <section>
          <h3 className="text-xs uppercase tracking-wide text-zinc-500">Assign driver</h3>
          <select
            value={pendingDriver}
            onChange={(e) => void handleAssign(e.target.value)}
            disabled={working}
            className="mt-1.5 w-full rounded border border-zinc-200 bg-zinc-50 px-2 py-2 text-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Unassigned</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.status})
              </option>
            ))}
          </select>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-zinc-500">Update status</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUS_FLOW.filter((s) => s !== job.status).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                disabled={working}
                onClick={() => void handleStatus(s)}
              >
                → {STATUS_LABEL[s]}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={working || job.status === 'canceled'}
              onClick={() => void handleStatus('canceled' as UnifiedJobStatus)}
            >
              Cancel job
            </Button>
          </div>
        </section>

        {job.autoDecision && (
          <section className="rounded border border-zinc-200 bg-blue-50/50 p-4">
            <h3 className="text-xs uppercase tracking-wide text-blue-600 font-semibold">AI decision</h3>
            <p className="mt-1.5 text-zinc-900">
              <span className="font-medium">{job.autoDecision}</span>
              {job.autoDecidedAt && (
                <span className="ml-2 text-xs text-zinc-500">
                  ({new Date(job.autoDecidedAt).toLocaleString()})
                </span>
              )}
            </p>
            {job.autoDecisionReason && (
              <p className="mt-1.5 text-sm text-zinc-600">{job.autoDecisionReason}</p>
            )}
          </section>
        )}

        <section>
          <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Timeline</h3>
          <ol className="space-y-3 border-l-2 border-zinc-100 pl-4 ml-1">
            {events.length === 0 && <li className="text-zinc-500">No events recorded yet.</li>}
            {events.map((e) => (
              <li key={e.id} className="relative">
                <div className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-zinc-300 border border-white" />
                <div className="text-xs text-zinc-500">
                  {new Date(e.createdAt).toLocaleString()}
                </div>
                <div className="text-zinc-900 mt-0.5">
                  <span className="font-medium">{e.eventType}</span>
                  {e.payload && Object.keys(e.payload).length > 0 && (
                    <span className="ml-2 text-xs text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                      {JSON.stringify(e.payload)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </aside>
  );
}
