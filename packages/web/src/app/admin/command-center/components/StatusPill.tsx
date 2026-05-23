'use client';
import { STATUS_COLOR, STATUS_LABEL, type UnifiedJobStatus } from '@/lib/command-center-types';
import { cn } from '@/lib/utils';

export function StatusPill({ status, className }: { status: UnifiedJobStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white',
        STATUS_COLOR[status] ?? 'bg-zinc-500',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
