import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  flipAcceptRequests,
  tenants,
  type FlipAcceptRequestRow,
} from '../../db/schema';
import { TwilioSmsService } from '../outbound-sms/twilio-sms.service';
import { AdapterFactory } from '../adapters/adapter.factory';
import { parseFlipReply } from './flip-accept-parser';

export interface CreateFlipRequestInput {
  tenantId: string;
  sourceAdapter: string;
  sourceJobId: string;
  jobSummary: Record<string, unknown>;
  managerPhones?: string[] | null;
}

export interface ManualOverrideInput {
  decision: 'approve' | 'decline';
  notes?: string | null;
  reason?: string | null;
  actor?: string | null;
}

const EXPIRY_MS = 5 * 60 * 1000;

function blockersFilePath(): string {
  return resolve(process.cwd(), 'docs', 'BLOCKERS.md');
}

function logBlocker(line: string): void {
  try {
    const path = blockersFilePath();
    const dir = resolve(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString();
    appendFileSync(path, `\n- ${stamp} ${line}\n`, 'utf8');
  } catch {
    // Best-effort: don't crash a webhook because we can't write a file.
  }
}

@Injectable()
export class FlipAcceptService {
  private readonly logger = new Logger(FlipAcceptService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly sms: TwilioSmsService,
    private readonly adapters: AdapterFactory,
  ) {}

  async createRequest(input: CreateFlipRequestInput): Promise<FlipAcceptRequestRow> {
    const phones = input.managerPhones ?? (await this.resolveManagerPhones(input.tenantId));
    if (phones.length === 0) {
      this.logger.warn(
        `flip-accept request created without manager phones (tenant=${input.tenantId}) — SMS skipped`,
      );
    }

    const expiresAt = new Date(Date.now() + EXPIRY_MS);

    const inserted = await this.db
      .insert(flipAcceptRequests)
      .values({
        tenantId: input.tenantId,
        sourceAdapter: input.sourceAdapter,
        sourceJobId: input.sourceJobId,
        jobSummary: input.jobSummary as never,
        status: 'pending',
        expiresAt,
      })
      .returning();
    const row = inserted[0];

    const body = this.buildManagerSms(input.sourceAdapter, input.sourceJobId, input.jobSummary);
    for (const phone of phones) {
      await this.sms
        .sendSms({
          to: phone,
          body,
          tenantId: input.tenantId,
          related: { flipRequestId: row.id },
        })
        .catch((err) => {
          this.logger.warn(
            `Manager SMS failed phone=${phone} flip=${row.id}: ${(err as Error).message}`,
          );
        });
    }

    return row;
  }

  async listHistory(
    tenantId: string,
    query: { status?: string; limit?: number; offset?: number },
  ) {
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const filters = [eq(flipAcceptRequests.tenantId, tenantId)];
    if (query.status) filters.push(eq(flipAcceptRequests.status, query.status));
    const where = and(...filters);

    const items = await this.db
      .select()
      .from(flipAcceptRequests)
      .where(where)
      .orderBy(desc(flipAcceptRequests.requestedAt))
      .limit(limit)
      .offset(offset);

    const totalRow = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(flipAcceptRequests)
      .where(where);

    return {
      items,
      total: totalRow[0]?.count ?? 0,
      limit,
      offset,
    };
  }

  async manualOverride(
    tenantId: string,
    requestId: string,
    input: ManualOverrideInput,
  ): Promise<FlipAcceptRequestRow> {
    const row = await this.loadRow(tenantId, requestId);
    if (row.status !== 'pending') {
      throw new BadRequestException({
        status: 'error',
        code: 'NOT_PENDING',
        message: `Request is already ${row.status}; cannot override`,
      });
    }
    if (input.decision === 'approve') {
      return this.acceptRequest(row, {
        approverPhone: input.actor ?? 'manual_override',
        approverResponse: 'manual_override',
        notes: input.notes ?? null,
      });
    }
    return this.declineRequest(row, {
      approverPhone: input.actor ?? 'manual_override',
      approverResponse: 'manual_override',
      reason: input.reason ?? null,
    });
  }

  /**
   * Apply a parsed SMS reply to the matching pending request. Picks the
   * most recently created pending request from `approverPhone` if we can't
   * route via Twilio metadata; this covers the common case of a manager
   * replying directly to their phone's SMS thread.
   */
  async applyInboundReply(args: {
    fromPhone: string;
    rawBody: string;
  }): Promise<{
    matched: boolean;
    request?: FlipAcceptRequestRow;
    reply?: string;
  }> {
    const parsed = parseFlipReply(args.rawBody);
    if (parsed.kind === 'unknown') {
      return {
        matched: false,
        reply:
          'We did not understand that reply. Please reply YES to accept, NO REASON to decline, or YES NOTES <your notes>.',
      };
    }

    const pendingRows = await this.db
      .select()
      .from(flipAcceptRequests)
      .where(eq(flipAcceptRequests.status, 'pending'))
      .orderBy(desc(flipAcceptRequests.requestedAt))
      .limit(50);

    const candidate = await this.pickCandidate(pendingRows, args.fromPhone);
    if (!candidate) {
      return {
        matched: false,
        reply:
          'No pending flip-accept request was found for your number. The request may have already expired.',
      };
    }

    if (parsed.kind === 'approve') {
      const updated = await this.acceptRequest(candidate, {
        approverPhone: args.fromPhone,
        approverResponse: args.rawBody,
        notes: parsed.notes,
      });
      return {
        matched: true,
        request: updated,
        reply: `Got it. Job accepted for AAA #${updated.sourceJobId}.`,
      };
    }

    const updated = await this.declineRequest(candidate, {
      approverPhone: args.fromPhone,
      approverResponse: args.rawBody,
      reason: parsed.reason,
    });
    return {
      matched: true,
      request: updated,
      reply: `Got it. Job declined for AAA #${updated.sourceJobId}.`,
    };
  }

  async expirePending(): Promise<{ expired: number }> {
    const now = new Date();
    const expired = await this.db
      .update(flipAcceptRequests)
      .set({ status: 'expired', respondedAt: now })
      .where(
        and(
          eq(flipAcceptRequests.status, 'pending'),
          lt(flipAcceptRequests.expiresAt, now),
        ),
      )
      .returning({ id: flipAcceptRequests.id, sourceAdapter: flipAcceptRequests.sourceAdapter, sourceJobId: flipAcceptRequests.sourceJobId });
    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} flip-accept request(s)`);
      for (const row of expired) {
        this.logger.log(
          `flip-accept expired: id=${row.id} source=${row.sourceAdapter}/${row.sourceJobId}`,
        );
      }
    }
    return { expired: expired.length };
  }

  private buildManagerSms(
    sourceAdapter: string,
    sourceJobId: string,
    summary: Record<string, unknown>,
  ): string {
    const label = sourceAdapter.toUpperCase() === 'AAA_SALESFORCE' || sourceAdapter.toUpperCase() === 'AAA_PORTAL'
      ? 'AAA'
      : sourceAdapter.toUpperCase();
    const service = (summary.service_type as string | undefined) ?? 'tow';
    const pickup = (summary.pickup_address as string | undefined) ?? 'unknown location';
    const vehicle = (summary.vehicle as string | undefined) ?? 'vehicle TBD';
    const payout = summary.estimated_payout != null ? `$${summary.estimated_payout}` : 'unknown';
    const distance = summary.distance_miles != null ? `${summary.distance_miles} mi` : 'unknown';
    return [
      `NEW ${label} JOB - APPROVAL NEEDED`,
      `${service} at ${pickup}`,
      `Vehicle: ${vehicle}`,
      `Payout est: ${payout}`,
      `Distance: ${distance}`,
      ``,
      `REPLY:`,
      `YES - accept job`,
      `NO REASON - decline (then text reason)`,
      `YES NOTE - accept with notes (then text notes IN CAPS)`,
    ].join('\n');
  }

  private async resolveManagerPhones(tenantId: string): Promise<string[]> {
    const row = (
      await this.db
        .select({ managerPhones: tenants.managerPhones })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    const raw = row?.managerPhones;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.filter((p): p is string => typeof p === 'string' && p.length > 0);
    }
    return [];
  }

  private async pickCandidate(
    rows: FlipAcceptRequestRow[],
    fromPhone: string,
  ): Promise<FlipAcceptRequestRow | null> {
    if (rows.length === 0) return null;
    const tenantsForPhone = await this.tenantIdsForManagerPhone(fromPhone);
    if (tenantsForPhone.size > 0) {
      const match = rows.find((r) => tenantsForPhone.has(r.tenantId));
      if (match) return match;
    }
    return rows[0] ?? null;
  }

  private async tenantIdsForManagerPhone(fromPhone: string): Promise<Set<string>> {
    const matches = await this.db
      .select({ id: tenants.id, managerPhones: tenants.managerPhones })
      .from(tenants);
    const out = new Set<string>();
    for (const m of matches) {
      const phones = Array.isArray(m.managerPhones) ? (m.managerPhones as unknown[]) : [];
      if (phones.some((p) => typeof p === 'string' && p === fromPhone)) {
        out.add(m.id);
      }
    }
    return out;
  }

  private async loadRow(tenantId: string, requestId: string): Promise<FlipAcceptRequestRow> {
    const row = (
      await this.db
        .select()
        .from(flipAcceptRequests)
        .where(
          and(
            eq(flipAcceptRequests.tenantId, tenantId),
            eq(flipAcceptRequests.id, requestId),
          ),
        )
        .limit(1)
    )[0];
    if (!row) {
      throw new NotFoundException({ status: 'error', code: 'FLIP_REQUEST_NOT_FOUND' });
    }
    return row;
  }

  private async acceptRequest(
    row: FlipAcceptRequestRow,
    detail: { approverPhone: string; approverResponse: string; notes: string | null },
  ): Promise<FlipAcceptRequestRow> {
    const adapterKey = this.adapterKeyFor(row.sourceAdapter);
    let nextStatus: 'approved' | 'auto_dispatched' = 'approved';
    let autoDispatchSucceeded = false;

    if (adapterKey) {
      try {
        const adapter = this.adapters.getAdapter(adapterKey);
        if (typeof adapter.acceptJob === 'function') {
          const actionResult = await adapter.acceptJob(row.tenantId, row.sourceJobId);
          if (actionResult?.success) {
            nextStatus = 'auto_dispatched';
            autoDispatchSucceeded = true;
          } else {
            logBlocker(
              `flip-accept: adapter ${adapterKey} acceptJob did not confirm (source_job_id=${row.sourceJobId}): ${actionResult?.error ?? 'no result'}`,
            );
          }
        } else {
          logBlocker(
            `flip-accept: adapter ${adapterKey} has no acceptJob() method (source_job_id=${row.sourceJobId})`,
          );
        }
      } catch (err) {
        logBlocker(
          `flip-accept: adapter.acceptJob threw for ${adapterKey}/${row.sourceJobId}: ${(err as Error).message}`,
        );
      }
    } else {
      logBlocker(
        `flip-accept: no adapter mapping for source_adapter="${row.sourceAdapter}" (source_job_id=${row.sourceJobId})`,
      );
    }

    const updated = await this.db
      .update(flipAcceptRequests)
      .set({
        status: nextStatus,
        approverPhone: detail.approverPhone,
        approverResponse: detail.approverResponse,
        approvalNotes: detail.notes,
        respondedAt: new Date(),
      })
      .where(eq(flipAcceptRequests.id, row.id))
      .returning();

    if (!autoDispatchSucceeded) {
      this.logger.warn(
        `flip-accept approved but adapter dispatch did not succeed (id=${row.id}); status=${nextStatus}`,
      );
    }
    return updated[0];
  }

  private async declineRequest(
    row: FlipAcceptRequestRow,
    detail: { approverPhone: string; approverResponse: string; reason: string | null },
  ): Promise<FlipAcceptRequestRow> {
    const adapterKey = this.adapterKeyFor(row.sourceAdapter);
    if (adapterKey) {
      try {
        const adapter = this.adapters.getAdapter(adapterKey);
        if (typeof adapter.declineJob === 'function') {
          await adapter.declineJob(row.tenantId, row.sourceJobId, detail.reason ?? 'manager declined');
        }
      } catch (err) {
        logBlocker(
          `flip-accept: adapter.declineJob threw for ${adapterKey}/${row.sourceJobId}: ${(err as Error).message}`,
        );
      }
    }

    const updated = await this.db
      .update(flipAcceptRequests)
      .set({
        status: 'declined',
        approverPhone: detail.approverPhone,
        approverResponse: detail.approverResponse,
        approvalNotes: detail.reason,
        respondedAt: new Date(),
      })
      .where(eq(flipAcceptRequests.id, row.id))
      .returning();
    return updated[0];
  }

  private adapterKeyFor(sourceAdapter: string): string | null {
    const norm = sourceAdapter.toUpperCase();
    if (norm === 'AAA_SALESFORCE' || norm === 'AAA_PORTAL' || norm === 'AAA') {
      return 'AAA_PORTAL';
    }
    if (norm === 'TOWBOOK') return 'TOWBOOK';
    return null;
  }

  // Surface used by the digital-dispatch bridge to discover flip-eligible
  // pending decisions without importing private state. Returns null when not
  // applicable so the caller can skip cleanly.
  static readonly EXPIRY_MS = EXPIRY_MS;
  // Tiny no-op helper retained so unused-import elision keeps `isNull` if
  // we later need to filter on responded_at IS NULL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private static _isNull = isNull;
}
