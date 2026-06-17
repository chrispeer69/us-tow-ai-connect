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
  onCallCustomer: (scriptType: ManualCallScriptType) => Promise<void> | void;
  onClose: () => void;
}

export type ManualCallScriptType =
  | 'auto_flip'
  | 'eta_confirmation'
  | 'status_update'
  | 'winch_out'
  | 'convini_only';

const SOURCE_LABEL: Record<string, string> = {
  towbook: 'Towbook',
  aaa_salesforce: 'AAA Salesforce',
  manual: 'Manual',
};

export function JobDrawer({ job, drivers, onAssign, onStatusChange, onCallCustomer, onClose }: Props) {
  const [pendingDriver, setPendingDriver] = useState<string>(job.assignedDriverId ?? '');
  const [working, setWorking] = useState(false);
  const [callMessage, setCallMessage] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [manualScriptType, setManualScriptType] = useState<ManualCallScriptType>('auto_flip');

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

  async function handleCallCustomer() {
    setWorking(true);
    setCallMessage(null);
    setCallError(null);
    try {
      await onCallCustomer(manualScriptType);
      setCallMessage('Customer call requested.');
    } catch (err) {
      setCallError((err as Error).message);
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
          <h3 className="text-xs uppercase tracking-wide text-zinc-500">Customer call</h3>
          <label className="mt-2 block text-xs font-medium text-zinc-600">
            Script
            <select
              value={manualScriptType}
              onChange={(e) => setManualScriptType(e.target.value as ManualCallScriptType)}
              className="mt-1 block w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900"
            >
              <option value="auto_flip">Auto: confirm + flip logic</option>
              <option value="eta_confirmation">ETA confirmation</option>
              <option value="status_update">Status update</option>
              <option value="winch_out">Winch-out photo reminder</option>
              <option value="convini_only">CONVINI only</option>
            </select>
          </label>
          <Button
            className="mt-2 w-full"
            variant="outline"
            disabled={working || !job.callerPhone}
            onClick={() => void handleCallCustomer()}
          >
            Call Customer
          </Button>
          {!job.callerPhone && (
            <p className="mt-1 text-xs text-zinc-500">No caller phone number on this job.</p>
          )}
          {callMessage && <p className="mt-1 text-xs text-emerald-600">{callMessage}</p>}
          {callError && <p className="mt-1 text-xs text-red-500">{callError}</p>}
        </section>

        {(job.latestCall || job.latestFlip) && (
          <section className="rounded border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="text-xs uppercase tracking-wide text-zinc-500">AI call result</h3>
            {job.latestCall && (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-zinc-600">Call status</span>
                <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-zinc-800">
                  {job.latestCall.status.replace(/_/g, ' ')}
                </span>
              </div>
            )}
            {job.latestCall?.error && (
              <p className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700">
                {job.latestCall.error}
              </p>
            )}
            {job.latestCall?.analysisData && Object.keys(job.latestCall.analysisData).length > 0 && (
              <div className="mt-3 rounded bg-white p-3 text-xs">
                <div className="font-semibold uppercase tracking-wide text-zinc-500">
                  Retell data received
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {Object.entries(job.latestCall.analysisData)
                    .filter(([, value]) => value !== null && value !== undefined && value !== '')
                    .slice(0, 8)
                    .map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="truncate text-zinc-500">{key.replace(/_/g, ' ')}</dt>
                        <dd className="truncate text-right font-medium text-zinc-900">
                          {String(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            )}
            {job.latestCall?.transcript && (
              <div className="mt-3 rounded bg-white p-3 text-xs">
                <div className="font-semibold uppercase tracking-wide text-zinc-500">
                  Transcript
                </div>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-zinc-700">
                  {job.latestCall.transcript}
                </p>
              </div>
            )}
            {job.latestFlip && (
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-600">Flip result</span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${flipResultClass(job.latestFlip.flipOutcome)}`}>
                    {formatFlipResult(job.latestFlip.flipOutcome, job.latestFlip.flipEligible)}
                  </span>
                </div>
                {job.latestFlip.destinationType && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-600">Destination</span>
                    <span className="text-right font-medium text-zinc-900">
                      {job.latestFlip.destinationType.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                {job.latestFlip.nearestOurShop && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-600">Redirect shop</span>
                    <span className="text-right font-medium text-emerald-700">
                      {job.latestFlip.nearestOurShop}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-600">CONVINI</span>
                  <span className="font-medium text-zinc-900">
                    {job.latestFlip.conviniLinkSent ? 'sent' : 'not sent'}
                  </span>
                </div>
                <p className="pt-1 text-xs text-zinc-500">
                  Updated {new Date(job.latestFlip.callTime).toLocaleString()}
                </p>
              </div>
            )}
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

function formatFlipResult(outcome: string | null, eligible: boolean): string {
  if (outcome && /WIN|ACCEPTED/i.test(outcome)) return 'Flip win';
  if (!eligible) return 'No flip';
  if (!outcome || outcome === 'NOT_ATTEMPTED') return 'Pending';
  return outcome.replace(/_/g, ' ').toLowerCase();
}

function flipResultClass(outcome: string | null): string {
  if (outcome && /WIN|ACCEPTED/i.test(outcome)) return 'bg-emerald-100 text-emerald-700';
  if (outcome && /DECLINED|LOSS|FAILED/i.test(outcome)) return 'bg-rose-100 text-rose-700';
  return 'bg-zinc-100 text-zinc-700';
}
