'use client';

import { useMemo } from 'react';
import { TrackShell } from '@/components/track/TrackShell';
import { DriverCard } from '@/components/track/DriverCard';
import { CallCtas } from '@/components/track/CallCtas';
import { useTracking } from '@/components/track/useTracking';
import { normalizeStatus, STATUS_META, type TrackStatus } from '@/components/track/status';
import {
  CancelledState,
  CompleteState,
  ExpiredState,
  FetchErrorState,
  NotFoundState,
  OnSceneState,
  QueuedState,
  StatusBand,
} from '@/components/track/StatusStates';
import { DEFAULT_BRANDING } from '@/components/track/types';
import { TrackingMap } from './tracking-map';

const LIVE_STATES: TrackStatus[] = ['dispatched', 'en_route'];

export function TrackingClient({ token }: { token: string }) {
  const { view, branding, phase, updatedAt } = useTracking(token);

  const status: TrackStatus | null = useMemo(
    () => (view ? normalizeStatus(view) : null),
    [view],
  );

  const greeting = useMemo(() => {
    const first = view?.caller_name?.trim().split(/\s+/)[0];
    return first ? `Hi ${first}, hang tight` : 'Hang tight';
  }, [view?.caller_name]);

  // Initial load — branding not resolved yet, keep it neutral.
  if (phase === 'loading') {
    return (
      <TrackShell branding={DEFAULT_BRANDING}>
        <div className="flex flex-1 items-center justify-center py-24 text-sm text-slate-400">
          Loading your tracking page…
        </div>
      </TrackShell>
    );
  }

  if (phase === 'notfound') {
    return (
      <TrackShell branding={branding}>
        <NotFoundState />
        <CallCtas dispatcherPhone={branding.supportPhone} />
      </TrackShell>
    );
  }

  if (phase === 'error' || !view || !status) {
    return (
      <TrackShell branding={branding}>
        <FetchErrorState />
        <CallCtas dispatcherPhone={branding.supportPhone} />
      </TrackShell>
    );
  }

  const isLive = LIVE_STATES.includes(status);
  const eta = STATUS_META[status].live ? view.last_eta_minutes : null;
  const hasLiveLocation = view.driver_lat != null && view.driver_lng != null;

  let body: React.ReactNode;
  switch (status) {
    case 'queued':
      body = <QueuedState greeting={greeting} />;
      break;
    case 'on_scene':
      body = <OnSceneState driverName={view.assigned_driver_name} />;
      break;
    case 'complete':
      body = <CompleteState branding={branding} />;
      break;
    case 'cancelled':
      body = <CancelledState reason={view.cancel_reason} />;
      break;
    case 'expired':
      body = <ExpiredState />;
      break;
    default:
      // dispatched | en_route — live map + driver + status band.
      body = (
        <div className="flex flex-col gap-4 px-4 py-4">
          <StatusBand status={status} eta={eta} />
          <DriverCard driverName={view.assigned_driver_name} hasLiveLocation={hasLiveLocation} />
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className={status === 'en_route' ? 'h-[55vh] w-full' : 'h-72 w-full'}>
              <TrackingMap
                pickupLat={view.pickup_lat}
                pickupLng={view.pickup_lng}
                driverLat={view.driver_lat}
                driverLng={view.driver_lng}
                accentColor={branding.accentColor}
              />
            </div>
          </section>
          {updatedAt && (
            <p className="text-center text-xs text-slate-400">Live · updates every 30s</p>
          )}
        </div>
      );
  }

  return (
    <TrackShell branding={branding} eta={isLive ? eta : null}>
      {body}
      {status !== 'complete' && (
        <CallCtas dispatcherPhone={branding.supportPhone} driverCallUrl={view.driver_call_url} />
      )}
    </TrackShell>
  );
}
