import type { TrackingView } from './types';

/**
 * Normalized caller-facing state. The API is the source of truth and emits
 * `created/driver_assigned/en_route/on_scene/completed/expired`; the session
 * spec uses aliases (`queued/dispatched/complete/cancelled`). We accept both
 * and render off the normalized union. See S43_DECISIONS.md D2.
 */
export type TrackStatus =
  | 'queued'
  | 'dispatched'
  | 'en_route'
  | 'on_scene'
  | 'complete'
  | 'cancelled'
  | 'expired';

export function normalizeStatus(view: Pick<TrackingView, 'status' | 'expired'>): TrackStatus {
  if (view.expired) return 'expired';
  switch ((view.status ?? '').toLowerCase()) {
    case 'queued':
    case 'created':
    case 'pending':
      return 'queued';
    case 'dispatched':
    case 'driver_assigned':
    case 'assigned':
      return 'dispatched';
    case 'en_route':
    case 'enroute':
      return 'en_route';
    case 'on_scene':
    case 'arrived':
      return 'on_scene';
    case 'complete':
    case 'completed':
    case 'done':
      return 'complete';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    default:
      // Unknown future status: keep the caller informed without lying.
      return 'queued';
  }
}

interface StatusMeta {
  label: string;
  /** true → live map + ETA are meaningful for this state. */
  live: boolean;
}

export const STATUS_META: Record<TrackStatus, StatusMeta> = {
  queued: { label: 'Finding your driver', live: false },
  dispatched: { label: 'Driver assigned', live: true },
  en_route: { label: 'Driver en route', live: true },
  on_scene: { label: 'Driver has arrived', live: false },
  complete: { label: 'Service complete', live: false },
  cancelled: { label: 'Service cancelled', live: false },
  expired: { label: 'Link expired', live: false },
};
