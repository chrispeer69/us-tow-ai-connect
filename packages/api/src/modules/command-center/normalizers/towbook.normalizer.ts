import { Injectable } from '@nestjs/common';
import type { ActiveJob } from '../../adapters/adapter.interface';
import { mapAdapterStatus } from './status-map';
import type { AdapterNormalizer, UnifiedJobInput } from './types';
import { parseVehicleString } from './vehicle-parse';

function parseEtaToMinutes(eta: string | null | undefined): number | null {
  if (!eta || eta === 'Unknown') return null;
  // Towbook ETAs come as "12 min", "1h 5m", "01:25" — try the common shapes.
  const minMatch = /^(\d+)\s*m(in)?$/i.exec(eta.trim());
  if (minMatch) return Number(minMatch[1]);
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(eta.trim());
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  const hAndM = /^(\d+)\s*h(?:r)?\s*(\d+)?\s*m?$/i.exec(eta.trim());
  if (hAndM) return Number(hAndM[1]) * 60 + Number(hAndM[2] ?? 0);
  return null;
}

@Injectable()
export class TowbookNormalizer implements AdapterNormalizer {
  public readonly source = 'towbook' as const;

  normalize(tenantId: string, job: ActiveJob): UnifiedJobInput {
    const vehicle = parseVehicleString(job.vehicle);
    return {
      tenantId,
      source: 'towbook',
      sourceJobId: String(job.jobId || `${job.customerPhone}|${job.customerName}|${job.status}`),
      sourcePayload: {
        ...(job as unknown as Record<string, unknown>),
        status_raw: job.status,
      },
      status: mapAdapterStatus(job.status),
      callerPhone: job.customerPhone || null,
      callerName: job.customerName || null,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleColor: vehicle.color,
      pickupAddress: job.pickup || null,
      dropoffAddress: job.destination || null,
      serviceType: null,
      priority: 'normal',
      etaMinutes: parseEtaToMinutes(job.eta),
    };
  }
}
