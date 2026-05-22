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
## SESSION 21: COMMAND CENTER (DISPATCH BOARD)

### Objective
Build the main Command Center page — the primary view users land on after login. It mirrors and exceeds TowPilot AI's Command Center, displaying all dispatch jobs in tabbed views (Waiting / Active / Completed / Cancelled) with real-time updates from the cached job data in Redis.

### Files to Create

**packages/api/src/modules/command-center/command-center.controller.ts**
```typescript
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CommandCenterService } from './command-center.service';

@Controller('v1/admin/command-center')
@UseGuards(JwtAuthGuard)
export class CommandCenterController {
  constructor(private readonly service: CommandCenterService) {}

  @Get('jobs')
  async getJobs(
    @Req() req: any,
    @Query('status') status: string,
    @Query('search') search: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.service.getJobsByStatus(req.tenantId, {
      status,
      search,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  }

  @Get('summary')
  async getSummary(@Req() req: any) {
    return this.service.getStatusSummary(req.tenantId);
  }
}
```

**packages/api/src/modules/command-center/command-center.service.ts**
```typescript
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ActiveJob } from '../adapters/adapter.interface';

@Injectable()
export class CommandCenterService {
  constructor(private readonly redis: Redis) {}

  async getJobsByStatus(tenantId: string, opts: { status: string; search: string; page: number; limit: number }) {
    const jobsJson = await this.redis.get(`jobs:towbook:${tenantId}`);
    if (!jobsJson) return { items: [], total: 0, totalPages: 0 };

    let jobs: ActiveJob[] = JSON.parse(jobsJson);

    // Filter by status tab
    if (opts.status && opts.status !== 'ALL') {
      const statusMap: Record<string, string[]> = {
        WAITING: ['Waiting'],
        ACTIVE: ['Dispatched', 'Enroute', 'On Scene', 'Being Towed'],
        COMPLETED: ['Destination Arrival', 'Completed'],
        CANCELLED: ['Cancelled'],
      };
      const allowedStatuses = statusMap[opts.status] || [];
      jobs = jobs.filter((j) => allowedStatuses.includes(j.status));
    }

    // Search
    if (opts.search) {
      const q = opts.search.toLowerCase();
      jobs = jobs.filter((j) =>
        j.jobId.includes(q) ||
        j.customerName.toLowerCase().includes(q) ||
        j.customerPhone.includes(q) ||
        j.vehicle.toLowerCase().includes(q)
      );
    }

    const total = jobs.length;
    const totalPages = Math.ceil(total / opts.limit);
    const start = (opts.page - 1) * opts.limit;
    const items = jobs.slice(start, start + opts.limit);

    return { items, total, totalPages };
  }

  async getStatusSummary(tenantId: string) {
    const jobsJson = await this.redis.get(`jobs:towbook:${tenantId}`);
    if (!jobsJson) return { waiting: 0, active: 0, completed: 0, cancelled: 0 };

    const jobs: ActiveJob[] = JSON.parse(jobsJson);
    return {
      waiting: jobs.filter((j) => j.status === 'Waiting').length,
      active: jobs.filter((j) => ['Dispatched', 'Enroute', 'On Scene', 'Being Towed'].includes(j.status)).length,
      completed: jobs.filter((j) => ['Destination Arrival', 'Completed'].includes(j.status)).length,
      cancelled: jobs.filter((j) => j.status === 'Cancelled').length,
    };
  }
}
```

**packages/web/src/app/admin/command-center/page.tsx**
```typescript
'use client';
import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Search, MapPin, User, Truck } from 'lucide-react';

const STATUS_BADGES: Record<string, string> = {
  Waiting: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  Dispatched: 'bg-blue-500/15 text-blue-400 border-blue-500/40',
  Enroute: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/40',
  'On Scene': 'bg-violet-500/15 text-violet-400 border-violet-500/40',
  'Being Towed': 'bg-indigo-500/15 text-indigo-400 border-indigo-500/40',
  'Destination Arrival': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  Completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  Cancelled: 'bg-red-500/15 text-red-400 border-red-500/40',
};

export default function CommandCenterPage() {
  const [activeTab, setActiveTab] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [jobs, setJobs] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});

  useEffect(() => {
    fetchJobs();
    fetchSummary();
    const interval = setInterval(() => {
      fetchJobs();
      fetchSummary();
    }, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [activeTab, search]);

  const fetchJobs = async () => {
    const params = new URLSearchParams({ status: activeTab, search });
    const res = await fetch(`/api/v1/admin/command-center/jobs?${params}`);
    const data = await res.json();
    setJobs(data.items);
  };

  const fetchSummary = async () => {
    const res = await fetch('/api/v1/admin/command-center/summary');
    const data = await res.json();
    setSummary(data);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
        <p className="text-muted-foreground">Real-time view of all dispatch jobs.</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by job ID, customer, phone, vehicle"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="WAITING">
            Waiting <Badge className="ml-2">{summary.waiting || 0}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ACTIVE">
            Active <Badge className="ml-2">{summary.active || 0}</Badge>
          </TabsTrigger>
          <TabsTrigger value="COMPLETED">
            Completed <Badge className="ml-2">{summary.completed || 0}</Badge>
          </TabsTrigger>
          <TabsTrigger value="CANCELLED">
            Cancelled <Badge className="ml-2">{summary.cancelled || 0}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-3 mt-6">
          {jobs.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                No jobs found in this view.
              </CardContent>
            </Card>
          ) : (
            jobs.map((job) => (
              <Card key={job.jobId} className="hover:border-blue-500/40 transition-all">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground">#{job.jobId}</span>
                      <Badge className={`${STATUS_BADGES[job.status] || ''} border text-xs`}>
                        {job.status}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{job.eta}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{job.customerName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-muted-foreground" />
                      <span>{job.vehicle}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <span className="truncate">{job.destination}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Driver</div>
                      <div className="font-medium">{job.driverName || 'Unassigned'}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

### Acceptance Tests
- Loads instantly (under 500ms) since data comes from Redis cache
- Tab counts update in real-time (refresh every 30s)
- Search filters across job ID, customer, phone, vehicle
- Status badges color-coded correctly
- Auto-refreshes every 30 seconds without user action

---

## SESSION 22: DIGITAL DISPATCH (AI AUTO-ACCEPT ENGINE)

### Objective
Build the Digital Dispatch feature that automatically accepts or declines incoming motor club dispatch requests based on rules the user defines. This is TowPilot's premium "Digital Dispatch" feature — we're building it natively without paywalling it behind a demo call.

### Files to Create

**packages/api/src/db/schema.ts** — Add tables:
```typescript
export const dispatchRules = pgTable('dispatch_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ruleName: varchar('rule_name', { length: 255 }).notNull(),
  motorClubId: uuid('motor_club_id').references(() => accounts.id),
  serviceTypes: jsonb('service_types').notNull(), // ['Towing', 'Jump Start', etc.]
  vehicleClasses: jsonb('vehicle_classes').notNull(), // ['LIGHT', 'MEDIUM', etc.]
  serviceAreaRadius: integer('service_area_radius_miles').notNull().default(25),
  minPriceAccept: integer('min_price_accept_cents'),
  timeOfDayStart: varchar('time_of_day_start', { length: 5 }), // '07:00'
  timeOfDayEnd: varchar('time_of_day_end', { length: 5 }), // '23:00'
  daysOfWeek: jsonb('days_of_week').notNull(), // ['MON', 'TUE', etc.]
  action: varchar('action', { length: 20 }).notNull(), // ACCEPT, DECLINE, REVIEW
  isActive: boolean('is_active').notNull().default(true),
  isLearningMode: boolean('is_learning_mode').notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const dispatchDecisions = pgTable('dispatch_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  callRequestId: varchar('call_request_id', { length: 100 }).notNull(),
  requestDate: timestamp('request_date').notNull(),
  motorClubAccount: varchar('motor_club_account', { length: 255 }),
  serviceNeeded: varchar('service_needed', { length: 100 }),
  vehicle: varchar('vehicle', { length: 255 }),
  decisionAction: varchar('decision_action', { length: 20 }).notNull(),
  decisionReason: text('decision_reason'),
  matchedRuleId: uuid('matched_rule_id').references(() => dispatchRules.id),
  eta: varchar('eta', { length: 50 }),
  wasOverridden: boolean('was_overridden').notNull().default(false),
  isLearningOnly: boolean('is_learning_only').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**packages/api/src/modules/digital-dispatch/digital-dispatch.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { dispatchRules, dispatchDecisions } from '../../db/schema';

interface IncomingRequest {
  callRequestId: string;
  motorClub: string;
  serviceType: string;
  vehicleClass: string;
  pickupAddress: string;
  destinationAddress: string;
  proposedPrice: number;
  requestTime: Date;
}

@Injectable()
export class DigitalDispatchService {
  private readonly logger = new Logger(DigitalDispatchService.name);

  constructor(private readonly db: any) {}

  async evaluateRequest(tenantId: string, request: IncomingRequest): Promise<{
    action: 'ACCEPT' | 'DECLINE' | 'REVIEW';
    reason: string;
    matchedRuleId: string | null;
    isLearningOnly: boolean;
  }> {
    const rules = await this.db.query.dispatchRules.findMany({
      where: and(
        eq(dispatchRules.tenantId, tenantId),
        eq(dispatchRules.isActive, true)
      ),
      orderBy: [dispatchRules.priority],
    });

    for (const rule of rules) {
      if (this.requestMatchesRule(request, rule)) {
        // Log the decision
        await this.db.insert(dispatchDecisions).values({
          tenantId,
          callRequestId: request.callRequestId,
          requestDate: request.requestTime,
          motorClubAccount: request.motorClub,
          serviceNeeded: request.serviceType,
          vehicle: request.vehicleClass,
          decisionAction: rule.action,
          decisionReason: `Matched rule: ${rule.ruleName}`,
          matchedRuleId: rule.id,
          isLearningOnly: rule.isLearningMode,
        });

        return {
          action: rule.action,
          reason: `Matched rule: ${rule.ruleName}`,
          matchedRuleId: rule.id,
          isLearningOnly: rule.isLearningMode,
        };
      }
    }

    // No matching rule — default to REVIEW
    await this.db.insert(dispatchDecisions).values({
      tenantId,
      callRequestId: request.callRequestId,
      requestDate: request.requestTime,
      motorClubAccount: request.motorClub,
      serviceNeeded: request.serviceType,
      vehicle: request.vehicleClass,
      decisionAction: 'REVIEW',
      decisionReason: 'No matching rule found',
      matchedRuleId: null,
      isLearningOnly: true,
    });

    return {
      action: 'REVIEW',
      reason: 'No matching rule found',
      matchedRuleId: null,
      isLearningOnly: true,
    };
  }

  private requestMatchesRule(request: IncomingRequest, rule: any): boolean {
    // Service type match
    if (!rule.serviceTypes.includes(request.serviceType)) return false;

    // Vehicle class match
    if (!rule.vehicleClasses.includes(request.vehicleClass)) return false;

    // Time of day match
    const hour = request.requestTime.getHours();
    const minute = request.requestTime.getMinutes();
    const currentTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (rule.timeOfDayStart && currentTime < rule.timeOfDayStart) return false;
    if (rule.timeOfDayEnd && currentTime > rule.timeOfDayEnd) return false;

    // Day of week match
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const today = days[request.requestTime.getDay()];
    if (!rule.daysOfWeek.includes(today)) return false;

    // Price match
    if (rule.minPriceAccept && request.proposedPrice < rule.minPriceAccept) return false;

    return true;
  }
}
```

**packages/web/src/app/admin/digital-dispatch/page.tsx** — Two-tab UI:
- **Decisions:** Table of all evaluated requests with their decision (ACCEPT / DECLINE / REVIEW), matched rule, and a "Learning Mode" badge if `isLearningOnly`
- **Rules:** CRUD for dispatch rules with form fields for motor club, service types, vehicle classes, service area, min price, time of day, days of week, action, learning mode toggle

### Learning Mode Behavior
When a rule is in Learning Mode, the system logs the decision but does NOT actually accept or decline the dispatch in Towbook. The user sees what the AI would have done, can review the decisions, and once confident, toggles Learning Mode OFF to enable real auto-accept/decline.

### Acceptance Tests
- Rule evaluation matches in <100ms
- Decision log shows all evaluated requests with full audit trail
- Learning mode never actually accepts/declines in Towbook
- When Learning Mode is OFF, the adapter calls `acceptDispatch()` or `declineDispatch()` on Towbook

---

## EXTENDED BUILD ORDER

After completing Sessions 1-20, build in this order:
1. **Session 21:** Command Center (highest user-visible feature)
2. **Session 22:** Digital Dispatch (premium AI feature)

Total: 22 sessions to build a product that beats TowPilot AI feature-for-feature with the added moat of outbound calls, CONVINI integration, AAA portal, native zero-latency mode, and the US Tow Alliance ownership opportunity.
