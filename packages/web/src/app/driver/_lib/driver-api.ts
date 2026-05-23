/**
 * Driver app fetch helper. Hits the Next.js BFF proxy under `/api/driver/*`
 * which adds the tenant API key server-side (driver clients can't safely
 * carry the key in localStorage; the BFF reads DRIVER_TENANT_API_KEY env).
 *
 * Until per-driver bearer auth lands, every client sends `?driver_phone=`
 * so the API can scope reads. The phone lives in localStorage and is
 * settable from /driver/profile.
 */

export interface DriverProfile {
  driver_phone: string;
  driver_name: string;
  ping_interval_sec: number;
  high_accuracy_gps: boolean;
}

const PROFILE_KEY = 'ustow.driver.profile';

const DEFAULT_PROFILE: DriverProfile = {
  driver_phone: '',
  driver_name: '',
  ping_interval_sec: 30,
  high_accuracy_gps: true,
};

export function loadProfile(): DriverProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw) as Partial<DriverProfile>;
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(p: DriverProfile): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

export function clearProfile(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PROFILE_KEY);
}

export async function driverApi<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...((headers as Record<string, string> | undefined) ?? {}),
  };
  if (json !== undefined) finalHeaders['Content-Type'] = 'application/json';
  const res = await fetch(`/api/driver${path}`, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : (init.body ?? undefined),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface DriverJob {
  job_id: string | null;
  source: string | null;
  status: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  vehicle: { year?: string; make?: string; model?: string; color?: string } | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  service_type: string | null;
  priority: string | null;
  eta_minutes: number | null;
  payout_estimate: number | null;
  assigned_at: string | null;
  completed_at: string | null;
}

export type DriverJobAction =
  | 'accept'
  | 'decline'
  | 'en_route'
  | 'on_scene'
  | 'in_tow'
  | 'completed'
  | 'cancel';

/**
 * State machine: which actions can the driver take *right now*?
 * Order matters — earlier actions are rendered first when both are valid.
 */
export function nextActionsFor(status: string | null): DriverJobAction[] {
  switch (status) {
    case 'new':
    case 'pending':
    case 'flagged':
    case 'auto_accepted':
      return ['accept', 'decline'];
    case 'assigned':
      return ['en_route', 'decline'];
    case 'en_route':
      return ['on_scene'];
    case 'on_scene':
      return ['in_tow', 'completed'];
    case 'in_tow':
      return ['completed'];
    default:
      return [];
  }
}

export function actionLabel(action: DriverJobAction): string {
  return (
    {
      accept: 'Accept',
      decline: 'Decline',
      en_route: 'En Route',
      on_scene: 'On Scene',
      in_tow: 'In Tow',
      completed: 'Complete',
      cancel: 'Cancel',
    }[action] ?? action
  );
}
