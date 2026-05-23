'use client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatAge, type Driver } from '@/lib/command-center-types';

const COLOR: Record<Driver['status'], string> = {
  available: 'bg-emerald-600',
  on_job: 'bg-amber-500',
  off_duty: 'bg-zinc-600',
};

export function DriversPanel({
  drivers,
  onCreate,
}: {
  drivers: Driver[];
  onCreate: () => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-800 bg-zinc-900/40">
      <header className="flex items-center justify-between border-b border-zinc-800 p-3">
        <h2 className="text-sm font-medium text-zinc-200">Drivers</h2>
        <Button size="sm" variant="outline" onClick={onCreate}>
          + Add
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {drivers.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No drivers yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {drivers.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 p-3">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{d.name}</p>
                  {d.phone && <p className="text-xs text-zinc-500">{d.phone}</p>}
                  {d.lastPingAt && (
                    <p className="text-xs text-zinc-500">ping {formatAge(d.lastPingAt)} ago</p>
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
  );
}
