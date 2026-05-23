import { Injectable } from '@nestjs/common';
import type { ActiveJob } from '../../adapters/adapter.interface';
import { mapAdapterStatus } from './status-map';
import type { AdapterNormalizer, UnifiedJobInput } from './types';

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
      status: mapAdapterStatus(job.status),
      callerPhone: job.customerPhone || null,
      callerName: job.customerName || null,
      vehicleYear: null,
      vehicleMake: null,
      vehicleModel: null,
      vehicleColor: null,
      pickupAddress: job.destination || null,
      dropoffAddress: null,
      serviceType: null,
      priority: 'normal',
      etaMinutes: null,
    };
  }
}
