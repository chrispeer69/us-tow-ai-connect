import { Injectable } from '@nestjs/common';
import type { ActiveJob } from '../../adapters/adapter.interface';
import { mapAdapterStatus } from './status-map';
import type { AdapterNormalizer, UnifiedJobInput } from './types';
import { parseVehicleString } from './vehicle-parse';

function parseEtaToMinutes(eta: string | null | undefined): number | null {
  if (!eta || eta === 'Unknown') return null;
  const text = eta.trim();

  // Towbook ETAs come as "12 min", "1h 5m", "01:25" — try the common shapes.
  const minMatch = /^(\d+)\s*m(?:in)?s?$/i.exec(text);
  if (minMatch) return Number(minMatch[1]);
  
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  
  const hAndM = /^(\d+)\s*h(?:r)?s?\s*(\d+)?\s*m(?:in)?s?$/i.exec(text);
  if (hAndM) return Number(hAndM[1]) * 60 + Number(hAndM[2] ?? 0);

  // Extract from modifiers like "5:58 AM (15 hrs 16 mins late)" or "(2 hrs 5 mins remaining)"
  const modMatch = /\((?:(\d+)\s*h(?:r)?s?\s*)?(?:(\d+)\s*m(?:in)?s?\s*)?(late|remaining)\)/i.exec(text);
  if (modMatch) {
    const hrs = Number(modMatch[1] ?? 0);
    const mins = Number(modMatch[2] ?? 0);
    const total = hrs * 60 + mins;
    return modMatch[3].toLowerCase() === 'late' ? -total : total;
  }

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
