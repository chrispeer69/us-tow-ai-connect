'use client';
import { Input } from '@/components/ui/input';
import { STATUS_LABEL, type UnifiedJobStatus } from '@/lib/command-center-types';
import { cn } from '@/lib/utils';

export interface CommandCenterFilters {
  status: Set<UnifiedJobStatus>;
  source: string | 'all';
  priority: 'all' | 'low' | 'normal' | 'urgent';
  search: string;
}

const STATUSES: UnifiedJobStatus[] = [
  'new',
  'assigned',
  'en_route',
  'on_scene',
  'in_tow',
  'completed',
  'canceled',
  'declined',
];

export function FilterBar({
  filters,
  onChange,
}: {
  filters: CommandCenterFilters;
  onChange: (next: CommandCenterFilters) => void;
}) {
  function toggleStatus(s: UnifiedJobStatus) {
    const next = new Set(filters.status);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onChange({ ...filters, status: next });
  }

  return (
    <aside className="flex h-full w-full flex-col gap-4 border-r border-zinc-800 bg-zinc-900/40 p-4 text-sm">
      <div>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Search</h3>
        <Input
          placeholder="Caller, address, source ID…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>

      <div>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Status</h3>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => {
            const on = filters.status.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition',
                  on
                    ? 'border-emerald-500 bg-emerald-600/20 text-emerald-300'
                    : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800',
                )}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Source</h3>
        <select
          value={filters.source}
          onChange={(e) => onChange({ ...filters, source: e.target.value })}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100"
        >
          <option value="all">All sources</option>
          <option value="towbook">Towbook</option>
          <option value="aaa_salesforce">AAA Salesforce</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      <div>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Priority</h3>
        <select
          value={filters.priority}
          onChange={(e) =>
            onChange({
              ...filters,
              priority: e.target.value as CommandCenterFilters['priority'],
            })
          }
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100"
        >
          <option value="all">All</option>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>
    </aside>
  );
}
