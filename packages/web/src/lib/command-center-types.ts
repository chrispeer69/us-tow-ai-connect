export type UnifiedJobStatus =
  | 'new'
  | 'assigned'
  | 'en_route'
  | 'on_scene'
  | 'in_tow'
  | 'completed'
  | 'canceled'
  | 'declined';

export type UnifiedJobSource = 'towbook' | 'aaa_salesforce' | 'manual';
export type UnifiedJobPriority = 'low' | 'normal' | 'urgent';

export interface UnifiedJob {
  id: string;
  tenantId: string;
  source: UnifiedJobSource;
  sourceJobId: string;
  sourcePayload: Record<string, unknown>;
  status: UnifiedJobStatus;
  callerPhone: string | null;
  callerName: string | null;
  vehicleYear: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleColor: string | null;
  pickupAddress: string | null;
  pickupLat: string | null;
  pickupLng: string | null;
  dropoffAddress: string | null;
  dropoffLat: string | null;
  dropoffLng: string | null;
  serviceType: string | null;
  priority: UnifiedJobPriority;
  assignedDriverId: string | null;
  assignedTruckId: string | null;
  etaMinutes: number | null;
  acceptedAt: string | null;
  dispatchedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  autoDecision: string | null;
  autoDecisionReason: string | null;
  autoDecidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  driver?: Driver | null;
  truck?: Truck | null;
  events?: JobEvent[];
  latestCall?: CommandCenterCallSummary | null;
  latestFlip?: CommandCenterFlipSummary | null;
}

export interface CommandCenterCallSummary {
  id: string;
  purpose: string;
  status: string;
  attempts: number;
  durationSeconds: number | null;
  error: string | null;
  transcript: string | null;
  analysisData: Record<string, unknown> | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface CommandCenterFlipSummary {
  id: string;
  destinationType: string | null;
  flipEligible: boolean;
  nearestOurShop: string | null;
  flipOutcome: string | null;
  conviniLinkSent: boolean;
  managementNotified: boolean;
  callTime: string;
}

export interface Driver {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  status: 'available' | 'on_job' | 'off_duty';
  currentLat: string | null;
  currentLng: string | null;
  lastPingAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Truck {
  id: string;
  tenantId: string;
  name: string;
  type: 'light' | 'medium' | 'heavy' | 'flatbed';
  status: 'available' | 'in_use' | 'out_of_service';
  assignedDriverId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEvent {
  id: string;
  jobId: string;
  eventType: string;
  payload: Record<string, unknown>;
  actor: string | null;
  createdAt: string;
}

export interface Stats {
  activeJobs: number;
  jobsLast24h: number;
  jobsPerHour: number;
  avgEtaMinutes: number | null;
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
}

export const STATUS_COLOR: Record<UnifiedJobStatus, string> = {
  new: 'bg-zinc-500',
  assigned: 'bg-blue-500',
  en_route: 'bg-indigo-500',
  on_scene: 'bg-amber-500',
  in_tow: 'bg-purple-500',
  completed: 'bg-emerald-600',
  canceled: 'bg-zinc-700',
  declined: 'bg-red-600',
};

export const STATUS_LABEL: Record<UnifiedJobStatus, string> = {
  new: 'New',
  assigned: 'Assigned',
  en_route: 'En Route',
  on_scene: 'On Scene',
  in_tow: 'In Tow',
  completed: 'Completed',
  canceled: 'Canceled',
  declined: 'Declined',
};

export const STATUS_FLOW: UnifiedJobStatus[] = [
  'new',
  'assigned',
  'en_route',
  'on_scene',
  'in_tow',
  'completed',
];

export function formatVehicle(j: UnifiedJob): string {
  const bits = [j.vehicleYear, j.vehicleColor, j.vehicleMake, j.vehicleModel].filter(Boolean);
  return bits.join(' ') || '—';
}

export function ageMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function formatAge(iso: string): string {
  const m = ageMinutes(iso);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
