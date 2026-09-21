import { Injectable } from '@nestjs/common';
import type { ActiveJob } from '../../adapters/adapter.interface';
import type { AdapterNormalizer, UnifiedJobInput, UnifiedJobStatus } from './types';

/**
 * Exact active labels plus read-only outcomes emitted after inspecting a
 * Cleared Work Order's terminal timestamps.
 */
export function mapAaaStatus(raw: string | null | undefined): UnifiedJobStatus {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'en route':
      return 'en_route';
    case 'on location':
      return 'on_scene';
    case 'tow loaded':
      return 'in_tow';
    case 'tow complete':
      return 'completed';
    case 'closed without tow complete':
      return 'canceled';
    default:
      // Raw `Cleared` deliberately lands here. It is not successful until the
      // adapter verifies the Work Order's Tow Complete timestamp.
      return 'new';
  }
}

export function parseAaaVehicleProfile(profile: string): {
  year: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
} {
  const primary = profile.split(' - ')[0]?.trim() ?? '';
  const match = primary.match(/^(.*?)\s+(\d{4})\s+(\S+)\s+(.+)$/);
  if (!match) return { year: null, make: null, model: primary || null, color: null };
  return {
    color: match[1]?.trim() || null,
    year: match[2] ?? null,
    make: match[3] ?? null,
    model: match[4]?.trim() || null,
  };
}

@Injectable()
export class AaaNormalizer implements AdapterNormalizer {
  public readonly source = 'aaa_salesforce' as const;

  normalize(tenantId: string, job: ActiveJob): UnifiedJobInput {
    const vehicle = parseAaaVehicleProfile(job.vehicle);
    // AAA scraper currently captures only a thin row; richer fields will
    // arrive once a job-detail Playwright pass is wired up. We keep the
    // raw row in source_payload so the rules engine can read whatever
    // future fields land there without a schema change.
    return {
      tenantId,
      source: 'aaa_salesforce',
      sourceJobId: String(job.jobId || `${job.customerPhone}|${job.customerName}`),
      sourcePayload: {
        ...(job as unknown as Record<string, unknown>),
        status_raw: job.status,
      },
      status: mapAaaStatus(job.status),
      callerPhone: job.customerPhone || null,
      callerName: job.customerName || null,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleColor: vehicle.color,
      pickupAddress: job.pickup || null,
      pickupLat: job.latitude || null,
      pickupLng: job.longitude || null,
      dropoffAddress: job.destination || null,
      serviceType: job.serviceType || null,
      priority: 'normal',
      etaMinutes: null,
    };
  }
}
