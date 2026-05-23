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
// SMART ACTIONS (Session 23)
// Generic Thinkrr -> backend command pipe; payload schema is open so the
// agent can call new action types without a backend release.
// ============================================================

export const SmartActionRequestSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  action_type: z.enum([
    'CREATE_DISPATCH',
    'TRANSFER_TO_HUMAN',
    'REQUEST_CALLBACK',
    'SEND_SMS',
    'UPDATE_JOB',
    'OTHER',
  ]),
  call_id: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
});

export type SmartActionRequest = z.infer<typeof SmartActionRequestSchema>;

// ============================================================
// DISPATCH REQUEST (Session 23) — new tow request from the agent.
// ============================================================

export const DispatchRequestCreateSchema = z.object({
  caller_name: z.string().min(1),
  caller_phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Must be E.164 format'),
  vehicle: z
    .object({
      year: z.string().optional(),
      make: z.string().optional(),
      model: z.string().optional(),
      color: z.string().optional(),
    })
    .optional(),
  location: z.string().min(1),
  destination: z.string().optional(),
  reason: z.string().optional(),
  agent_notes: z.string().optional(),
});

export type DispatchRequestCreate = z.infer<typeof DispatchRequestCreateSchema>;

// ============================================================
// DRIVER PINGS (Session 23) — location reports from drivers in the field.
// Posted from a phone app, in-cab tablet, or any client that can hit HTTPS.
// `driver_phone` is the natural key; we don't require a uuid because this
// runs before the Command-Center drivers table is necessarily populated.
// ============================================================

// E.164 is +<countrycode><nationalnumber>, total length 8–16 characters,
// no spaces/dashes. We strip non-digits before validation so callers can
// post "+1 (740) 812-9489" or "17408129489".
export const DriverPingCreateSchema = z.object({
  driver_phone: z.string().min(7).max(20),
  driver_name: z.string().min(1).max(120).optional(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  heading: z.number().gte(0).lt(360).optional(),
  speed_mph: z.number().gte(0).lte(200).optional(),
  accuracy_m: z.number().gte(0).optional(),
  battery_pct: z.number().int().gte(0).lte(100).optional(),
  source: z.enum(['manual', 'phone_app', 'tablet', 'gps_tracker']).optional(),
  recorded_at: z.string().datetime().optional(),
});

export type DriverPingCreate = z.infer<typeof DriverPingCreateSchema>;

// ============================================================
// LIVE ETA (Session 23) — Thinkrr agent asks "how long until a truck
// reaches this caller?". Optionally takes a destination address (geocoded)
// or raw lat/lng. The response includes which driver was picked + basis.
// ============================================================

export const LiveEtaQuerySchema = z.object({
  lat: z.number().gte(-90).lte(90).optional(),
  lng: z.number().gte(-180).lte(180).optional(),
  destination: z.string().min(1).max(500).optional(),
});

export type LiveEtaQuery = z.infer<typeof LiveEtaQuerySchema>;

// ============================================================
// DRIVER JOBS (Session 25) — driver-side actions taken against an assigned
// unified_job. Phone-keyed lookup (no driver uuid) matches the rest of the
// driver surface. Status transitions are validated at the service layer
// against an allow-list so the API doesn't accept arbitrary strings.
// ============================================================

export const DriverJobStatusUpdateSchema = z.object({
  status: z.enum([
    'accept',
    'decline',
    'en_route',
    'on_scene',
    'in_tow',
    'completed',
    'cancel',
  ]),
  notes: z.string().max(1000).optional(),
  lat: z.number().gte(-90).lte(90).optional(),
  lng: z.number().gte(-180).lte(180).optional(),
});

export type DriverJobStatusUpdate = z.infer<typeof DriverJobStatusUpdateSchema>;

// ============================================================
// DRIVER PUSH SUBSCRIBE (Session 25) — driver PWA registers a web-push
// subscription. Shape matches the W3C PushSubscription serialization.
// ============================================================

export const DriverPushSubscribeSchema = z.object({
  driver_phone: z.string().min(7).max(20),
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  user_agent: z.string().max(500).optional(),
});

export type DriverPushSubscribe = z.infer<typeof DriverPushSubscribeSchema>;

// ============================================================
// TYPE EXPORTS
// ============================================================

export type LookupEtaRequest = z.infer<typeof LookupEtaRequestSchema>;
export type LogInteractionRequest = z.infer<typeof LogInteractionRequestSchema>;
export type LookupEtaResponse = z.infer<typeof LookupEtaResponseSchema>;
export type TransferRouteResponse = z.infer<typeof TransferRouteResponseSchema>;
