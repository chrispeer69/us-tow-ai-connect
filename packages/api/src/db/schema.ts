import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  numeric,
  date,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============ TENANTS ============
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  ownerId: uuid('owner_id'), // added in S66 for auth
  ownerEmail: varchar('owner_email', { length: 255 }).notNull(),
  timezone: varchar('timezone', { length: 50 }).notNull().default('America/New_York'),
  targetSoftwareType: varchar('target_software_type', { length: 50 }).notNull(),
  apiKeyHash: varchar('api_key_hash', { length: 255 }).notNull().unique(),
  apiKeyPrefix: varchar('api_key_prefix', { length: 16 }).notNull(),
  thinkrrAgentId: varchar('thinkrr_agent_id', { length: 100 }),
  assignedPhoneNumber: varchar('assigned_phone_number', { length: 20 }),
  isActive: boolean('is_active').notNull().default(true),
  // Session 24: caller-communication config
  managerPhones: jsonb('manager_phones').notNull().default([] as unknown as never),
  smsEnabled: boolean('sms_enabled').notNull().default(true),
  trackingUrlBase: text('tracking_url_base')
    .notNull()
    .default('https://ustowapi-production.up.railway.app/track'),
  // Session 26: SaaS hardening (digest + IP allow-list + audit retention)
  digestEmails: jsonb('digest_emails').notNull().default([] as unknown as never),
  digestFrequency: varchar('digest_frequency', { length: 10 }).notNull().default('daily'),
  // Session 73 — recipients for the daily call-review email. Separate from
  // digestEmails on purpose: different audience (script owner vs whole team).
  callReviewEmails: jsonb('call_review_emails').notNull().default([] as unknown as never),
  allowedAdminIps: jsonb('allowed_admin_ips').notNull().default([] as unknown as never),
  auditRetentionDays: integer('audit_retention_days').notNull().default(365),
  // Session 27: white-label branding + Thinkrr partner reconciliation.
  branding: jsonb('branding').notNull().default({} as unknown as never),
  partnerAccountId: varchar('partner_account_id', { length: 120 }),
  // Session 28: hard gate raised when a per-job (credit) tenant runs out of
  // credits. The job poller / command center checks this before ingesting.
  billingBlocked: boolean('billing_blocked').notNull().default(false),
  // Session 49: outbound voice orchestrator opt-in. Disabled by default; the
  // admin UI flips this when the tenant has signed the TCPA acknowledgement.
  // Config jsonb shape:
  //   {
  //     dispatch_cron_enabled?: boolean,
  //     dispatch_interval_seconds?: number,
  //     require_consent?: boolean,                       // default true
  //     enabled_purposes?: string[],                     // subset of the 6 purposes
  //     thinkrr_outbound_agent_id?: string,
  //     // Session 74 — per-tenant Retell. Each falls back to the matching env
  //     // var (RETELL_AGENT_ID / RETELL_AGENT_VERSION / RETELL_FROM_NUMBER)
  //     // when unset. agent id and version are a PAIR: a tenant on its own
  //     // agent never inherits the env version, because a Retell version
  //     // number only means something on the agent it belongs to.
  //     // See common/utils/retell-tenant-config.ts.
  //     retell_outbound_agent_id?: string,
  //     retell_agent_version?: string,                   // published version or tag
  //     retell_from_number?: string                      // E.164 caller-ID
  //   }
  outboundVoiceEnabled: boolean('outbound_voice_enabled').notNull().default(false),
  outboundVoiceConfig: jsonb('outbound_voice_config').notNull().default({} as unknown as never),
  // Session 49b: outbound flip engine opt-in. Disabled by default. The poller
  // skips tenants with this flag false at SQL level so an unconfigured tenant
  // costs zero CPU. Config jsonb shape:
  //   {
  //     poll_interval_seconds?: number,                  // default 60
  //     no_flip_confidence_threshold?: number,           // default 0.85
  //     no_flip_categories?: string[],                   // default ['single_tire_issue','jump_start','lockout','fuel_delivery','winch_out','accident_with_airbags']
  //     daily_report_hour_local?: number,                // 0-23, default 21
  //     batch_summary_size?: number,                     // default 10
  //     send_batch_summaries?: boolean,                  // default true
  //     send_daily_report?: boolean,                     // default true
  //     mention_rentals?: boolean,                        // default true
  //     max_shop_distance_miles?: number                 // default 100
  //   }
  flipEngineEnabled: boolean('flip_engine_enabled').notNull().default(false),
  flipEngineConfig: jsonb('flip_engine_config').notNull().default({} as unknown as never),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============ CREDENTIALS ============
// Deviation from BUILD_SESSIONS.md spec (see ASSUMPTIONS.md): the spec keeps a
// single 32-char IV/authTag pair, which is cryptographically incorrect with
// AES-GCM when encrypting two distinct plaintexts. We widen these columns to
// text and store `<u-iv>:<p-iv>` and `<u-tag>:<p-tag>` so that each ciphertext
// has its own IV and authTag, while keeping the table shape simple.
export const tenantCredentials = pgTable('tenant_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  softwareType: varchar('software_type', { length: 50 }).notNull().default('TOWBOOK'),
  usernameEncrypted: text('username_encrypted').notNull(),
  usernameHash: varchar('username_hash', { length: 255 }).unique(),
  passwordEncrypted: text('password_encrypted').notNull(),
  encryptionIv: text('encryption_iv').notNull(),
  authTag: text('auth_tag').notNull(),
  sessionStatus: varchar('session_status', { length: 20 }).notNull().default('PENDING'),
  lastLoginSuccess: timestamp('last_login_success', { withTimezone: true }),
  // S65 — failure observability so operators can read WHY a login failed
  // straight out of the database. Populated by SessionManagerService catch
  // block. `failureKind` is a coarse category for grouping; `failureReason`
  // is the exception .message string.
  failureReason: text('failure_reason'),
  failureKind: varchar('failure_kind', { length: 40 }),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unqTenantSoftware: uniqueIndex('unq_tenant_software_idx').on(t.tenantId, t.softwareType),
}));

// ============ ROUTING RULES ============
export const routingRules = pgTable('routing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  ruleName: varchar('rule_name', { length: 100 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 20 }).notNull(),
  isActiveNow: boolean('is_active_now').notNull().default(false),
  priorityOrder: integer('priority_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============ INTERACTION LOGS ============
export const interactionLogs = pgTable('interaction_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  thinkrrCallId: varchar('thinkrr_call_id', { length: 100 }).notNull(),
  callerPhone: varchar('caller_phone', { length: 20 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  summary: text('summary'),
  outcome: varchar('outcome', { length: 100 }).notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  latencyMs: integer('latency_ms'),
  interactionTime: timestamp('interaction_time', { withTimezone: true }).notNull().defaultNow(),
});

// ============ AI AGENT CONFIG ============
export const aiAgentConfigs = pgTable('ai_agent_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  greetingMessage: text('greeting_message').notNull().default('Thank you for calling.'),
  serviceToggles: jsonb('service_toggles').notNull().default({}),
  defaultEtaMins: integer('default_eta_mins').notNull().default(45),
  impoundEnabled: boolean('impound_enabled').notNull().default(false),
  knowledgePack: jsonb('knowledge_pack').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============ CALL INTERACTIONS (Thinkrr full payload, Session 23) ============
export const callInteractions = pgTable('call_interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  callId: varchar('call_id', { length: 120 }).notNull().unique(),
  callerPhone: varchar('caller_phone', { length: 20 }),
  calledNumber: varchar('called_number', { length: 20 }),
  durationSec: integer('duration_sec'),
  transcript: text('transcript'),
  summary: text('summary'),
  structuredData: jsonb('structured_data'),
  rawPayload: jsonb('raw_payload').notNull(),
  matchedJobId: varchar('matched_job_id', { length: 120 }),
  matchedJobSource: varchar('matched_job_source', { length: 20 }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============ SMART ACTIONS (Session 23) ============
export const smartActions = pgTable('smart_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  actionType: varchar('action_type', { length: 60 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  result: jsonb('result'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// ============ DISPATCH REQUESTS (Session 23) ============
export const dispatchRequests = pgTable('dispatch_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  callerName: varchar('caller_name', { length: 255 }).notNull(),
  callerPhone: varchar('caller_phone', { length: 20 }).notNull(),
  vehicleYear: varchar('vehicle_year', { length: 10 }),
  vehicleMake: varchar('vehicle_make', { length: 60 }),
  vehicleModel: varchar('vehicle_model', { length: 60 }),
  vehicleColor: varchar('vehicle_color', { length: 40 }),
  location: text('location').notNull(),
  destination: text('destination'),
  reason: text('reason'),
  agentNotes: text('agent_notes'),
  status: varchar('status', { length: 20 }).notNull().default('NEW'),
  dispatcherNotified: boolean('dispatcher_notified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============ TENANT BILLING ============
// One row per tenant. Tracks the current plan + period and a stripe customer
// pointer if/when the Stripe integration is wired up. The Billing screen
// reads usage by joining against interaction_logs.
export const tenantBilling = pgTable('tenant_billing', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  plan: varchar('plan', { length: 20 }).notNull().default('TRIAL'),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true })
    .notNull()
    .defaultNow(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 100 }),
  // Session 28: Stripe subscription pointer + per-job credit accounting.
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 100 }),
  creditBalance: integer('credit_balance').notNull().default(0),
  // per_job_billing = true → each new unified_job deducts one credit and the
  // tenant is gated on creditBalance instead of a monthly call cap.
  perJobBilling: boolean('per_job_billing').notNull().default(false),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============ BILLING EVENTS (Stripe webhook ledger) ============
// Append-only idempotency ledger for Stripe webhooks. stripe_event_id is
// unique; a redelivered event collides and is skipped, so no event is ever
// applied twice. tenant_id is nullable because some events arrive before the
// customer is mapped to a tenant.
export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    stripeEventId: varchar('stripe_event_id', { length: 255 }).notNull(),
    type: varchar('type', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stripeEventIdUniq: uniqueIndex('billing_events_stripe_event_id_uniq').on(t.stripeEventId),
    tenantIdx: index('billing_events_tenant_idx').on(t.tenantId),
  }),
);
export type BillingEventRow = typeof billingEvents.$inferSelect;

// ============ TENANT API KEYS ============
// Per-tenant API tokens issued from the admin dashboard. The plaintext key is
// returned exactly once at creation; only its bcrypt-style hash is stored.
export const tenantApiKeys = pgTable('tenant_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// ============ TENANT MEMBERS ============
export const tenantMembers = pgTable('tenant_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id'), // added in S66 for auth
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  // RBAC role (Session 45). UPPERCASE to match existing rows + the onboarding
  // writer. Allowed set enforced by a CHECK constraint in 0022_members_rbac.sql and 0038_support_role.sql:
  // OWNER | DISPATCHER | DRIVER | ACCOUNTING | VIEWER | SUPPORT.
  role: varchar('role', { length: 20 }).notNull().default('VIEWER'),
  status: varchar('status', { length: 20 }).notNull().default('INVITED'),
  invitedBy: varchar('invited_by', { length: 255 }),
  invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  inviteToken: varchar('invite_token', { length: 255 }),
  inviteTokenExpiresAt: timestamp('invite_token_expires_at', { withTimezone: true }),
});

// ============ ROLE PERMISSIONS (Session 45 — RBAC matrix) ============
// Composite (role, permission_key). OWNER is the single wildcard row
// ('OWNER', '*'). Keys are '<resource>.<action>' with action read|write.
// Seeded in 0022_members_rbac.sql; see docs/sessions/S45_RBAC_MATRIX.md.
export const rolePermissions = pgTable(
  'role_permissions',
  {
    role: varchar('role', { length: 20 }).notNull(),
    permissionKey: text('permission_key').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.role, t.permissionKey] }),
  }),
);
export type RolePermissionRow = typeof rolePermissions.$inferSelect;

// ============ OUTBOUND CALL LOGS (Session 9 — included for schema completeness) ============
export const outboundCallLogs = pgTable('outbound_call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  customerPhone: varchar('customer_phone', { length: 20 }).notNull(),
  motorClub: varchar('motor_club', { length: 100 }),
  vehicle: varchar('vehicle', { length: 255 }),
  issueType: varchar('issue_type', { length: 100 }),
  originalDestination: text('original_destination'),
  destinationBusinessName: varchar('destination_business_name', { length: 255 }),
  destinationType: varchar('destination_type', { length: 50 }),
  flipEligible: boolean('flip_eligible').notNull().default(false),
  noFlipReason: varchar('no_flip_reason', { length: 120 }),
  nearestOurShop: varchar('nearest_our_shop', { length: 255 }),
  offer1Result: varchar('offer_1_result', { length: 20 }).default('NOT_ATTEMPTED'),
  offer2Result: varchar('offer_2_result', { length: 20 }).default('NOT_ATTEMPTED'),
  offer3Result: varchar('offer_3_result', { length: 20 }).default('NOT_ATTEMPTED'),
  flipOutcome: varchar('flip_outcome', { length: 20 }).default('NOT_ATTEMPTED'),
  newDestination: text('new_destination'),
  conviniLinkSent: boolean('convini_link_sent').notNull().default(false),
  conviniSellType: varchar('convini_sell_type', { length: 10 }),
  towbookNotesUpdated: boolean('towbook_notes_updated').notNull().default(false),
  correctionsMade: text('corrections_made'),
  callDurationSeconds: integer('call_duration_seconds'),
  callRecordingUrl: text('call_recording_url'),
  transcript: text('transcript'),
  managementNotified: boolean('management_notified').notNull().default(false),
  callTime: timestamp('call_time', { withTimezone: true }).notNull().defaultNow(),
  // Session 73 — script attribution. Stamped by the flip orchestrator at render
  // time so a win can be tied to the exact script text that produced it.
  // Without these three, no experiment can be measured.
  scriptVersion: varchar('script_version', { length: 40 }),
  scenario: varchar('scenario', { length: 40 }),
  scriptVariant: varchar('script_variant', { length: 24 }).default('control'),
  // Session 77 — the dispatch intake answers (migration 0045).
  //
  // The script has asked all four of these on every call since 2026-08-15 and
  // every answer was thrown away: nothing extracted them and nothing stored
  // them, so the AI Notes composer's KEYS / ACCESS / CONDITION / VEHICLE lines
  // never had anything to render. We were paying the seconds and getting no
  // note — and on 2026-08-17 those seconds are what pushed the median call to
  // 191s and shoved the offer past Retell's 300s cap.
  //
  // Free text on purpose. A driver's note is prose: "on the curb in front of
  // the house, nose out, tight turn to get in" is the useful answer and it does
  // not survive an enum. 'unknown' is a legitimate value — the agent is told to
  // record an honest unknown rather than guess.
  keysAndPresence: text('keys_and_presence'),
  accessNotes: text('access_notes'),
  vehicleCondition: text('vehicle_condition'),
  vehicleDetails: text('vehicle_details'),
  issueDescription: text('issue_description'),
  // Distinct from newDestination, which only fills on an accepted flip. This
  // catches "the ticket says AutoZone, the customer says a storage facility" —
  // a real 2026-08-17 call, and exactly the kind of thing a driver needs before
  // they roll rather than after.
  confirmedDestination: text('confirmed_destination'),
});
export type OutboundCallLogRow = typeof outboundCallLogs.$inferSelect;

// ============ PUSH SUBSCRIPTIONS (Session 77 — buzz a locked phone) ============
// One row per DEVICE, not per user: the same person on a phone and a tablet is
// two subscriptions and should get two buzzes. `endpoint` is the identity and is
// unique, so re-subscribing the same browser updates in place rather than
// accumulating duplicates — otherwise one win becomes five buzzes on one handset.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    // Both keys are required to encrypt a payload for this device.
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    label: text('label'),
    userAgent: text('user_agent'),
    failureCount: integer('failure_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('push_subscriptions_tenant_idx').on(t.tenantId),
  }),
);
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

// ====== ATTENTION DISMISSALS (Session 77 — who called the customer back) ======
// A dismissal of the red "call did not complete" card is an EVENT, not a UI
// preference. It started in localStorage, which meant two admins both saw the
// same card and both rang the same customer, and nobody could answer whether an
// unreachable job had ever been followed up. One row per intervention: it clears
// the card on every device, and it is the audit trail.
export const attentionDismissals = pgTable(
  'attention_dismissals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Unique: dismissing twice is not two interventions, and two admins tapping
    // at the same moment must not produce two rows.
    outboundCallId: uuid('outbound_call_id').notNull().unique(),
    dismissedBy: text('dismissed_by'),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
  },
  (t) => ({
    tenantIdx: index('attention_dismissals_tenant_idx').on(t.tenantId, t.dismissedAt),
  }),
);
export type AttentionDismissalRow = typeof attentionDismissals.$inferSelect;

// ============ AI NOTE WRITES (Session 76 — dispatch write-back audit) ============
// One row per attempt to append an AI Notes block to a job in the customer's own
// dispatch system, successful or not, dry run or real. This writes into a live
// ticket in software we do not own, so "which call put this note on this job, and
// did we confirm it landed?" has to be answerable months later. It is also what
// makes the dry-run rollout reviewable — the composed block is stored, so a day
// of proposed writes can be read before any of them are real.
export const aiNoteWrites = pgTable(
  'ai_note_writes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    outboundCallId: uuid('outbound_call_id'),
    callLogId: uuid('call_log_id'),
    jobId: uuid('job_id'),
    sourceAdapter: varchar('source_adapter', { length: 32 }).notNull(),
    sourceJobId: varchar('source_job_id', { length: 120 }).notNull(),
    /** written | dry_run | already_present | skipped | failed */
    outcome: varchar('outcome', { length: 24 }).notNull(),
    detail: text('detail'),
    /** Only the block we composed — never the surrounding dispatcher text. */
    notesBlock: text('notes_block'),
    blockChars: integer('block_chars'),
    verified: boolean('verified').notNull().default(false),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    callIdx: index('ai_note_writes_call_idx').on(t.outboundCallId),
    tenantAttemptedIdx: index('ai_note_writes_tenant_attempted_idx').on(t.tenantId, t.attemptedAt),
    jobIdx: index('ai_note_writes_job_idx').on(t.tenantId, t.sourceAdapter, t.sourceJobId),
  }),
);
export type AiNoteWriteRow = typeof aiNoteWrites.$inferSelect;

// ============ CALL REVIEW (Session 73 — daily analyst loop) ============
// One row per tenant per day. The daily cron samples yesterday's calls, sends
// the transcripts to Claude for failure-mode classification, and stores the
// funnel snapshot next to the narrative so a recommendation can always be
// traced back to the numbers that motivated it.
export const callReviewRuns = pgTable(
  'call_review_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reviewDate: date('review_date').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('RUNNING'), // RUNNING | COMPLETE | FAILED | SKIPPED
    callsConsidered: integer('calls_considered').notNull().default(0),
    callsAnalyzed: integer('calls_analyzed').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    eligible: integer('eligible').notNull().default(0),
    neverPitched: integer('never_pitched').notNull().default(0),
    metrics: jsonb('metrics').notNull().default({} as unknown as never),
    summary: text('summary'),
    objections: jsonb('objections').notNull().default([] as unknown as never),
    defects: jsonb('defects').notNull().default([] as unknown as never),
    model: varchar('model', { length: 60 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantDateUniq: uniqueIndex('call_review_runs_tenant_date_uniq').on(
      t.tenantId,
      t.reviewDate,
    ),
  }),
);
export type CallReviewRunRow = typeof callReviewRuns.$inferSelect;

// Proposed script edits. The analyst only ever writes PROPOSED rows — nothing
// reaches a live call until a human approves it. See call-review.service.ts.
export const scriptRecommendations = pgTable(
  'script_recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => callReviewRuns.id, { onDelete: 'set null' }),
    scenario: varchar('scenario', { length: 40 }),
    /** Which part of the call it touches — e.g. `opening`, `offer_1`, `convini`. */
    target: varchar('target', { length: 60 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    problem: text('problem').notNull(),
    proposedText: text('proposed_text'),
    currentText: text('current_text'),
    rationale: text('rationale').notNull(),
    /** Verbatim customer quotes backing the claim, as [{callId, quote}]. */
    evidence: jsonb('evidence').notNull().default([] as unknown as never),
    // DEFECT items are things that are supposed to work and don't — they ship
    // without an A/B test. WORDING items must be tested before promotion.
    kind: varchar('kind', { length: 20 }).notNull().default('WORDING'), // WORDING | DEFECT | TARGETING | DATA_QUALITY
    confidence: varchar('confidence', { length: 10 }).notNull().default('MEDIUM'), // LOW | MEDIUM | HIGH
    expectedLift: varchar('expected_lift', { length: 60 }),
    status: varchar('status', { length: 20 }).notNull().default('PROPOSED'), // PROPOSED | APPROVED | REJECTED | LIVE | RETIRED
    reviewedBy: varchar('reviewed_by', { length: 255 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('script_recommendations_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
  }),
);
export type ScriptRecommendationRow = typeof scriptRecommendations.$inferSelect;

// ============ RELATIONS ============
export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  credentials: many(tenantCredentials),
  routingRules: many(routingRules),
  interactionLogs: many(interactionLogs),
  agentConfig: one(aiAgentConfigs, {
    fields: [tenants.id],
    references: [aiAgentConfigs.tenantId],
  }),
  outboundLogs: many(outboundCallLogs),
}));

export const tenantCredentialsRelations = relations(tenantCredentials, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantCredentials.tenantId],
    references: [tenants.id],
  }),
}));

export const routingRulesRelations = relations(routingRules, ({ one }) => ({
  tenant: one(tenants, { fields: [routingRules.tenantId], references: [tenants.id] }),
}));

export const outboundCallLogsRelations = relations(outboundCallLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [outboundCallLogs.tenantId], references: [tenants.id] }),
}));

export const interactionLogsRelations = relations(interactionLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [interactionLogs.tenantId], references: [tenants.id] }),
}));

export const aiAgentConfigsRelations = relations(aiAgentConfigs, ({ one }) => ({
  tenant: one(tenants, { fields: [aiAgentConfigs.tenantId], references: [tenants.id] }),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantMembers.tenantId], references: [tenants.id] }),
}));

export const tenantApiKeysRelations = relations(tenantApiKeys, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantApiKeys.tenantId], references: [tenants.id] }),
}));

export const tenantBillingRelations = relations(tenantBilling, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantBilling.tenantId], references: [tenants.id] }),
}));

export type TenantRow = typeof tenants.$inferSelect;
export type TenantCredentialsRow = typeof tenantCredentials.$inferSelect;
export type RoutingRuleRow = typeof routingRules.$inferSelect;
export type InteractionLogRow = typeof interactionLogs.$inferSelect;
export type AgentConfigRow = typeof aiAgentConfigs.$inferSelect;
export type TenantMemberRow = typeof tenantMembers.$inferSelect;
export type TenantApiKeyRow = typeof tenantApiKeys.$inferSelect;
export type TenantBillingRow = typeof tenantBilling.$inferSelect;

// ============ COMMAND CENTER: UNIFIED JOBS ============
// Canonical job record across every connected adapter. Upserted by the poller
// keyed on (tenant_id, source, source_job_id). Lat/lng cached after geocode.
export const unifiedJobs = pgTable(
  'unified_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 32 }).notNull(),
    sourceJobId: varchar('source_job_id', { length: 120 }).notNull(),
    sourcePayload: jsonb('source_payload').notNull().default({}),
    status: varchar('status', { length: 20 }).notNull().default('new'),
    callerPhone: varchar('caller_phone', { length: 20 }),
    callerName: varchar('caller_name', { length: 255 }),
    vehicleYear: varchar('vehicle_year', { length: 10 }),
    vehicleMake: varchar('vehicle_make', { length: 60 }),
    vehicleModel: varchar('vehicle_model', { length: 60 }),
    vehicleColor: varchar('vehicle_color', { length: 40 }),
    pickupAddress: text('pickup_address'),
    pickupLat: numeric('pickup_lat', { precision: 10, scale: 6 }),
    pickupLng: numeric('pickup_lng', { precision: 10, scale: 6 }),
    dropoffAddress: text('dropoff_address'),
    dropoffLat: numeric('dropoff_lat', { precision: 10, scale: 6 }),
    dropoffLng: numeric('dropoff_lng', { precision: 10, scale: 6 }),
    serviceType: varchar('service_type', { length: 60 }),
    priority: varchar('priority', { length: 10 }).notNull().default('normal'),
    assignedDriverId: uuid('assigned_driver_id'),
    assignedTruckId: uuid('assigned_truck_id'),
    etaMinutes: integer('eta_minutes'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    autoDecision: varchar('auto_decision', { length: 20 }),
    autoDecisionReason: text('auto_decision_reason'),
    autoDecidedAt: timestamp('auto_decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceUniq: uniqueIndex('unified_jobs_source_uniq').on(t.tenantId, t.source, t.sourceJobId),
    tenantStatusIdx: index('unified_jobs_tenant_status_idx').on(t.tenantId, t.status),
    tenantDriverIdx: index('unified_jobs_tenant_driver_idx').on(t.tenantId, t.assignedDriverId),
  }),
);

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  status: varchar('status', { length: 20 }).notNull().default('off_duty'),
  currentLat: numeric('current_lat', { precision: 10, scale: 6 }),
  currentLng: numeric('current_lng', { precision: 10, scale: 6 }),
  lastPingAt: timestamp('last_ping_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const trucks = pgTable('trucks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 60 }).notNull(),
  type: varchar('type', { length: 20 }).notNull().default('medium'),
  status: varchar('status', { length: 20 }).notNull().default('available'),
  assignedDriverId: uuid('assigned_driver_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobEvents = pgTable(
  'job_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => unifiedJobs.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    actor: varchar('actor', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ jobCreatedIdx: index('job_events_job_created_idx').on(t.jobId, t.createdAt) }),
);

export const unifiedJobsRelations = relations(unifiedJobs, ({ many, one }) => ({
  events: many(jobEvents),
  driver: one(drivers, {
    fields: [unifiedJobs.assignedDriverId],
    references: [drivers.id],
  }),
  truck: one(trucks, {
    fields: [unifiedJobs.assignedTruckId],
    references: [trucks.id],
  }),
}));

export const jobEventsRelations = relations(jobEvents, ({ one }) => ({
  job: one(unifiedJobs, { fields: [jobEvents.jobId], references: [unifiedJobs.id] }),
}));

export const driversRelations = relations(drivers, ({ many }) => ({
  jobs: many(unifiedJobs),
}));

export type UnifiedJobRow = typeof unifiedJobs.$inferSelect;
export type DriverRow = typeof drivers.$inferSelect;
export type TruckRow = typeof trucks.$inferSelect;
export type JobEventRow = typeof jobEvents.$inferSelect;

// ============ DIGITAL DISPATCH: RULES + DECISIONS ============
// Per-tenant auto-accept rules. `conditions` is a JSONB array of typed
// predicates (see DispatchRulesEngineService). First matching rule wins; on
// match, `action` is applied (accept/decline via adapter, or flag for human).
export const dispatchRules = pgTable(
  'dispatch_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    conditions: jsonb('conditions').notNull().default([]),
    action: varchar('action', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantPriorityIdx: index('dispatch_rules_tenant_priority_idx').on(t.tenantId, t.priority) }),
);

export const dispatchDecisions = pgTable(
  'dispatch_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => unifiedJobs.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id').references(() => dispatchRules.id, { onDelete: 'set null' }),
    decision: varchar('decision', { length: 20 }).notNull(),
    reason: text('reason'),
    evaluatedConditions: jsonb('evaluated_conditions').notNull().default([]),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: varchar('decided_by', { length: 10 }).notNull().default('ai'),
    // Evidence that the accept/decline click actually landed in the source
    // portal (toast text / status change), captured by the adapter. Null until
    // a physical action is attempted. Added in migration 0019.
    confirmationEvidence: text('confirmation_evidence'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => ({ jobIdx: index('dispatch_decisions_job_idx').on(t.jobId) }),
);

export const dispatchRulesRelations = relations(dispatchRules, ({ many }) => ({
  decisions: many(dispatchDecisions),
}));

export const dispatchDecisionsRelations = relations(dispatchDecisions, ({ one }) => ({
  rule: one(dispatchRules, { fields: [dispatchDecisions.ruleId], references: [dispatchRules.id] }),
  job: one(unifiedJobs, { fields: [dispatchDecisions.jobId], references: [unifiedJobs.id] }),
}));

export type DispatchRuleRow = typeof dispatchRules.$inferSelect;
export type DispatchDecisionRow = typeof dispatchDecisions.$inferSelect;
export type CallInteractionRow = typeof callInteractions.$inferSelect;
export type SmartActionRow = typeof smartActions.$inferSelect;
export type DispatchRequestRow = typeof dispatchRequests.$inferSelect;

// ============ DRIVER PINGS (Session 23) ============
// Standalone location reporting keyed by tenant + driver_phone (E.164). Kept
// distinct from the Command-Center `drivers` table so this module can run
// before that table is populated; correlation is done at read time by phone.
export const driverPings = pgTable(
  'driver_pings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    driverPhone: varchar('driver_phone', { length: 20 }).notNull(),
    driverName: varchar('driver_name', { length: 120 }),
    lat: numeric('lat', { precision: 10, scale: 6 }).notNull(),
    lng: numeric('lng', { precision: 10, scale: 6 }).notNull(),
    heading: numeric('heading', { precision: 5, scale: 2 }),
    speedMph: numeric('speed_mph', { precision: 5, scale: 2 }),
    accuracyM: numeric('accuracy_m', { precision: 8, scale: 2 }),
    batteryPct: integer('battery_pct'),
    source: varchar('source', { length: 20 }).notNull().default('manual'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantPhoneRecordedIdx: index('driver_pings_tenant_phone_recorded_idx').on(
      t.tenantId,
      t.driverPhone,
      t.recordedAt,
    ),
    tenantRecordedIdx: index('driver_pings_tenant_recorded_idx').on(t.tenantId, t.recordedAt),
  }),
);

export type DriverPingRow = typeof driverPings.$inferSelect;

// ============ TRACKING LINKS (Session 24) ============
// Public, token-addressed status pages for callers. The token is a short
// URL-safe slug; rows expire 24h after creation by default. `job_id` is left
// FK-less so this module can run before Command Center's unified_jobs is the
// source of truth — link by uuid at read time.
export const trackingLinks = pgTable(
  'tracking_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    callerPhone: text('caller_phone').notNull(),
    callerName: text('caller_name'),
    jobId: uuid('job_id'),
    pickupLat: numeric('pickup_lat', { precision: 10, scale: 7 }),
    pickupLng: numeric('pickup_lng', { precision: 10, scale: 7 }),
    status: text('status').notNull().default('created'),
    assignedDriverPhone: text('assigned_driver_phone'),
    assignedDriverName: text('assigned_driver_name'),
    lastEtaMinutes: integer('last_eta_minutes'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: index('tracking_links_token_idx').on(t.token),
    tenantStatusIdx: index('tracking_links_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export type TrackingLinkRow = typeof trackingLinks.$inferSelect;

// ============ SMS MESSAGES (Session 24) ============
// Audit log of every inbound/outbound SMS. `related_*` columns are soft links
// (no FKs) so deleting a tracking link or flip request doesn't blow away the
// SMS history. `twilio_sid` is the only handle for status-callback updates.
export const smsMessages = pgTable(
  'sms_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    toPhone: text('to_phone').notNull(),
    fromPhone: text('from_phone').notNull(),
    body: text('body').notNull(),
    twilioSid: text('twilio_sid'),
    status: text('status').notNull().default('queued'),
    relatedTrackingLinkId: uuid('related_tracking_link_id'),
    relatedFlipRequestId: uuid('related_flip_request_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('sms_messages_tenant_created_idx').on(t.tenantId, t.createdAt),
    twilioSidIdx: index('sms_messages_twilio_sid_idx').on(t.twilioSid),
  }),
);

export type SmsMessageRow = typeof smsMessages.$inferSelect;

// ============ FLIP ACCEPT REQUESTS (Session 24) ============
// SMS-driven manager approval workflow. When the dispatch rules engine
// flags an AAA job (action="flag"), a flip request is created and managers
// are SMS'd; they reply YES / NO / YES NOTES. Cron sweeps expired rows.
export const flipAcceptRequests = pgTable(
  'flip_accept_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceAdapter: text('source_adapter').notNull(),
    sourceJobId: text('source_job_id').notNull(),
    jobSummary: jsonb('job_summary').notNull().default({}),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('pending'),
    approverPhone: text('approver_phone'),
    approverResponse: text('approver_response'),
    approvalNotes: text('approval_notes'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    tenantStatusIdx: index('flip_accept_requests_tenant_status_idx').on(t.tenantId, t.status),
    sourceIdx: index('flip_accept_requests_source_idx').on(t.sourceAdapter, t.sourceJobId),
    statusExpiresIdx: index('flip_accept_requests_status_expires_idx').on(t.status, t.expiresAt),
  }),
);

export type FlipAcceptRequestRow = typeof flipAcceptRequests.$inferSelect;

// ============ DRIVER JOB EVENTS (Session 25) ============
// Audit log of every driver-side state transition. `job_id` deliberately has
// no FK to `unified_jobs` — see migration comment. Driver phone is normalized
// to E.164 by the service before insert.
export const driverJobEvents = pgTable(
  'driver_job_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    driverPhone: varchar('driver_phone', { length: 20 }).notNull(),
    jobId: uuid('job_id'),
    eventType: varchar('event_type', { length: 20 }).notNull(),
    notes: text('notes'),
    lat: numeric('lat', { precision: 10, scale: 6 }),
    lng: numeric('lng', { precision: 10, scale: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantDriverCreatedIdx: index('driver_job_events_tenant_driver_created_idx').on(
      t.tenantId,
      t.driverPhone,
      t.createdAt,
    ),
    tenantJobIdx: index('driver_job_events_tenant_job_idx').on(t.tenantId, t.jobId),
  }),
);

export type DriverJobEventRow = typeof driverJobEvents.$inferSelect;

// ============ CONVINI INCOMING JOBS (Session 25) ============
// Raw landing pad for inbound Convini SMS. parsed_payload is best-effort;
// raw_body is always preserved for re-processing once the wire format is
// confirmed by the integration owner.
export const convini_incoming_jobs = pgTable(
  'convini_incoming_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conviniId: varchar('convini_id', { length: 120 }),
    rawBody: text('raw_body').notNull(),
    parsedPayload: jsonb('parsed_payload').notNull().default({}),
    status: varchar('status', { length: 20 }).notNull().default('received'),
    errorMessage: text('error_message'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('convini_incoming_jobs_tenant_status_idx').on(t.tenantId, t.status),
    conviniIdIdx: index('convini_incoming_jobs_convini_id_idx').on(t.tenantId, t.conviniId),
  }),
);

export const conviniIncomingJobs = convini_incoming_jobs;
export type ConviniIncomingJobRow = typeof convini_incoming_jobs.$inferSelect;

// ============ DRIVER PUSH SUBSCRIPTIONS (Session 25) ============
// Web-push endpoints registered by the driver PWA. One driver can have many
// devices, so the unique constraint is (tenant_id, endpoint), not phone.
export const driverPushSubscriptions = pgTable(
  'driver_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    driverPhone: varchar('driver_phone', { length: 20 }).notNull(),
    endpoint: text('endpoint').notNull(),
    p256dhKey: text('p256dh_key').notNull(),
    authKey: text('auth_key').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // Session 29: last successful web-push delivery (null until first send).
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    endpointUniq: uniqueIndex('driver_push_subs_endpoint_uniq').on(t.tenantId, t.endpoint),
    tenantPhoneIdx: index('driver_push_subs_tenant_phone_idx').on(t.tenantId, t.driverPhone),
  }),
);

export type DriverPushSubscriptionRow = typeof driverPushSubscriptions.$inferSelect;

// ============ API KEY USAGE STATS (Session 26) ============
// Cold archive of the Redis-backed rate-limit counters, flushed every 5 min by
// RateLimitStatsAggregator. `identifier` is whatever the throttler keyed off
// (api key prefix, ip, etc.) — duplicated alongside (tenant_id, api_key_id) so
// row writes succeed even before we have resolved a tenant.
export const apiKeyUsageStats = pgTable(
  'api_key_usage_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    apiKeyId: uuid('api_key_id').references(() => tenantApiKeys.id, { onDelete: 'set null' }),
    identifier: text('identifier').notNull(),
    endpointGroup: varchar('endpoint_group', { length: 20 }).notNull(),
    requestCount: integer('request_count').notNull().default(0),
    throttledCount: integer('throttled_count').notNull().default(0),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    windowUniq: uniqueIndex('api_key_usage_stats_window_uniq').on(
      t.identifier,
      t.endpointGroup,
      t.windowStart,
    ),
    tenantWindowIdx: index('api_key_usage_stats_tenant_window_idx').on(
      t.tenantId,
      t.windowStart,
    ),
    windowIdx: index('api_key_usage_stats_window_idx').on(t.windowStart),
  }),
);

export type ApiKeyUsageStatsRow = typeof apiKeyUsageStats.$inferSelect;

// ============ AUDIT LOG (Session 26) ============
// One row per mutating action. The interceptor auto-captures
// POST/PUT/PATCH/DELETE against /v1/admin/* and /v1/ai-connect/*; explicit
// AuditLogService.record() calls add domain-specific before/after state.
// All jsonb payloads pass through sanitizeForAudit() at write time to redact
// `password`, `apiKey`, `token`, `secret`, etc.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    actorType: varchar('actor_type', { length: 20 }).notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
    actorIdx: index('audit_log_actor_idx').on(t.actorType, t.actorId),
    resourceIdx: index('audit_log_resource_idx').on(t.resourceType, t.resourceId),
    actionIdx: index('audit_log_action_idx').on(t.action, t.createdAt),
  }),
);

export type AuditLogRow = typeof auditLog.$inferSelect;

// ============ EMAIL MESSAGES (Session 26) ============
// SendGrid analogue of `sms_messages`. The digest scheduler is the primary
// writer today; future flows (member invites, alerts) will share this table.
export const emailMessages = pgTable(
  'email_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    toAddress: text('to_address').notNull(),
    fromAddress: text('from_address').notNull(),
    subject: text('subject').notNull(),
    htmlBody: text('html_body'),
    textBody: text('text_body'),
    sendgridMessageId: text('sendgrid_message_id'),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    relatedKind: varchar('related_kind', { length: 40 }),
    relatedId: text('related_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('email_messages_tenant_created_idx').on(t.tenantId, t.createdAt),
    statusIdx: index('email_messages_status_idx').on(t.status, t.createdAt),
  }),
);

export type EmailMessageRow = typeof emailMessages.$inferSelect;

// ============ ONBOARDING DRAFTS (Session 27, Section 1) ============
// Server-side state for the public 4-step signup wizard. The client
// holds the `id` returned by /v1/onboarding/start and threads it through
// every step + the final complete call. form_data accumulates all
// submitted step values.
export const onboardingDrafts = pgTable(
  'onboarding_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }),
    formData: jsonb('form_data').notNull().default({} as unknown as never),
    currentStep: integer('current_step').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    clientIp: varchar('client_ip', { length: 64 }),
    partnerAccountId: varchar('partner_account_id', { length: 120 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedTenantId: uuid('completed_tenant_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('onboarding_drafts_email_idx').on(t.email),
    statusIdx: index('onboarding_drafts_status_idx').on(t.status, t.expiresAt),
    partnerIdx: index('onboarding_drafts_partner_idx').on(t.partnerAccountId),
  }),
);

export type OnboardingDraftRow = typeof onboardingDrafts.$inferSelect;

// ============ TENANT KNOWLEDGE PACK v2 (Session 27, Section 3) ============
// Versioned per-tenant profile content with separate `draft` and
// `content` (published) blobs. Replaces the
// `ai_agent_configs.knowledge_pack` blob for v2 readers — the v1 endpoint
// still falls back to the legacy blob when no v2 row exists.
export const tenantKnowledgePack = pgTable(
  'tenant_knowledge_pack',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' })
      .unique(),
    content: jsonb('content').notNull().default({} as unknown as never),
    draft: jsonb('draft').notNull().default({} as unknown as never),
    version: integer('version').notNull().default(0),
    published: boolean('published').notNull().default(false),
    lastPublishedAt: timestamp('last_published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type TenantKnowledgePackRow = typeof tenantKnowledgePack.$inferSelect;

// ============ PLATFORM USERS (Session 27, Section 4) ============
// Platform-scoped identity. `platform_role` is orthogonal to
// `tenant_members.role`: a super_admin can also be a MEMBER of a
// specific tenant. Keyed by lowercased email.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }),
    googleId: varchar('google_id', { length: 255 }).unique(),
    name: varchar('name', { length: 255 }),
    platformRole: varchar('platform_role', { length: 20 }).notNull().default('tenant_user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type UserRow = typeof users.$inferSelect;

// ============ OUTBOUND CALLS (Session 49 — voice orchestrator) ============
// Audit trail of every outbound voice call placed via the Thinkrr outbound
// agent. Created in `queued` status by OutboundVoiceService.enqueueCall, then
// transitioned by the dispatcher cron + Thinkrr webhook callbacks. The
// thinkrr_call_id (UNIQUE) keys idempotent webhook updates.
export const outboundCalls = pgTable(
  'outbound_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 40 }).notNull(),
    relatedJobId: uuid('related_job_id'),
    toPhone: varchar('to_phone', { length: 20 }).notNull(),
    toName: varchar('to_name', { length: 120 }),
    scriptTemplate: varchar('script_template', { length: 60 }).notNull(),
    scriptVariables: jsonb('script_variables').notNull().default({} as unknown as never),
    thinkrrCallId: varchar('thinkrr_call_id', { length: 120 }),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    transcript: text('transcript'),
    recordingUrl: text('recording_url'),
    analysisData: jsonb('analysis_data').default(null),
    outcome: jsonb('outcome'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('outbound_calls_tenant_status_idx').on(t.tenantId, t.status),
    scheduledForIdx: index('outbound_calls_scheduled_for_idx').on(t.scheduledFor),
    thinkrrCallIdIdx: uniqueIndex('outbound_calls_thinkrr_call_id_uniq').on(t.thinkrrCallId),
    tenantCreatedIdx: index('outbound_calls_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);
export type OutboundCallRow = typeof outboundCalls.$inferSelect;
export type OutboundCallInsert = typeof outboundCalls.$inferInsert;

// ============ ALPHA SHOPS (Session 49b — partner shop registry) ============
// Per-tenant list of partner repair / body shops the flip engine can
// redirect calls to. Tenant-zero is seeded with all 9 Alpha Automotive
// shops in 0025_alpha_shops.sql; every other tenant starts empty.
export const alphaShops = pgTable(
  'alpha_shops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 180 }).notNull(),
    shopType: varchar('shop_type', { length: 20 }).notNull(), // REPAIR | BODY
    addressLine: varchar('address_line', { length: 255 }).notNull(),
    city: varchar('city', { length: 100 }).notNull(),
    state: varchar('state', { length: 2 }).notNull(),
    postalCode: varchar('postal_code', { length: 20 }).notNull(),
    lat: numeric('lat', { precision: 10, scale: 6 }),
    lng: numeric('lng', { precision: 10, scale: 6 }),
    phone: varchar('phone', { length: 20 }),
    website: text('website'),
    rentalPickupAvailable: boolean('rental_pickup_available').notNull().default(true),
    active: boolean('active').notNull().default(true),
    specialties: jsonb('specialties').notNull().default([] as unknown as never),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantActiveIdx: index('alpha_shops_tenant_active_idx').on(t.tenantId, t.active),
    tenantTypeIdx: index('alpha_shops_tenant_type_idx').on(t.tenantId, t.shopType),
  }),
);
export type AlphaShopRow = typeof alphaShops.$inferSelect;
export type AlphaShopInsert = typeof alphaShops.$inferInsert;

// ============ AAA-BRANDED BLOCKLIST (Session 49b) ============
// Hard guardrail backing the "never flip a AAA call going to a AAA-branded
// repair location" rule. The flip engine first applies the regex
// /\bAAA\b/i to the destination business name; this table is the
// operator-managed override layer for regional brand variants and
// specific addresses. Tenant-scoped.
export const aaaBrandedBlocklist = pgTable(
  'aaa_branded_blocklist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    matchType: varchar('match_type', { length: 20 }).notNull(), // STANDALONE_WORD | NAME_PATTERN | EXACT_NAME | EXACT_ADDRESS | PHONE
    matchValue: varchar('match_value', { length: 255 }).notNull(),
    label: varchar('label', { length: 180 }).notNull(),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    addedBy: varchar('added_by', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantActiveIdx: index('aaa_branded_blocklist_tenant_active_idx').on(t.tenantId, t.active),
    matchIdx: index('aaa_branded_blocklist_match_idx').on(t.matchType, t.matchValue),
  }),
);
export type AaaBrandedBlocklistRow = typeof aaaBrandedBlocklist.$inferSelect;
export type AaaBrandedBlocklistInsert = typeof aaaBrandedBlocklist.$inferInsert;

// ============ SUPPORT TICKETS ============
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subject: varchar('subject', { length: 255 }).notNull(),
    description: text('description').notNull(),
    status: varchar('status', { length: 50 }).notNull().default('open'), // open, in_progress, resolved, closed
    resolutionMessage: text('resolution_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('support_tickets_tenant_idx').on(t.tenantId),
    statusIdx: index('support_tickets_status_idx').on(t.status),
  }),
);

export type SupportTicketRow = typeof supportTickets.$inferSelect;
export type SupportTicketInsert = typeof supportTickets.$inferInsert;

export const supportTicketMessages = pgTable(
  'support_ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    senderType: varchar('sender_type', { length: 50 }).notNull(), // 'tenant', 'super_admin'
    senderEmail: varchar('sender_email', { length: 255 }).notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketIdx: index('support_ticket_messages_ticket_idx').on(t.ticketId),
    createdAtIdx: index('support_ticket_messages_created_at_idx').on(t.createdAt),
  }),
);

export type SupportTicketMessageRow = typeof supportTicketMessages.$inferSelect;
export type SupportTicketMessageInsert = typeof supportTicketMessages.$inferInsert;

// ============ SYSTEM CONFIGURATION ============

export const platformSettings = pgTable(
  'platform_settings',
  {
    key: varchar('key', { length: 100 }).primaryKey(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

// ============ PASSWORD RESET OTPS ============
export const passwordResetOtps = pgTable(
  'password_reset_otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    otp: varchar('otp', { length: 6 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index('password_reset_otps_user_idx').on(t.userId),
  }),
);

export type PasswordResetOtpRow = typeof passwordResetOtps.$inferSelect;
export type PasswordResetOtpInsert = typeof passwordResetOtps.$inferInsert;
