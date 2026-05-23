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
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============ TENANTS ============
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  ownerEmail: varchar('owner_email', { length: 255 }).notNull(),
  timezone: varchar('timezone', { length: 50 }).notNull().default('America/New_York'),
  targetSoftwareType: varchar('target_software_type', { length: 50 }).notNull(),
  apiKeyHash: varchar('api_key_hash', { length: 255 }).notNull().unique(),
  apiKeyPrefix: varchar('api_key_prefix', { length: 16 }).notNull(),
  thinkrrAgentId: varchar('thinkrr_agent_id', { length: 100 }),
  assignedPhoneNumber: varchar('assigned_phone_number', { length: 20 }),
  isActive: boolean('is_active').notNull().default(true),
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
  usernameEncrypted: text('username_encrypted').notNull(),
  passwordEncrypted: text('password_encrypted').notNull(),
  encryptionIv: text('encryption_iv').notNull(),
  authTag: text('auth_tag').notNull(),
  sessionStatus: varchar('session_status', { length: 20 }).notNull().default('PENDING'),
  lastLoginSuccess: timestamp('last_login_success', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  role: varchar('role', { length: 20 }).notNull().default('MEMBER'),
  status: varchar('status', { length: 20 }).notNull().default('INVITED'),
  invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
});

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
});

// ============ RELATIONS ============
export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  credentials: one(tenantCredentials, {
    fields: [tenants.id],
    references: [tenantCredentials.tenantId],
  }),
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
