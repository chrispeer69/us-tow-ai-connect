'use client';

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Driver + vehicle card shown above the map. The public payload exposes
 * `assigned_driver_name` only — truck/vehicle details are not in the contract
 * (noted in PR body), so the subtitle stays generic until the API adds them.
 */
export function DriverCard({
  driverName,
  hasLiveLocation,
}: {
  driverName: string | null;
  hasLiveLocation: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ backgroundColor: 'var(--brand-primary)' }}
        aria-hidden
      >
        {driverName ? initials(driverName) : '—'}
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-900">
          {driverName ?? 'Assigning a driver…'}
        </p>
        <p className="text-xs text-slate-500">
          {hasLiveLocation
            ? 'Tow truck · live location updating'
            : 'Tow truck · location appears once en route'}
        </p>
      </div>
    </div>
  );
}
