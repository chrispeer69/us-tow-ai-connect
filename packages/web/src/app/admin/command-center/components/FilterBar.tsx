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
    <div className="flex w-full flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm">
      {/* Top Row: Full width search */}
      <div className="flex w-full items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 w-16">Search</span>
        <Input
          placeholder="Search caller, address, source ID…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="h-10 flex-1 bg-zinc-50 border-zinc-200"
        />
      </div>

      {/* Bottom Row: Other filters */}
      <div className="flex flex-wrap items-center gap-4 border-t border-zinc-100 pt-3">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Status</span>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => {
              const on = filters.status.has(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition font-medium',
                    on
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50',
                  )}
                >
                  {STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 border-l border-zinc-200 pl-4">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Source</span>
          <select
            value={filters.source}
            onChange={(e) => onChange({ ...filters, source: e.target.value })}
            className="h-9 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All sources</option>
            <option value="towbook">Towbook</option>
            <option value="aaa_salesforce">AAA Salesforce</option>
            <option value="manual">Manual</option>
          </select>
        </div>

        <div className="flex items-center gap-2 border-l border-zinc-200 pl-4">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Priority</span>
          <select
            value={filters.priority}
            onChange={(e) =>
              onChange({
                ...filters,
                priority: e.target.value as CommandCenterFilters['priority'],
              })
            }
            className="h-9 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>
    </div>
  );
}
