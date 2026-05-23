'use client';

interface Props {
  driverName: string;
  onShift: boolean;
  batteryPct: number | null;
  onToggleShift: () => void;
}

/**
 * Top bar — driver identity, on-shift pill, battery indicator. Always visible.
 */
export function TopBar({ driverName, onShift, batteryPct, onToggleShift }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900 sticky top-0 z-20">
      <div>
        <p className="text-xs text-zinc-500 leading-none mb-1">Signed in as</p>
        <p className="font-semibold text-sm" data-testid="driver-name">
          {driverName || 'No driver name'}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {batteryPct != null && (
          <span
            className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300"
            data-testid="battery"
          >
            🔋 {batteryPct}%
          </span>
        )}
        <button
          onClick={onToggleShift}
          data-testid="shift-toggle"
          className={
            'text-xs px-3 py-1 rounded-full font-medium transition ' +
            (onShift
              ? 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
              : 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600')
          }
        >
          {onShift ? 'On Shift' : 'Off Shift'}
        </button>
      </div>
    </header>
  );
}
