import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
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
