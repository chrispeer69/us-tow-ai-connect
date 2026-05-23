import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { conviniIncomingJobs, type ConviniIncomingJobRow } from '../../db/schema';

export interface ParsedConviniPayload {
  convini_id: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string | null;
  vehicle: { year?: string; make?: string; model?: string; color?: string } | null;
  service_type: string | null;
  notes: string | null;
  raw_fields: Record<string, string>;
}

/**
 * Convini SMS handler.
 *
 * The actual Convini wire format is not yet documented (waiting on Chris
 * to provide the download URL + sample payloads). The parser implemented
 * here handles a permissive `CONVINI: KEY=value KEY=value …` form, plus
 * an optional `JOB={...}` JSON blob. Once the real format lands, only
 * `parseBody` needs to change — the storage + admin layers don't care.
 */
@Injectable()
export class ConviniService {
  private readonly logger = new Logger(ConviniService.name);
  private unifiedJobsAvailable: boolean | null = null;

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  /**
   * Permissive parser. Recognises:
   *   - `CONVINI: ID=<id> KEY=value …` — space-separated key/value pairs
   *   - `KEY="quoted value"` — values can be wrapped in double quotes
   *   - `JOB={…}` — embedded JSON blob is parsed and merged into raw_fields
   *
   * Returns null when the body has no recognisable Convini marker; in that
   * case the caller should ignore (probably an unrelated SMS).
   */
  static parseBody(body: string): ParsedConviniPayload | null {
    const trimmed = (body ?? '').trim();
    if (!/CONVINI[:#\s]/i.test(trimmed)) return null;

    const stripped = trimmed.replace(/^CONVINI[:#\s]*/i, '').trim();
    const raw: Record<string, string> = {};

    // JSON blob first (so we can strip it before kv parsing).
    let withoutJson = stripped;
    const jsonMatch = stripped.match(/JOB\s*=\s*(\{[\s\S]*?\})(?=\s+[A-Z_]+\s*=|\s*$)/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        for (const [k, v] of Object.entries(parsed)) {
          if (v == null) continue;
          raw[k.toLowerCase()] = typeof v === 'string' ? v : JSON.stringify(v);
        }
      } catch {
        /* ignore — raw_body still kept */
      }
      withoutJson = stripped.replace(jsonMatch[0], ' ').trim();
    }

    // Key/value tokens. Supports KEY=value, KEY="value with spaces".
    const kvRe = /([A-Z_][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = kvRe.exec(withoutJson)) !== null) {
      const key = m[1].toLowerCase();
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/\\"/g, '"');
      }
      raw[key] = val;
    }

    const pickLat = Number(raw.pickup_lat ?? raw.lat ?? '');
    const pickLng = Number(raw.pickup_lng ?? raw.lng ?? '');

    return {
      convini_id: raw.id ?? raw.convini_id ?? raw.job_id ?? null,
      caller_name: raw.caller_name ?? raw.name ?? null,
      caller_phone: raw.caller_phone ?? raw.phone ?? null,
      pickup_address: raw.pickup_address ?? raw.pickup ?? raw.address ?? null,
      pickup_lat: Number.isFinite(pickLat) ? pickLat : null,
      pickup_lng: Number.isFinite(pickLng) ? pickLng : null,
      dropoff_address: raw.dropoff_address ?? raw.dropoff ?? null,
      vehicle:
        raw.vehicle_year || raw.vehicle_make || raw.vehicle_model || raw.vehicle_color
          ? {
              year: raw.vehicle_year ?? undefined,
              make: raw.vehicle_make ?? undefined,
              model: raw.vehicle_model ?? undefined,
              color: raw.vehicle_color ?? undefined,
            }
          : null,
      service_type: raw.service ?? raw.service_type ?? null,
      notes: raw.notes ?? null,
      raw_fields: raw,
    };
  }

  /**
   * Persist an inbound SMS body. Always inserts a row; if parsing fails the
   * status is `failed` and the parse error is recorded. If parsing succeeds
   * but no Convini marker was present, returns null (caller skips).
   */
  async ingest(
    tenantId: string,
    body: string,
  ): Promise<{ id: string; status: 'received' | 'processed' | 'failed' } | null> {
    if (!body || !/CONVINI/i.test(body)) return null;
    const parsed = ConviniService.parseBody(body);
    if (!parsed) return null;
    const inserted = await this.db
      .insert(conviniIncomingJobs)
      .values({
        tenantId,
        conviniId: parsed.convini_id ?? null,
        rawBody: body,
        parsedPayload: parsed as unknown as Record<string, unknown>,
        status: 'received',
      })
      .returning({ id: conviniIncomingJobs.id });

    const id = inserted[0].id;
    const projected = await this.projectToUnifiedJobs(tenantId, id, parsed);
    const status: 'received' | 'processed' | 'failed' = projected ? 'processed' : 'received';
    if (projected) {
      await this.db
        .update(conviniIncomingJobs)
        .set({ status, processedAt: new Date() })
        .where(eq(conviniIncomingJobs.id, id));
    }
    return { id, status };
  }

  async list(tenantId: string, limit = 50): Promise<ConviniIncomingJobRow[]> {
    return this.db
      .select()
      .from(conviniIncomingJobs)
      .where(eq(conviniIncomingJobs.tenantId, tenantId))
      .orderBy(desc(conviniIncomingJobs.receivedAt))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  private async hasUnifiedJobs(): Promise<boolean> {
    if (this.unifiedJobsAvailable !== null) return this.unifiedJobsAvailable;
    try {
      await this.db.execute(sql`SELECT 1 FROM unified_jobs LIMIT 1`);
      this.unifiedJobsAvailable = true;
    } catch {
      this.unifiedJobsAvailable = false;
      this.appendBlocker(
        'Convini SMS received before unified_jobs table existed — payload stored in convini_incoming_jobs only',
      );
    }
    return this.unifiedJobsAvailable;
  }

  private appendBlocker(message: string): void {
    try {
      const blockersPath = path.resolve(process.cwd(), 'docs', 'BLOCKERS.md');
      if (!fs.existsSync(blockersPath)) return;
      const existing = fs.readFileSync(blockersPath, 'utf8');
      const tag = `[convini:${message.slice(0, 60)}]`;
      if (existing.includes(tag)) return;
      const stamp = new Date().toISOString();
      fs.appendFileSync(
        blockersPath,
        `\n\n### convini runtime (${stamp})\n\n- ${message}\n- Tag: ${tag}\n`,
      );
    } catch {
      /* best effort */
    }
  }

  private async projectToUnifiedJobs(
    tenantId: string,
    incomingId: string,
    parsed: ParsedConviniPayload,
  ): Promise<boolean> {
    if (!parsed.convini_id) return false;
    if (!(await this.hasUnifiedJobs())) return false;
    try {
      await this.db.execute(sql`
        INSERT INTO unified_jobs (
          tenant_id, source, source_job_id, source_payload, status,
          caller_phone, caller_name,
          vehicle_year, vehicle_make, vehicle_model, vehicle_color,
          pickup_address, pickup_lat, pickup_lng,
          dropoff_address, service_type, priority
        ) VALUES (
          ${tenantId}, 'convini', ${parsed.convini_id},
          ${JSON.stringify({ ...parsed.raw_fields, incoming_id: incomingId })}::jsonb,
          'new',
          ${parsed.caller_phone}, ${parsed.caller_name},
          ${parsed.vehicle?.year ?? null}, ${parsed.vehicle?.make ?? null},
          ${parsed.vehicle?.model ?? null}, ${parsed.vehicle?.color ?? null},
          ${parsed.pickup_address}, ${parsed.pickup_lat}, ${parsed.pickup_lng},
          ${parsed.dropoff_address}, ${parsed.service_type}, 'normal'
        )
        ON CONFLICT (tenant_id, source, source_job_id) DO NOTHING
      `);
      return true;
    } catch (err) {
      this.logger.warn(`convini -> unified_jobs projection failed: ${(err as Error).message}`);
      this.appendBlocker(
        `convini -> unified_jobs projection failed for ${parsed.convini_id}: ${(err as Error).message}`,
      );
      await this.db
        .update(conviniIncomingJobs)
        .set({
          status: 'failed',
          errorMessage: (err as Error).message,
          processedAt: new Date(),
        })
        .where(and(eq(conviniIncomingJobs.tenantId, tenantId), eq(conviniIncomingJobs.id, incomingId)));
      return false;
    }
  }
}
