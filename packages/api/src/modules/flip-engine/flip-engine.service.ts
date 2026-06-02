import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  aaaBrandedBlocklist,
  alphaShops,
  tenants,
  type AlphaShopInsert,
  type AlphaShopRow,
} from '../../db/schema';
import {
  type BlocklistEntry,
  isAaaBrandedShop,
  type AaaBrandedCheckResult,
} from './aaa-branded.matcher';

// Mirror of `PendingFlipJob` from flip-orchestrator.service.ts. Keeping
// it duplicated avoids a circular import while still giving the
// orchestrator a typed return value to consume.
export interface PendingFlipJobLike {
  source: 'TOWBOOK' | 'AAA_PORTAL' | string;
  jobId: string;
  customerName: string;
  customerPhone: string;
  vehicle?: string | null;
  motorClub?: string | null;
  motorClubServiceCode?: string | null;
  reasonText?: string | null;
  vehicleNotes?: string | null;
  pickupAddress?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  destinationName?: string | null;
  destinationAddress?: string | null;
  destinationPhone?: string | null;
  companyName?: string | null;
}
import {
  selectNearestShop,
  type NearestShopResult,
  type ShopForSelection,
} from './nearest-shop.selector';

/**
 * Session 49b — Flip engine data layer.
 *
 * This service owns:
 *   - alpha_shops CRUD (per-tenant partner shop registry)
 *   - aaa_branded_blocklist CRUD (per-tenant AAA hard-block list)
 *   - tenants.flip_engine_enabled / flip_engine_config read+write
 *   - Helper queries: list active shops, run the AAA-branded check,
 *     pick the nearest shop of a given type to a pickup point
 *
 * It deliberately does NOT own:
 *   - The dispatch-board polling cron (that lives in 49c — depends on
 *     the destination classifier this service hands off to)
 *   - The flip script orchestration (49c — wires this service's helpers
 *     into Session 49's outbound voice orchestrator)
 *   - The management SMS notification stack (49d)
 *
 * 49b lays the data foundation. 49c+49d use it.
 */
@Injectable()
export class FlipEngineService {
  private readonly logger = new Logger(FlipEngineService.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  // ---------- shops ----------

  async listShops(tenantId: string): Promise<AlphaShopRow[]> {
    return this.db
      .select()
      .from(alphaShops)
      .where(eq(alphaShops.tenantId, tenantId))
      .orderBy(asc(alphaShops.name));
  }

  async listActiveShops(tenantId: string): Promise<AlphaShopRow[]> {
    return this.db
      .select()
      .from(alphaShops)
      .where(and(eq(alphaShops.tenantId, tenantId), eq(alphaShops.active, true)))
      .orderBy(asc(alphaShops.name));
  }

  async getShop(tenantId: string, id: string): Promise<AlphaShopRow | null> {
    const rows = await this.db
      .select()
      .from(alphaShops)
      .where(and(eq(alphaShops.tenantId, tenantId), eq(alphaShops.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createShop(input: Omit<AlphaShopInsert, 'id' | 'createdAt' | 'updatedAt'>): Promise<AlphaShopRow> {
    const [row] = await this.db.insert(alphaShops).values(input).returning();
    return row;
  }

  async updateShop(
    tenantId: string,
    id: string,
    patch: Partial<Omit<AlphaShopInsert, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<AlphaShopRow> {
    const existing = await this.getShop(tenantId, id);
    if (!existing) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'shop not found',
      });
    }
    const [row] = await this.db
      .update(alphaShops)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(alphaShops.tenantId, tenantId), eq(alphaShops.id, id)))
      .returning();
    return row;
  }

  async deleteShop(tenantId: string, id: string): Promise<void> {
    await this.db
      .delete(alphaShops)
      .where(and(eq(alphaShops.tenantId, tenantId), eq(alphaShops.id, id)));
  }

  /**
   * Pick the nearest shop of the requested type. Pickup coordinates are
   * the tow's pickup address. Body-shop selections are the soft-mention
   * fallback when the destination is auto-body and we want to mention
   * we own a body shop too.
   */
  async pickNearestShop(input: {
    tenantId: string;
    pickupLat: number;
    pickupLng: number;
    shopType: 'REPAIR' | 'BODY';
  }): Promise<NearestShopResult> {
    const rows = await this.listActiveShops(input.tenantId);
    const shops: ShopForSelection[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      shopType: r.shopType as 'REPAIR' | 'BODY',
      // numeric() comes back as string from drizzle-pg; coerce.
      lat: r.lat == null ? null : Number(r.lat),
      lng: r.lng == null ? null : Number(r.lng),
      active: r.active,
    }));
    return selectNearestShop({
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      shopType: input.shopType,
      shops,
    });
  }

  // ---------- AAA blocklist ----------

  async listBlocklist(tenantId: string) {
    return this.db
      .select()
      .from(aaaBrandedBlocklist)
      .where(eq(aaaBrandedBlocklist.tenantId, tenantId))
      .orderBy(asc(aaaBrandedBlocklist.label));
  }

  async createBlocklistEntry(input: {
    tenantId: string;
    matchType: 'NAME_PATTERN' | 'EXACT_NAME' | 'EXACT_ADDRESS' | 'PHONE';
    matchValue: string;
    label: string;
    notes?: string | null;
    addedBy?: string | null;
  }) {
    const [row] = await this.db
      .insert(aaaBrandedBlocklist)
      .values({
        tenantId: input.tenantId,
        matchType: input.matchType,
        matchValue: input.matchValue,
        label: input.label,
        notes: input.notes ?? null,
        addedBy: input.addedBy ?? null,
      })
      .returning();
    return row;
  }

  async setBlocklistEntryActive(tenantId: string, id: string, active: boolean) {
    const [row] = await this.db
      .update(aaaBrandedBlocklist)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(aaaBrandedBlocklist.tenantId, tenantId), eq(aaaBrandedBlocklist.id, id)))
      .returning();
    return row ?? null;
  }

  async deleteBlocklistEntry(tenantId: string, id: string) {
    await this.db
      .delete(aaaBrandedBlocklist)
      .where(and(eq(aaaBrandedBlocklist.tenantId, tenantId), eq(aaaBrandedBlocklist.id, id)));
  }

  /**
   * Hard guardrail check. Returns the matcher result. Callers MUST treat
   * `matched=true` as terminal — no flip, ever, regardless of any other
   * configuration. The check is non-blocking on errors: if the blocklist
   * fetch fails we still apply the regex against the destination name.
   */
  async checkAaaBranded(input: {
    tenantId: string;
    destinationName?: string | null;
    destinationAddress?: string | null;
    destinationPhone?: string | null;
  }): Promise<AaaBrandedCheckResult> {
    let blocklist: BlocklistEntry[] = [];
    try {
      const rows = await this.listBlocklist(input.tenantId);
      blocklist = rows
        .filter((r) => r.active)
        .map((r) => ({
          matchType: r.matchType as BlocklistEntry['matchType'],
          matchValue: r.matchValue,
          active: r.active,
        }));
    } catch (err) {
      this.logger.warn(
        `[flip-engine] blocklist fetch failed; running with regex-only check: ${(err as Error).message}`,
      );
    }
    return isAaaBrandedShop({
      destinationName: input.destinationName,
      destinationAddress: input.destinationAddress,
      destinationPhone: input.destinationPhone,
      blocklist,
    });
  }

  // ---------- tenant flip-engine config ----------

  async getConfig(tenantId: string) {
    const rows = await this.db
      .select({
        enabled: tenants.flipEngineEnabled,
        config: tenants.flipEngineConfig,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return rows[0] ?? { enabled: false, config: {} };
  }

  async updateConfig(
    tenantId: string,
    patch: { enabled?: boolean; config?: Record<string, unknown> },
  ) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.enabled !== undefined) set.flipEngineEnabled = patch.enabled;
    if (patch.config !== undefined) set.flipEngineConfig = patch.config as never;
    await this.db
      .update(tenants)
      .set(set as never)
      .where(eq(tenants.id, tenantId));
    return this.getConfig(tenantId);
  }

  /**
   * Returns the list of tenant ids with flip_engine_enabled = true. Used by
   * the 49c poller to drive the "scan dispatch boards" loop without
   * touching tenants that haven't opted in.
   */
  async listEnabledTenantIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.flipEngineEnabled, true), eq(tenants.isActive, true)));
    return rows.map((r) => r.id);
  }

  /**
   * Returns the list of "new since last tick" motor club jobs for a tenant
   * across all sources (Towbook + AAA today). Stub for 49c — the actual
   * wiring against the existing JobPoller / adapters is left as a 1-line
   * follow-up so this PR stays reviewable.
   *
   * Shape mirrors `PendingFlipJob` in flip-orchestrator.service.ts (kept
   * `unknown[]` here to avoid an import cycle; the orchestrator narrows
   * the type at the call site).
   */
  async fetchPendingFlipJobs(tenantId: string): Promise<PendingFlipJobLike[]> {
    // Read-only feed of jobs the dispatch layer has marked `new` for this
    // tenant. We intentionally do NOT mutate unified_jobs.status here — that
    // column is the shared dispatch lifecycle. Per-tick dedupe is handled by
    // the orchestrator's in-memory `seen` set.
    const res = (await this.db.execute(sql`
      SELECT id, source, source_job_id, caller_phone, caller_name,
             vehicle_year, vehicle_make, vehicle_model, vehicle_color,
             pickup_address, pickup_lat, pickup_lng, dropoff_address,
             service_type
      FROM unified_jobs
      WHERE tenant_id = ${tenantId} 
        AND status IN ('new', 'assigned', 'en_route')
        AND created_at >= NOW() - INTERVAL '15 minutes'
      ORDER BY created_at ASC
      LIMIT 50
    `)) as unknown;
    const rows: Array<Record<string, unknown>> = Array.isArray(res)
      ? (res as Array<Record<string, unknown>>)
      : ((res as { rows?: Array<Record<string, unknown>> }).rows ?? []);
    return rows
      .filter((r) => !!r.caller_phone)
      .map((r) => ({
        source: String(r.source),
        jobId: String(r.source_job_id ?? r.id),
        customerName: (r.caller_name as string) ?? '',
        customerPhone: String(r.caller_phone),
        vehicle:
          [r.vehicle_year, r.vehicle_color, r.vehicle_make, r.vehicle_model]
            .filter(Boolean)
            .join(' ') || null,
        reasonText: (r.service_type as string) ?? null,
        pickupAddress: (r.pickup_address as string) ?? null,
        pickupLat: r.pickup_lat != null ? Number(r.pickup_lat) : null,
        pickupLng: r.pickup_lng != null ? Number(r.pickup_lng) : null,
        destinationName: null,
        destinationAddress: (r.dropoff_address as string) ?? null,
        destinationPhone: null,
        companyName: null,
        motorClub: null,
        motorClubServiceCode: null,
        vehicleNotes: null,
      }));
  }

  /**
   * Best-effort coordinate lookup for a shop name OR address. Used when the
   * legacy seed has no lat/lng and the operator hasn't backfilled. Returns
   * the shop with whatever lat/lng exists; null when the shop can't be
   * resolved. (Geocoding lookup against Google Places lives in 49c so we
   * don't introduce a Google dependency here.)
   */
  async resolveShopCoords(tenantId: string, idOrName: string): Promise<{ lat: number; lng: number } | null> {
    const lowered = idOrName.toLowerCase();
    const rows = await this.listActiveShops(tenantId);
    const hit = rows.find(
      (r) => r.id === idOrName || r.name.toLowerCase() === lowered,
    );
    if (!hit || hit.lat == null || hit.lng == null) return null;
    return { lat: Number(hit.lat), lng: Number(hit.lng) };
  }
}
