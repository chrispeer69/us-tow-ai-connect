'use client';

import {
  actionLabel,
  nextActionsFor,
  type DriverJob,
  type DriverJobAction,
} from '../_lib/driver-api';

interface Props {
  job: DriverJob;
  busy: boolean;
  onAction: (action: DriverJobAction) => void;
}

/**
 * Active-job card. Renders caller/vehicle/pickup, tap-to-call + tap-to-navigate
 * affordances, and the next legal state transitions per the driver state
 * machine (see `nextActionsFor`).
 */
export function JobCard({ job, busy, onAction }: Props) {
  const actions = nextActionsFor(job.status);
  const directionsHref = job.pickup_address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.pickup_address)}`
    : null;
  const callHref = job.caller_phone ? `tel:${job.caller_phone}` : null;

  return (
    <div
      className="rounded-xl border border-zinc-700 bg-zinc-800 p-4 space-y-3"
      data-testid="active-job-card"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            {job.source ?? 'unknown'} · {job.priority ?? 'normal'}
          </p>
          <p className="font-semibold text-lg leading-tight">
            {job.caller_name ?? 'Unknown caller'}
          </p>
        </div>
        <span
          className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 capitalize"
          data-testid="job-status-pill"
        >
          {job.status?.replace(/_/g, ' ') ?? '—'}
        </span>
      </div>

      <div className="text-sm space-y-1">
        {callHref ? (
          <a
            href={callHref}
            className="flex items-center justify-between rounded bg-zinc-900 px-3 py-2 hover:bg-zinc-950 active:bg-black"
          >
            <span className="text-zinc-300">📞 {job.caller_phone}</span>
            <span className="text-xs text-emerald-400">Call</span>
          </a>
        ) : (
          <p className="text-zinc-500 text-sm">No caller phone on file</p>
        )}

        {directionsHref ? (
          <a
            href={directionsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded bg-zinc-900 px-3 py-2 hover:bg-zinc-950 active:bg-black"
          >
            <p className="text-zinc-300">📍 {job.pickup_address}</p>
            <p className="text-xs text-emerald-400">Tap for directions →</p>
          </a>
        ) : (
          <p className="text-zinc-500 text-sm">No pickup address</p>
        )}

        {job.vehicle && (
          <p className="text-zinc-400 text-sm">
            🚗 {[job.vehicle.year, job.vehicle.color, job.vehicle.make, job.vehicle.model]
              .filter(Boolean)
              .join(' ')}
          </p>
        )}

        {job.service_type && (
          <p className="text-zinc-400 text-sm">🛠 {job.service_type}</p>
        )}

        {job.payout_estimate != null && (
          <p className="text-zinc-300 text-sm font-medium">
            💵 Est. payout: ${job.payout_estimate.toFixed(2)}
          </p>
        )}
      </div>

      {actions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-2" data-testid="action-row">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy}
              onClick={() => onAction(a)}
              data-testid={`action-${a}`}
              className={
                'rounded-lg px-3 py-3 text-sm font-semibold transition ' +
                'disabled:opacity-50 disabled:cursor-wait ' +
                (a === 'decline' || a === 'cancel'
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950')
              }
            >
              {actionLabel(a)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
