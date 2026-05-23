import type { ActiveJob } from '../../adapters/adapter.interface';

export type UnifiedJobSource = 'towbook' | 'aaa_salesforce' | 'manual';
export type UnifiedJobStatus =
  | 'new'
  | 'assigned'
  | 'en_route'
  | 'on_scene'
  | 'in_tow'
  | 'completed'
  | 'canceled'
  | 'declined';
export type UnifiedJobPriority = 'low' | 'normal' | 'urgent';

export interface UnifiedJobInput {
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
  dropoffAddress: string | null;
  serviceType: string | null;
  priority: UnifiedJobPriority;
  etaMinutes: number | null;
}

export interface AdapterNormalizer {
  source: UnifiedJobSource;
  normalize(tenantId: string, job: ActiveJob): UnifiedJobInput;
}
