'use client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatAge, type Driver } from '@/lib/command-center-types';

const COLOR: Record<Driver['status'], string> = {
  available: 'bg-emerald-500',
  on_job: 'bg-amber-500',
  off_duty: 'bg-zinc-400',
};

export function DriversModal({
  drivers,
  onCreate,
  onClose,
}: {
  drivers: Driver[];
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-zinc-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 p-4">
          <h2 className="text-lg font-semibold text-zinc-900">Manage Drivers</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onCreate}>
              + Add
            </Button>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              ✕
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {drivers.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-500">No drivers yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {drivers.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 p-4 hover:bg-zinc-50">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{d.name}</p>
                    {d.phone && <p className="text-xs text-zinc-500">{d.phone}</p>}
                    {d.lastPingAt && (
                      <p className="text-xs text-zinc-400">ping {formatAge(d.lastPingAt)} ago</p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white',
                      COLOR[d.status] ?? 'bg-zinc-500',
                    )}
                  >
                    {d.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
