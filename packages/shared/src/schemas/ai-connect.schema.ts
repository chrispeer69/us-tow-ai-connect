import { z } from 'zod';

// ============================================================
// REQUEST SCHEMAS (Thinkrr.ai -> US Tow AI-Connect)
// ============================================================

export const LookupEtaRequestSchema = z.object({
  caller_phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Must be E.164 format'),
  search_phone: z.string().min(7).max(15),
  thinkrr_call_id: z.string().min(1),
});

export const LogInteractionRequestSchema = z.object({
  thinkrr_call_id: z.string().min(1),
  caller_phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Must be E.164 format'),
  category: z.enum([
    'ETA_LOOKUP',
    'NEW_TOW_REQUEST',
    'TRANSFER_TO_HUMAN',
    'IMPOUND_INQUIRY',
    'PRICING_QUOTE',
    'COMPLAINT',
    'SPAM',
    'GENERAL_INQUIRY',
  ]),
  summary: z.string().optional(),
  outcome: z.string().min(1),
  duration_seconds: z.number().int().min(0),
});

// ============================================================
// RESPONSE SCHEMAS (US Tow AI-Connect -> Thinkrr.ai)
// ============================================================

export const LookupEtaResponseSchema = z.object({
  status: z.enum(['success', 'error']),
  job_found: z.boolean(),
  data: z
    .object({
      eta: z.string(),
      driver_name: z.string(),
      job_status: z.string(),
      vehicle: z.string().optional(),
    })
    .nullable(),
  latency_ms: z.number().int(),
  message: z.string().optional(),
});

export const TransferRouteResponseSchema = z.object({
  status: z.enum(['success', 'error']),
  data: z.object({
    transfer_number: z.string(),
    label: z.string(),
  }),
});

// ============================================================
// TYPE EXPORTS
// ============================================================

export type LookupEtaRequest = z.infer<typeof LookupEtaRequestSchema>;
export type LogInteractionRequest = z.infer<typeof LogInteractionRequestSchema>;
export type LookupEtaResponse = z.infer<typeof LookupEtaResponseSchema>;
export type TransferRouteResponse = z.infer<typeof TransferRouteResponseSchema>;
