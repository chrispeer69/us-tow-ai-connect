import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import {
  campaignCallLogs,
  campaignCallbackRequests,
  campaignLeads,
  campaignSuppressions,
  campaigns,
  type CampaignRow,
} from '../../db/schema';
import { normalizePhone, timezoneForAreaCode } from './phone-normalize';

/**
 * Session 78 — the outreach campaign list: ingest, suppression, status.
 *
 * Dialling lives next door in `campaign-dialer.service.ts`. This file owns the
 * list itself, and the invariant that matters most:
 *
 *   A NUMBER ON THE SUPPRESSION LIST IS NEVER IN THE DIALLING POOL.
 *
 * Enforced in two places on purpose — ingest refuses to add a suppressed
 * number, and the dialler re-checks at claim time. Belt and braces, because the
 * two paths run minutes apart and a mid-batch opt-out must take effect on the
 * batch that is already running.
 */

export interface IngestReport {
  received: number;
  added: number;
  duplicates: number;
  suppressed: number;
  invalid: Array<{ input: string; reason: string }>;
  mobiles: number;
}

export interface IngestRow {
  phone: string;
  company?: string | null;
  contactName?: string | null;
  state?: string | null;
  city?: string | null;
  externalRef?: string | null;
  /** Chris's standard export shape, 2026-08-22. */
  email?: string | null;
  website?: string | null;
  address?: string | null;
  zip?: string | null;
  rating?: string | number | null;
  reviewsCount?: number | null;
  grade?: string | null;
  siteScore?: number | null;
  aiScore?: number | null;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  // -------------------------------------------------------------------------
  // Campaign lookup
  // -------------------------------------------------------------------------

  async listCampaigns(tenantId: string): Promise<CampaignRow[]> {
    return this.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.tenantId, tenantId))
      .orderBy(asc(campaigns.name));
  }

  async getCampaign(tenantId: string, campaignId: string): Promise<CampaignRow> {
    const row = (
      await this.db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, tenantId)))
        .limit(1)
    )[0];
    if (!row) throw new NotFoundException('campaign not found');
    return row;
  }

  /** Resolve by slug, so the CLI can say `usta` instead of a uuid. */
  async getCampaignBySlug(tenantId: string, slug: string): Promise<CampaignRow> {
    const row = (
      await this.db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.slug, slug), eq(campaigns.tenantId, tenantId)))
        .limit(1)
    )[0];
    if (!row) throw new NotFoundException(`campaign '${slug}' not found`);
    return row;
  }

  async updateCampaign(
    tenantId: string,
    campaignId: string,
    patch: Partial<{
      status: string;
      concurrency: number;
      dailyCap: number;
      maxAttempts: number;
      callWindowStartHour: number;
      callWindowEndHour: number;
      callDays: number[];
      testMode: boolean;
      testOverrideNumber: string | null;
      outboundAgentId: string;
      outboundAgentVersion: string;
      inboundAgentId: string;
      inboundAgentVersion: string;
      fromNumber: string;
    }>,
  ): Promise<CampaignRow> {
    await this.getCampaign(tenantId, campaignId); // 404s if not ours

    if (patch.status && !['OFF', 'ACTIVE', 'PAUSED'].includes(patch.status)) {
      throw new BadRequestException('status must be OFF, ACTIVE or PAUSED');
    }
    if (patch.concurrency !== undefined && (patch.concurrency < 1 || patch.concurrency > 100)) {
      throw new BadRequestException('concurrency must be between 1 and 100');
    }
    if (
      patch.callWindowStartHour !== undefined &&
      patch.callWindowEndHour !== undefined &&
      patch.callWindowStartHour >= patch.callWindowEndHour
    ) {
      throw new BadRequestException('call window start must be before end');
    }

    const [row] = await this.db
      .update(campaigns)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, tenantId)))
      .returning();
    return row;
  }

  // -------------------------------------------------------------------------
  // Ingest
  // -------------------------------------------------------------------------

  /**
   * Parse a messy paste or CSV body into rows.
   *
   * Tolerates: a header line or none, comma or tab separated, a bare column of
   * phone numbers, blank lines, and quoted fields containing commas. The first
   * column that looks like a phone number wins, so `company,phone` and
   * `phone,company` both work without asking Chris which he pasted.
   */
  parseIngestText(text: string): IngestRow[] {
    const rows: IngestRow[] = [];
    const lines = text.split(/\r?\n/);

    // Detect and skip a header: a first line with no parseable phone in it.
    let start = 0;
    if (lines.length > 0) {
      const first = lines[0];
      const looksLikeHeader =
        /phone|number|company|business|name|state/i.test(first) &&
        !normalizePhone(splitCsvLine(first).find((c) => /\d{7}/.test(c)) ?? '').e164;
      if (looksLikeHeader) start = 1;
    }

    for (let i = start; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;

      const cells = splitCsvLine(line);
      // The phone is whichever cell normalizes. Scanning rather than trusting a
      // column index is what makes an arbitrary paste work.
      let phoneCell: string | null = null;
      let phoneIndex = -1;
      for (let c = 0; c < cells.length; c += 1) {
        if (normalizePhone(cells[c]).e164) {
          phoneCell = cells[c];
          phoneIndex = c;
          break;
        }
      }
      // Keep unparseable lines: the report should say WHY a row was dropped
      // rather than silently shrinking the count Chris pasted.
      if (!phoneCell) {
        rows.push({ phone: line });
        continue;
      }

      const others = cells.filter((_, idx) => idx !== phoneIndex).map((c) => c.trim());
      const company = others.find((c) => c && !/^[A-Z]{2}$/.test(c) && !/^\d+$/.test(c)) ?? null;
      const state = others.find((c) => /^[A-Z]{2}$/.test(c)) ?? null;

      rows.push({ phone: phoneCell, company, state });
    }
    return rows;
  }

  /**
   * Add rows to a campaign's queue.
   *
   * Dedupes against the queue AND the suppression list in one pass. Everything
   * rejected is reported with a reason — an ingest that says "added 412" when
   * 900 were pasted, and cannot say what happened to the other 488, is how a
   * list quietly rots.
   */
  async ingest(
    tenantId: string,
    campaignId: string,
    rows: IngestRow[],
    source = 'csv',
  ): Promise<IngestReport> {
    await this.getCampaign(tenantId, campaignId);

    const report: IngestReport = {
      received: rows.length,
      added: 0,
      duplicates: 0,
      suppressed: 0,
      invalid: [],
      mobiles: 0,
    };
    if (rows.length === 0) return report;

    // Normalize first, collecting rejects with their reason.
    const candidates = new Map<string, IngestRow & { areaCode: string; timezone: string | null }>();
    for (const row of rows) {
      const norm = normalizePhone(row.phone);
      if (!norm.e164) {
        report.invalid.push({ input: row.phone, reason: norm.reason ?? 'unparseable' });
        continue;
      }
      // Within-paste duplicates collapse silently; they are the same lead.
      if (candidates.has(norm.e164)) {
        report.duplicates += 1;
        continue;
      }
      candidates.set(norm.e164, {
        ...row,
        phone: norm.e164,
        areaCode: norm.areaCode!,
        timezone: norm.timezone,
      });
    }
    if (candidates.size === 0) return report;

    const phones = [...candidates.keys()];

    // Suppression check. Tenant-wide, not campaign-scoped: somebody who told US
    // Tow Alliance to stop calling should not be reachable by simply starting a
    // second campaign.
    const suppressed = await this.db
      .select({ phone: campaignSuppressions.phone })
      .from(campaignSuppressions)
      .where(
        and(eq(campaignSuppressions.tenantId, tenantId), inArray(campaignSuppressions.phone, phones)),
      );
    for (const s of suppressed) {
      candidates.delete(s.phone);
      report.suppressed += 1;
    }
    if (candidates.size === 0) return report;

    const remaining = [...candidates.values()];

    // Insert, letting the unique index absorb existing rows. onConflictDoNothing
    // + returning() means the DB tells us exactly which ones were new, with no
    // read-then-write race against a concurrent import.
    const inserted = await this.db
      .insert(campaignLeads)
      .values(
        remaining.map((r) => ({
          campaignId,
          tenantId,
          phone: r.phone,
          company: r.company ?? null,
          contactName: r.contactName ?? null,
          state: r.state ?? null,
          city: r.city ?? null,
          areaCode: r.areaCode,
          timezone: r.timezone,
          lineType: 'unknown',
          status: 'QUEUED',
          source,
          externalRef: r.externalRef ?? null,
          email: r.email ?? null,
          website: r.website ?? null,
          address: r.address ?? null,
          zip: r.zip ?? null,
          rating: r.rating != null && r.rating !== '' ? String(r.rating) : null,
          reviewsCount: r.reviewsCount ?? null,
          grade: r.grade ?? null,
          siteScore: r.siteScore ?? null,
          aiScore: r.aiScore ?? null,
        })),
      )
      .onConflictDoNothing({ target: [campaignLeads.campaignId, campaignLeads.phone] })
      .returning({ id: campaignLeads.id });

    report.added = inserted.length;
    report.duplicates += remaining.length - inserted.length;
    return report;
  }

  // -------------------------------------------------------------------------
  // Removal / suppression
  // -------------------------------------------------------------------------

  /**
   * Mark a profile claimed. This is how Chris removes a won lead.
   *
   * ACCEPTED rather than deleted: the row is the evidence that the campaign
   * produced the claim, and deleting it would make the campaign's own results
   * unmeasurable.
   */
  async markAccepted(tenantId: string, phoneInput: string): Promise<{ updated: number }> {
    const norm = normalizePhone(phoneInput);
    if (!norm.e164) throw new BadRequestException(`unparseable phone: ${phoneInput}`);
    const rows = await this.db
      .update(campaignLeads)
      .set({ status: 'ACCEPTED', updatedAt: new Date() })
      .where(and(eq(campaignLeads.tenantId, tenantId), eq(campaignLeads.phone, norm.e164)))
      .returning({ id: campaignLeads.id });
    return { updated: rows.length };
  }

  /**
   * Permanent do-not-call.
   *
   * Writes the suppression FIRST, then updates the lead. The order matters: if
   * the process dies between the two, we are left with a number that is
   * suppressed but whose lead row still says QUEUED — the dialler re-checks
   * suppression at claim time, so that state is safe. The reverse order would
   * leave a lead marked DNC with no suppression, and a re-import would put it
   * straight back into the pool.
   */
  async suppress(
    tenantId: string,
    phoneInput: string,
    reason = 'manual',
    quote?: string | null,
    sourceCallId?: string | null,
  ): Promise<{ phone: string; alreadySuppressed: boolean }> {
    const norm = normalizePhone(phoneInput);
    if (!norm.e164) throw new BadRequestException(`unparseable phone: ${phoneInput}`);

    const inserted = await this.db
      .insert(campaignSuppressions)
      .values({
        tenantId,
        phone: norm.e164,
        reason,
        quote: quote ?? null,
        sourceCallId: sourceCallId ?? null,
      })
      .onConflictDoNothing({ target: [campaignSuppressions.tenantId, campaignSuppressions.phone] })
      .returning({ id: campaignSuppressions.id });

    await this.db
      .update(campaignLeads)
      .set({ status: 'DNC', updatedAt: new Date() })
      .where(and(eq(campaignLeads.tenantId, tenantId), eq(campaignLeads.phone, norm.e164)));

    if (inserted.length > 0) {
      this.logger.warn(`[campaigns] suppressed ${norm.e164} (${reason})`);
    }
    return { phone: norm.e164, alreadySuppressed: inserted.length === 0 };
  }

  async isSuppressed(tenantId: string, phone: string): Promise<boolean> {
    const row = (
      await this.db
        .select({ id: campaignSuppressions.id })
        .from(campaignSuppressions)
        .where(and(eq(campaignSuppressions.tenantId, tenantId), eq(campaignSuppressions.phone, phone)))
        .limit(1)
    )[0];
    return Boolean(row);
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /** Today's counts plus queue depth — what `usta status` prints. */
  async status(tenantId: string, campaignId: string) {
    const campaign = await this.getCampaign(tenantId, campaignId);

    const leadCounts = await this.db
      .select({ status: campaignLeads.status, n: sql<number>`count(*)::int` })
      .from(campaignLeads)
      .where(eq(campaignLeads.campaignId, campaignId))
      .groupBy(campaignLeads.status);

    // Day boundary is the TENANT's day, not UTC. The flip call-review report
    // still uses a UTC boundary and reports 8pm-8pm as if it were a day; that
    // is a known defect there and is not repeated here.
    const startOfDay = sql`date_trunc('day', now() AT TIME ZONE ${campaign.callWindowStartHour !== null ? sql`'America/New_York'` : sql`'UTC'`})`;

    const todayCounts = await this.db
      .select({ disposition: campaignCallLogs.disposition, n: sql<number>`count(*)::int` })
      .from(campaignCallLogs)
      .where(
        and(
          eq(campaignCallLogs.campaignId, campaignId),
          gte(campaignCallLogs.createdAt, sql`${startOfDay} AT TIME ZONE 'America/New_York'`),
        ),
      )
      .groupBy(campaignCallLogs.disposition);

    const suppressedTotal = (
      await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(campaignSuppressions)
        .where(eq(campaignSuppressions.tenantId, tenantId))
    )[0]?.n ?? 0;

    const byStatus: Record<string, number> = {};
    for (const r of leadCounts) byStatus[r.status] = r.n;
    const byDisposition: Record<string, number> = {};
    for (const r of todayCounts) byDisposition[r.disposition ?? 'PENDING'] = r.n;

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        slug: campaign.slug,
        status: campaign.status,
        concurrency: campaign.concurrency,
        dailyCap: campaign.dailyCap,
        maxAttempts: campaign.maxAttempts,
        fromNumber: campaign.fromNumber,
        outboundAgentId: campaign.outboundAgentId,
        outboundAgentVersion: campaign.outboundAgentVersion,
        inboundAgentId: campaign.inboundAgentId,
        testMode: campaign.testMode,
        testOverrideNumber: campaign.testOverrideNumber,
        window: {
          startHour: campaign.callWindowStartHour,
          endHour: campaign.callWindowEndHour,
          days: campaign.callDays as number[],
        },
      },
      leads: byStatus,
      queueDepth: byStatus.QUEUED ?? 0,
      retryDepth: (byStatus.RETRY ?? 0) + (byStatus.VM ?? 0),
      today: byDisposition,
      dialedToday: Object.values(byDisposition).reduce((a, b) => a + b, 0),
      suppressedTotal,
    };
  }


  /**
   * What the campaign is actually doing — the numbers, not the call list.
   *
   * Session 79. On 2026-08-20 the first live batch ran across four agent
   * versions in ninety minutes, and answering "is it getting better?" meant a
   * human reading eighteen transcripts by hand. It was: median call length went
   * 9s -> 32s. Nothing in the product could have told Chris that.
   *
   * This is the same attribution discipline the flip dialler learned the hard
   * way — `script_version` is stamped on every row there precisely so two
   * populations cannot merge silently. Stamping it is only half the job; being
   * able to READ it is the other half.
   *
   * Everything is computed per AGENT VERSION, because that is the unit of
   * change. Anything that groups all calls together answers the wrong question.
   */
  async analytics(tenantId: string, campaignId: string) {
    await this.getCampaign(tenantId, campaignId);

    // ---- By agent version. The headline. ----------------------------------
    // `connected` deliberately excludes voicemail and sub-pitch-length calls:
    // a batch can look busy while reaching nobody, and a dialler that reports
    // its dial count as its reach is lying by omission.
    const byVersion = await this.db.execute(sql`
      SELECT
        COALESCE(agent_version, '?')                              AS version,
        COUNT(*)::int                                             AS calls,
        COALESCE(ROUND(AVG(duration_seconds))::int, 0)            AS avg_seconds,
        COALESCE(
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_seconds)::int, 0
        )                                                          AS median_seconds,
        COUNT(*) FILTER (WHERE disposition = 'PITCHED')::int       AS pitched,
        COUNT(*) FILTER (WHERE disposition = 'WARM')::int          AS warm,
        COUNT(*) FILTER (WHERE disposition = 'VM')::int            AS voicemail,
        COUNT(*) FILTER (WHERE disposition = 'DNC')::int           AS opted_out,
        COUNT(*) FILTER (WHERE disposition = 'GATEKEEPER')::int    AS gatekeeper,
        COUNT(*) FILTER (
          WHERE disposition IN ('PITCHED','WARM','NOT_INTERESTED','GATEKEEPER')
        )::int                                                     AS connected
      FROM campaign_call_logs
      WHERE campaign_id = ${campaignId}
        AND direction = 'OUTBOUND'
      GROUP BY 1
      ORDER BY 1
    `);

    // ---- The funnel. Where the losses actually are. ------------------------
    const funnel = await this.db.execute(sql`
      SELECT
        COUNT(*)::int                                              AS dialed,
        COUNT(*) FILTER (WHERE duration_seconds > 0)::int          AS answered,
        COUNT(*) FILTER (WHERE disposition = 'VM')::int            AS machine,
        COUNT(*) FILTER (
          WHERE disposition IN ('PITCHED','WARM','NOT_INTERESTED','GATEKEEPER')
        )::int                                                     AS human,
        COUNT(*) FILTER (WHERE disposition IN ('PITCHED','WARM'))::int AS heard_offer,
        COUNT(*) FILTER (WHERE disposition = 'WARM')::int          AS warm
      FROM campaign_call_logs
      WHERE campaign_id = ${campaignId}
        AND direction = 'OUTBOUND'
    `);

    // ---- Hour of day, in the TENANT's clock. ------------------------------
    // Which hours actually reach a person. A 9-5 window is an assumption, and
    // this is the only thing that can correct it.
    const byHour = await this.db.execute(sql`
      SELECT
        EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/New_York')::int AS hour,
        COUNT(*)::int                                              AS calls,
        COUNT(*) FILTER (
          WHERE disposition IN ('PITCHED','WARM','NOT_INTERESTED','GATEKEEPER')
        )::int                                                     AS reached_human
      FROM campaign_call_logs
      WHERE campaign_id = ${campaignId}
        AND direction = 'OUTBOUND'
      GROUP BY 1
      ORDER BY 1
    `);

    // ---- Needs a human. The only rows worth Chris's attention. -------------
    // WARM said they would claim it; GATEKEEPER gave a callback time. Both are
    // worthless sitting in a list nobody opens, which is what happens when the
    // page treats every disposition as equally interesting.
    const needsAttention = await this.db
      .select({
        id: campaignCallLogs.id,
        phone: campaignCallLogs.phone,
        company: campaignCallLogs.company,
        disposition: campaignCallLogs.disposition,
        callbackTime: campaignCallLogs.callbackTime,
        summary: campaignCallLogs.summary,
        durationSeconds: campaignCallLogs.durationSeconds,
        createdAt: campaignCallLogs.createdAt,
      })
      .from(campaignCallLogs)
      .where(
        and(
          eq(campaignCallLogs.campaignId, campaignId),
          inArray(campaignCallLogs.disposition, ['WARM', 'GATEKEEPER']),
        ),
      )
      .orderBy(desc(campaignCallLogs.createdAt))
      .limit(25);

    // ---- Objections, straight from the agent's own answers. ----------------
    const objections = await this.db.execute(sql`
      SELECT
        COALESCE(NULLIF(analysis -> 'custom_analysis_data' ->> 'objection_raised', ''), '(none)') AS objection,
        COUNT(*)::int AS n
      FROM campaign_call_logs
      WHERE campaign_id = ${campaignId}
        AND analysis IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `);

    const rows = (r: unknown) => ((r as { rows?: unknown[] })?.rows ?? r) as Record<string, unknown>[];

    return {
      byVersion: rows(byVersion),
      funnel: rows(funnel)[0] ?? {},
      byHour: rows(byHour),
      objections: rows(objections),
      needsAttention,
    };
  }

  /**
   * The mobile board: what needs Chris, and how the day is going.
   *
   * One request rather than five, because this is loaded on a phone, often on
   * bad signal, and the point is that it is glanceable.
   */
  async board(tenantId: string) {
    const open = await this.db
      .select()
      .from(campaignCallbackRequests)
      .where(
        and(
          eq(campaignCallbackRequests.tenantId, tenantId),
          eq(campaignCallbackRequests.status, 'OPEN'),
        ),
      )
      .orderBy(desc(campaignCallbackRequests.createdAt))
      .limit(50);

    // Callbacks — somebody rang us. Worth surfacing even without a request.
    const callbacks = await this.db
      .select({
        id: campaignCallLogs.id,
        phone: campaignCallLogs.phone,
        company: campaignCallLogs.company,
        durationSeconds: campaignCallLogs.durationSeconds,
        summary: campaignCallLogs.summary,
        recordingUrl: campaignCallLogs.recordingUrl,
        createdAt: campaignCallLogs.createdAt,
      })
      .from(campaignCallLogs)
      .where(
        and(eq(campaignCallLogs.tenantId, tenantId), eq(campaignCallLogs.direction, 'INBOUND')),
      )
      .orderBy(desc(campaignCallLogs.createdAt))
      .limit(20);

    const today = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE direction = 'OUTBOUND')::int AS dialed,
        COUNT(*) FILTER (WHERE disposition = 'PITCHED')::int AS pitched,
        COUNT(*) FILTER (WHERE disposition = 'VM')::int      AS voicemails,
        COUNT(*) FILTER (WHERE disposition = 'WARM')::int    AS warm,
        COUNT(*) FILTER (WHERE direction = 'INBOUND')::int   AS callbacks,
        COUNT(*) FILTER (WHERE disposition = 'DNC')::int     AS optouts
      FROM campaign_call_logs
      WHERE tenant_id = ${tenantId}
        AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/New_York')
                           AT TIME ZONE 'America/New_York'
    `);

    // Problems worth a red banner rather than a number.
    const problems = await this.db.execute(sql`
      SELECT 'stalled' AS kind, COUNT(*)::int AS n FROM campaign_call_logs
       WHERE tenant_id = ${tenantId} AND status IN ('PENDING','IN_PROGRESS')
         AND created_at < now() - interval '15 minutes'
      UNION ALL
      SELECT 'errors', COUNT(*)::int FROM campaign_call_logs
       WHERE tenant_id = ${tenantId} AND disposition = 'ERROR'
         AND created_at > now() - interval '24 hours'
    `);

    const rows = (r: unknown) => ((r as { rows?: unknown[] })?.rows ?? r) as Record<string, unknown>[];
    return {
      requests: open,
      callbacks,
      today: rows(today)[0] ?? {},
      problems: rows(problems).filter((p) => Number(p.n) > 0),
    };
  }

  /** Chris has dealt with a callback request. */
  async closeRequest(tenantId: string, id: string, note?: string) {
    const [row] = await this.db
      .update(campaignCallbackRequests)
      .set({ status: 'HANDLED', handledAt: new Date(), handledNote: note ?? null })
      .where(
        and(eq(campaignCallbackRequests.id, id), eq(campaignCallbackRequests.tenantId, tenantId)),
      )
      .returning();
    if (!row) throw new NotFoundException('request not found');
    return row;
  }

  /** Recent calls, newest first — the list Chris reads and listens to. */
  async listCalls(
    tenantId: string,
    opts: { campaignId?: string; disposition?: string; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const conditions = [eq(campaignCallLogs.tenantId, tenantId)];
    if (opts.campaignId) conditions.push(eq(campaignCallLogs.campaignId, opts.campaignId));
    if (opts.disposition) conditions.push(eq(campaignCallLogs.disposition, opts.disposition));

    return this.db
      .select()
      .from(campaignCallLogs)
      .where(and(...conditions))
      .orderBy(desc(campaignCallLogs.createdAt))
      .limit(limit)
      .offset(opts.offset ?? 0);
  }

  async getCall(tenantId: string, callId: string) {
    const row = (
      await this.db
        .select()
        .from(campaignCallLogs)
        .where(and(eq(campaignCallLogs.id, callId), eq(campaignCallLogs.tenantId, tenantId)))
        .limit(1)
    )[0];
    if (!row) throw new NotFoundException('call not found');
    return row;
  }
}

/**
 * Split one CSV line, honouring double quotes.
 *
 * Hand-rolled rather than pulled in as a dependency because the input is a
 * paste, not a spec-compliant CSV file — a strict parser throws on the ragged
 * rows that real lists are full of, and throwing loses the whole paste.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === ',' || ch === '\t' || ch === ';') && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim().replace(/^"|"$/g, ''));
}
