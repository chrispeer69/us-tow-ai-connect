import { Injectable } from '@nestjs/common';
import type { ActiveJob } from '../../adapters/adapter.interface';
import type { AdapterNormalizer, UnifiedJobInput, UnifiedJobStatus } from './types';

/** Exact AAA labels verified from Service Appointment Status History. */
export function mapAaaStatus(raw: string | null | undefined): UnifiedJobStatus {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'en route':
      return 'en_route';
    case 'on location':
      return 'on_scene';
    case 'tow loaded':
      return 'in_tow';
    case 'cleared':
      return 'completed';
    default:
      // Unknown AAA values fail closed. The adapter excludes and logs them;
      // this fallback prevents direct callers from treating them as terminal.
      return 'new';
  }
}

@Injectable()
export class AaaNormalizer implements AdapterNormalizer {
  public readonly source = 'aaa_salesforce' as const;

  normalize(tenantId: string, job: ActiveJob): UnifiedJobInput {
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
      vehicleYear: null,
      vehicleMake: null,
      vehicleModel: null,
      vehicleColor: null,
      pickupAddress: job.pickup || null,
      dropoffAddress: job.destination || null,
      serviceType: null,
      priority: 'normal',
      etaMinutes: null,
    };
  }
}
