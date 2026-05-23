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
    <aside className="flex h-full w-full flex-col border-l border-zinc-800 bg-zinc-950">
      <header className="flex items-start justify-between border-b border-zinc-800 p-4">
        <div>
          <div className="flex items-center gap-3">
            <StatusPill status={job.status} />
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              {SOURCE_LABEL[job.source] ?? job.source}
            </span>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-zinc-100">
            {job.callerName || 'Unnamed caller'}
          </h2>
          {job.callerPhone && <p className="text-sm text-zinc-400">{job.callerPhone}</p>}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm text-zinc-300">
        <section>
          <h3 className="text-xs uppercase tracking-wide text-zinc-500">Vehicle</h3>
          <p className="mt-1 text-zinc-200">{formatVehicle(job)}</p>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-zinc-500">Pickup</h3>
          <p className="mt-1 text-zinc-200">{job.pickupAddress || '—'}</p>
          {job.pickupLat && job.pickupLng && (
            <p className="text-xs text-zinc-500">
              {Number(job.pickupLat).toFixed(4)}, {Number(job.pickupLng).toFixed(4)}
            </p>
          )}
        </section>

        {job.dropoffAddress && (
          <section>
            <h3 className="text-xs uppercase tracking-wide text-zinc-500">Dropoff</h3>
            <p className="mt-1 text-zinc-200">{job.dropoffAddress}</p>
          </section>
        )}

        <section>
          <h3 className="text-xs uppercase tracking-wide text-zinc-500">Assign driver</h3>
          <select
            value={pendingDriver}
            onChange={(e) => void handleAssign(e.target.value)}
            disabled={working}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100"
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
          <section className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
            <h3 className="text-xs uppercase tracking-wide text-zinc-500">AI decision</h3>
            <p className="mt-1 text-zinc-200">
              <span className="font-medium">{job.autoDecision}</span>
              {job.autoDecidedAt && (
                <span className="ml-2 text-xs text-zinc-500">
                  ({new Date(job.autoDecidedAt).toLocaleString()})
                </span>
              )}
            </p>
            {job.autoDecisionReason && (
              <p className="mt-1 text-xs text-zinc-400">{job.autoDecisionReason}</p>
            )}
          </section>
        )}

        <section>
          <h3 className="text-xs uppercase tracking-wide text-zinc-500">Timeline</h3>
          <ol className="mt-2 space-y-2 border-l border-zinc-800 pl-3">
            {events.length === 0 && <li className="text-zinc-500">No events recorded yet.</li>}
            {events.map((e) => (
              <li key={e.id}>
                <div className="text-xs text-zinc-500">
                  {new Date(e.createdAt).toLocaleString()}
                </div>
                <div className="text-zinc-200">
                  <span className="font-medium">{e.eventType}</span>
                  {e.payload && Object.keys(e.payload).length > 0 && (
                    <span className="ml-2 text-xs text-zinc-500">
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
