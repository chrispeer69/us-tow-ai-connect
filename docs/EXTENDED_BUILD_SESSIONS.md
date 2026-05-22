# US Tow AI-Connect — Extended Build Sessions

These build sessions extend the core 10-session plan in `BUILD_SESSIONS.md` with the additional dashboard features observed in TowPilot AI's product. Build these AFTER the core 10 sessions are complete.

## SESSION 11: ADDITIONAL TOWING SOFTWARE ADAPTERS

### Objective
Add Playwright adapters for the remaining towing software platforms that TowPilot supports, so we can serve any customer regardless of their current dispatch software.

### Adapters to Build
1. **DispatchAnywhere Adapter** (`packages/api/src/modules/adapters/dispatch-anywhere/`)
2. **Omadi Adapter** (`packages/api/src/modules/adapters/omadi/`)
3. **TOPS Adapter** (`packages/api/src/modules/adapters/tops/`)
4. **InTow Adapter** (`packages/api/src/modules/adapters/intow/`)

### Pattern (Same for All)
Each adapter implements the `TowingSoftwareAdapter` interface from Session 1. Each adapter requires:
1. Login URL and credential field selectors
2. Dispatch board / job list URL after login
3. Selectors for extracting customer name, phone, vehicle, status, driver, ETA, destination
4. Session storage state caching to Redis (same TTL pattern as Towbook)

### Process
- User signs up for the customer's account on each platform (or has them provide login)
- Manually map the DOM selectors via browser inspection
- Document selectors in `docs/<platform>_DOM_MAP.md`
- Write the adapter following the `TowbookAdapter` template
- Add to `AdapterFactory` and the `SoftwareType` enum
- Test with real credentials

### Acceptance Tests (per adapter)
- Login succeeds with valid credentials
- Active jobs scrape returns array with customer phone normalized to digits
- Session persistence works across multiple scrape calls
- Test connection completes in under 30 seconds

---

## SESSION 12: FLEET MANAGEMENT — DRIVERS

### Objective
Build a Drivers management section in the admin dashboard so towing companies can manage their driver roster, PIN codes for driver app access, and status (on/off duty).

### Files to Create

**packages/api/src/db/schema.ts** — Add table:
```typescript
export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 20 }),
  email: varchar('email', { length: 255 }),
  pinHash: varchar('pin_hash', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('OFF_DUTY'),
  hireDate: timestamp('hire_date'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**packages/api/src/modules/admin/drivers.controller.ts** — Standard CRUD endpoints:
- `GET /v1/admin/drivers` — List all drivers
- `POST /v1/admin/drivers` — Create driver (auto-generates 4-digit PIN, returns once)
- `PATCH /v1/admin/drivers/:id` — Update driver
- `DELETE /v1/admin/drivers/:id` — Soft delete (set isActive = false)
- `POST /v1/admin/drivers/:id/regenerate-pin` — New PIN

**packages/web/src/app/admin/drivers/page.tsx** — Next.js page with:
- Table of drivers (Name, Phone, Status, Last Active, Actions)
- "Add Driver" modal
- "Generate PIN" action that displays once
- Status toggle (On Duty / Off Duty)

### Driver PIN Security
PINs are 4-digit codes hashed with bcrypt. They're displayed exactly once at creation/regeneration. Lost PINs require regeneration — no recovery.

---

## SESSION 13: FLEET MANAGEMENT — VEHICLES (TRUCKS)

### Objective
Build the Vehicles section for managing the towing company's truck fleet.

### Files to Create

**packages/api/src/db/schema.ts** — Add table:
```typescript
export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  unitNumber: varchar('unit_number', { length: 50 }).notNull(),
  vehicleType: varchar('vehicle_type', { length: 50 }).notNull(), // LIGHT, MEDIUM, HEAVY, FLATBED, WRECKER
  make: varchar('make', { length: 100 }),
  model: varchar('model', { length: 100 }),
  year: integer('year'),
  vin: varchar('vin', { length: 50 }),
  licensePlate: varchar('license_plate', { length: 20 }),
  capacityLbs: integer('capacity_lbs'),
  assignedDriverId: uuid('assigned_driver_id').references(() => drivers.id),
  isActive: boolean('is_active').notNull().default(true),
});
```

**packages/web/src/app/admin/vehicles/page.tsx** — Page with vehicle table, add/edit forms, driver assignment dropdown.

---

## SESSION 14: IMPOUND LOTS

### Objective
Build the Impound Lots section to track storage facilities owned by the towing company.

### Files to Create

**packages/api/src/db/schema.ts**:
```typescript
export const impoundLots = pgTable('impound_lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  lotName: varchar('lot_name', { length: 255 }).notNull(),
  address: text('address').notNull(),
  city: varchar('city', { length: 100 }).notNull(),
  state: varchar('state', { length: 2 }).notNull(),
  zipCode: varchar('zip_code', { length: 10 }).notNull(),
  capacity: integer('capacity'),
  dailyStorageRate: integer('daily_storage_rate_cents'), // in cents
  isActive: boolean('is_active').notNull().default(true),
});
```

**packages/web/src/app/admin/impound-lots/page.tsx** — CRUD UI for managing lot locations.

---

## SESSION 15: ACCOUNTS (CUSTOMERS / MOTOR CLUBS)

### Objective
Build the Accounts section to manage business customers (motor clubs, insurance companies, repeat commercial customers).

### Files to Create

**packages/api/src/db/schema.ts**:
```typescript
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  accountName: varchar('account_name', { length: 255 }).notNull(),
  accountType: varchar('account_type', { length: 50 }).notNull(), // MOTOR_CLUB, INSURANCE, COMMERCIAL, RETAIL
  contactName: varchar('contact_name', { length: 255 }),
  contactEmail: varchar('contact_email', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  billingAddress: text('billing_address'),
  paymentTerms: varchar('payment_terms', { length: 50 }), // NET_15, NET_30, COD
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
});
```

**packages/web/src/app/admin/accounts/page.tsx** — Account management with type filter (Motor Club, Insurance, etc.).

---

## SESSION 16: PRICING MODULE

### Objective
Build the Pricing configuration module so the AI agent can quote accurate prices on inbound calls.

### Files to Create

**packages/api/src/db/schema.ts**:
```typescript
export const pricingTiers = pgTable('pricing_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  serviceName: varchar('service_name', { length: 100 }).notNull(), // TOWING, JUMP_START, TIRE_CHANGE, FUEL_DELIVERY, LOCKOUT, WINCH_OUT
  vehicleClass: varchar('vehicle_class', { length: 50 }).notNull(), // LIGHT, MEDIUM, HEAVY, MOTORCYCLE
  baseRate: integer('base_rate_cents').notNull(),
  perMileRate: integer('per_mile_rate_cents').notNull(),
  hookupFee: integer('hookup_fee_cents'),
  storageRate: integer('storage_rate_cents'),
  isActive: boolean('is_active').notNull().default(true),
});
```

**packages/web/src/app/admin/pricing/page.tsx** — Pricing matrix editor with rows per service and columns per vehicle class.

---

## SESSION 17: DISPATCH CONFIGURATION

### Objective
Build the Dispatch Reasons and Dispatch Fields configuration so the AI categorizes inbound calls correctly.

### Files to Create

**packages/web/src/app/admin/dispatch-config/page.tsx** with two tabs:
- **Dispatch Reasons:** Customizable list of call categories (e.g., "Flat Tire", "Battery", "Lockout", "Accident", "No-Start"). Used by the AI to tag calls.
- **Dispatch Fields:** Custom fields to collect on every call (e.g., "Number of Passengers", "Pet On Board", "Special Instructions"). Configurable per service type.

---

## SESSION 18: MULTI-COMPANY SWITCHER

### Objective
Allow tenants who own multiple companies (like Roadside Towing AND Auto Lyft USA) to switch between them in the dashboard with one dropdown.

### Files to Create

**packages/api/src/db/schema.ts** — Add a `member_company_access` table linking members to multiple companies with roles.

**packages/web/src/components/CompanySwitcher.tsx** — Dropdown component in the sidebar header that switches the active company context. Updates all dashboard data on change.

---

## SESSION 19: MEMBERS & ROLES

### Objective
Multi-user team management with role-based permissions.

### Files to Create

**packages/api/src/db/schema.ts**:
```typescript
export const members = pgTable('members', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  phoneNumber: varchar('phone_number', { length: 20 }),
  role: varchar('role', { length: 50 }).notNull(), // OWNER, ADMIN, DISPATCHER, VIEWER
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  lastActiveAt: timestamp('last_active_at'),
  isActive: boolean('is_active').notNull().default(true),
});
```

**packages/web/src/app/admin/members/page.tsx** — Member list with invite flow, role assignment, last active timestamp.

### Role Permissions
| Role | Permissions |
|------|-------------|
| OWNER | Full access including billing |
| ADMIN | All settings except billing |
| DISPATCHER | Call logs, routing rules, dispatch view only |
| VIEWER | Read-only access to call logs |

---

## SESSION 20: CREDIT-BASED BILLING WITH STRIPE

### Objective
Implement the credit-based billing model with auto-top-up to compete directly with TowPilot's pricing model.

### Pricing Model
- Each plan includes a monthly credit allocation (e.g., Starter = 1,000 credits)
- 1 credit = 1 minute of AI call time
- Credits reset monthly on the billing date
- When credits run out, additional credits are charged at the per-minute overage rate
- Auto-top-up: When credits drop below a threshold (e.g., 10), automatically purchase 100 more credits at $30 (or whatever rate applies)

### Files to Create

**packages/api/src/db/schema.ts**:
```typescript
export const billingAccounts = pgTable('billing_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  planTier: varchar('plan_tier', { length: 50 }).notNull(), // STARTER, PROFESSIONAL, ENTERPRISE
  monthlyCredits: integer('monthly_credits').notNull(),
  currentCredits: integer('current_credits').notNull(),
  purchasedCredits: integer('purchased_credits').notNull().default(0),
  autoTopUpEnabled: boolean('auto_top_up_enabled').notNull().default(false),
  autoTopUpThreshold: integer('auto_top_up_threshold').notNull().default(10),
  autoTopUpAmount: integer('auto_top_up_amount').notNull().default(100),
  resetDate: timestamp('reset_date').notNull(),
});

export const creditTransactions = pgTable('credit_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 20 }).notNull(), // USAGE, PURCHASE, RESET, TOP_UP
  credits: integer('credits').notNull(),
  description: text('description'),
  callLogId: uuid('call_log_id').references(() => interactionLogs.id),
  stripeChargeId: varchar('stripe_charge_id', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**packages/api/src/modules/billing/billing.service.ts** — Handle Stripe subscriptions, credit deduction on each call, auto-top-up logic, monthly reset.

**packages/web/src/app/admin/billing/page.tsx** — Billing dashboard showing:
- Credits remaining (with progress bar)
- Monthly credit allocation breakdown
- Auto-top-up settings (toggle, threshold, amount)
- "Buy Credits" button
- Subscription management ("Open billing portal" via Stripe customer portal)

### Stripe Webhook Handler
**packages/api/src/modules/billing/stripe-webhook.controller.ts** — Listens for `customer.subscription.updated`, `invoice.paid`, `invoice.payment_failed` events from Stripe.

---

## BUILD ORDER

After completing the core 10 sessions in `BUILD_SESSIONS.md`, build the extended sessions in this order:

1. Session 11 (Additional Adapters) — Expand to more towing platforms
2. Session 19 (Members & Roles) — Required before delegation features
3. Session 18 (Multi-Company Switcher) — Required for multi-company tenants
4. Session 12 (Drivers) — Foundation for fleet management
5. Session 13 (Vehicles) — Pairs with drivers
6. Session 14 (Impound Lots) — Required for impound features
7. Session 15 (Accounts) — Required for billing customers correctly
8. Session 16 (Pricing) — Enables AI quoting
9. Session 17 (Dispatch Config) — Enables AI categorization
10. Session 20 (Billing) — Final piece to monetize

Total: 20 sessions to fully match and exceed TowPilot AI's feature set.
