import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { aiNoteWrites, outboundCallLogs, tenants, unifiedJobs } from '../../db/schema';
import { AdapterFactory } from '../adapters/adapter.factory';
import { composeAiNotes } from './ai-notes.composer';

/**
 * Session 76 — deliver the AI Notes block into the customer's dispatch system.
 *
 * THE PROBLEM THIS CLOSES. The script has been asking, on every call since
 * 2026-08-15, where the vehicle is parked and which way it faces, whether all
 * four tires are up, whether the customer will be there with the keys, and the
 * colour and drivetrain (asked open, because the club ticket is only about 50%
 * accurate on both). On 2026-08-14, 118 of 421 calls also captured a real
 * correction — "Corrected pickup address from 766 to 763 South Richardson Avenue
 * and clarified car is parked in the alley behind the address". Every one of
 * those answers died in our database. `towbook_notes_updated` was false on all
 * 421 calls, and was still false on all 393 calls of the following week. The
 * driver went to the address on the ticket, with the wrong equipment.
 *
 * HOW IT IS SAFE. Four properties, in the order they matter:
 *
 *  1. Off by default, and dry-run by default when on. The first real run should
 *     follow a day of reading `ai_note_writes` rows that were never written.
 *  2. It never composes the field value. `appendAiNotes` does, inside the
 *     adapter, which is what keeps append-only a property rather than a promise.
 *  3. Silence beats noise. `composeAiNotes` returns null for ~70% of calls and
 *     those are skipped entirely — a details box full of "nothing to report"
 *     teaches dispatchers to ignore the block, which would waste the whole
 *     integration.
 *  4. Every attempt is audited, including the ones that decline to write.
 *
 * CLOSED IN SESSION 77: the KEYS / ACCESS / CONDITION / VEHICLE lines now have
 * data. The Retell agent emits a post-call analysis field per line, the
 * extractor reads them, migration 0045 stores them, and this sweep selects
 * them. Before that the write-back could only carry the corrections and
 * destination lines — 24.7% of calls — because the other four were structurally
 * always null.
 *
 * The composer is still the gate, and still returns null for a call that
 * captured nothing. That is deliberate: a details box full of "nothing to
 * report" teaches dispatchers to skip the block, which would cost more than it
 * gains.
 */
@Injectable()
export class AiNotesWriterService {
  private readonly logger = new Logger(AiNotesWriterService.name);
  private running = false;

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly adapters: AdapterFactory,
  ) {}

  @Cron('45 */5 * * * *')
  async writePendingCron(): Promise<void> {
    if (!AI_NOTES_WRITEBACK_ENABLED) return;
    if (this.running) return; // one browser session at a time
    this.running = true;
    try {
      await this.writePending();
    } catch (err) {
      this.logger.warn(`[ai-notes] sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Find recent calls that captured something a driver needs, and write it.
   *
   * Returns a tally so the admin endpoint and the cron can report the same
   * numbers.
   */
  async writePending(
    opts: { limit?: number; dryRun?: boolean; tenantId?: string } = {},
  ): Promise<AiNotesSweepResult> {
    const dryRun = opts.dryRun ?? AI_NOTES_WRITEBACK_DRY_RUN;
    const limit = opts.limit ?? AI_NOTES_BATCH_SIZE;

    const candidates = await this.findCandidates(limit, opts.tenantId);
    const result: AiNotesSweepResult = {
      considered: candidates.length,
      composed: 0,
      written: 0,
      dryRun: 0,
      skipped: 0,
      failed: 0,
      dryRunMode: dryRun,
    };

    for (const c of candidates) {
      // Compose FIRST. Most calls produce nothing, and a null block means we
      // never open a browser for that job at all — the expensive part is the
      // Playwright session, so the cheap filter belongs in front of it.
      const block = composeAiNotes({
        correctionsMade: c.correctionsMade,
        newDestination: c.newDestination,
        flipOutcome: c.flipOutcome,
        callTimeIso: c.callTime ? new Date(c.callTime).toISOString() : null,
        keysAndPresence: c.keysAndPresence,
        accessNotes: c.accessNotes,
        vehicleCondition: c.vehicleCondition,
        vehicleDetails: c.vehicleDetails,
        issueDescription: c.issueDescription,
        confirmedDestination: c.confirmedDestination,
      });

      if (!block) {
        // Not an audit row: "this call had nothing to say" is the common case and
        // logging 70% of calls as skipped would bury the ones that matter.
        result.skipped += 1;
        continue;
      }
      result.composed += 1;

      const adapterKey = (c.source ?? '').toUpperCase();
      let adapter;
      try {
        adapter = this.adapters.getAdapter(adapterKey);
      } catch (err) {
        await this.audit(c, 'skipped', `unknown_adapter_${adapterKey}`, block, false);
        result.skipped += 1;
        continue;
      }
      if (typeof adapter.updateJobNotes !== 'function') {
        await this.audit(c, 'skipped', `adapter_${adapterKey}_has_no_updateJobNotes`, block, false);
        result.skipped += 1;
        continue;
      }

      try {
        const res = await adapter.updateJobNotes(c.tenantId, c.sourceJobId, block, {
          expectCustomerName: c.customerName,
          expectCustomerPhone: c.customerPhone,
          dryRun,
        });

        if (res.success && dryRun) {
          await this.audit(c, 'dry_run', res.confirmationEvidence ?? null, block, false);
          result.dryRun += 1;
        } else if (res.success) {
          const alreadyThere = res.confirmationEvidence === 'already_present';
          await this.audit(
            c,
            alreadyThere ? 'already_present' : 'written',
            res.confirmationEvidence ?? null,
            block,
            true,
          );
          // Only a verified real write may set the flag. The adapter only
          // reports success after re-reading the field from a fresh page load.
          await this.markLogWritten(c.callLogId);
          result.written += 1;
        } else {
          await this.audit(c, 'failed', res.error ?? 'no_result', block, false);
          result.failed += 1;
          this.logger.warn(
            `[ai-notes] job=${c.sourceJobId} write declined: ${res.error ?? 'no result'}`,
          );
        }
      } catch (err) {
        // The adapter contract says never throw, but a session expiry does.
        await this.audit(c, 'failed', `exception: ${(err as Error).message}`, block, false);
        result.failed += 1;
        this.logger.warn(
          `[ai-notes] job=${c.sourceJobId} threw: ${(err as Error).message}`,
        );
      }
    }

    if (result.composed > 0) {
      this.logger.log(
        `[ai-notes] ${dryRun ? 'DRY RUN' : 'LIVE'} considered=${result.considered} ` +
          `composed=${result.composed} written=${result.written} dry_run=${result.dryRun} ` +
          `skipped=${result.skipped} failed=${result.failed}`,
      );
    }
    return result;
  }

  /**
   * Recent calls whose notes have not been written yet.
   *
   * The join to unified_jobs is the awkward part and worth explaining:
   * `outbound_call_logs` carries no foreign key to a job, only a phone number, so
   * the job handle has to be recovered by matching the caller's phone within a
   * time window around the call. The window is what keeps it honest — an
   * unbounded phone match would happily attach today's note to a job the same
   * customer had last month. Digits are compared, not formatting, because the
   * two systems disagree about punctuation.
   */
  private async findCandidates(limit: number, tenantId?: string): Promise<NoteCandidate[]> {
    const rows = await this.db
      .select({
        tenantId: outboundCallLogs.tenantId,
        callLogId: outboundCallLogs.id,
        customerName: outboundCallLogs.customerName,
        customerPhone: outboundCallLogs.customerPhone,
        correctionsMade: outboundCallLogs.correctionsMade,
        newDestination: outboundCallLogs.newDestination,
        flipOutcome: outboundCallLogs.flipOutcome,
        callTime: outboundCallLogs.callTime,
        // Session 77 — the intake answers are stored now (migration 0045), so
        // these come out of the row instead of being hardcoded null.
        keysAndPresence: outboundCallLogs.keysAndPresence,
        accessNotes: outboundCallLogs.accessNotes,
        vehicleCondition: outboundCallLogs.vehicleCondition,
        vehicleDetails: outboundCallLogs.vehicleDetails,
        issueDescription: outboundCallLogs.issueDescription,
        confirmedDestination: outboundCallLogs.confirmedDestination,
        jobId: unifiedJobs.id,
        source: unifiedJobs.source,
        sourceJobId: unifiedJobs.sourceJobId,
      })
      .from(outboundCallLogs)
      .innerJoin(
        unifiedJobs,
        and(
          eq(unifiedJobs.tenantId, outboundCallLogs.tenantId),
          sql`regexp_replace(COALESCE(${unifiedJobs.callerPhone}, ''), '\\D', '', 'g')
              = regexp_replace(${outboundCallLogs.customerPhone}, '\\D', '', 'g')`,
          sql`${unifiedJobs.createdAt} BETWEEN ${outboundCallLogs.callTime} - INTERVAL '12 hours'
              AND ${outboundCallLogs.callTime} + INTERVAL '2 hours'`,
        ),
      )
      .innerJoin(tenants, eq(tenants.id, outboundCallLogs.tenantId))
      .where(
        and(
          eq(outboundCallLogs.towbookNotesUpdated, false),
          // Only calls that actually happened, and only recent ones — a note is
          // worthless once the tow is done.
          sql`${outboundCallLogs.callTime} > NOW() - (${AI_NOTES_LOOKBACK_HOURS} * INTERVAL '1 hour')`,
          sql`COALESCE(${outboundCallLogs.callDurationSeconds}, 0) > 0`,
          // Something worth writing. Mirrors composeAiNotes' inputs so we do not
          // open a browser for a row that would compose to null anyway.
          //
          // Session 77 — the intake fields join the test. Before them this was
          // corrections/destination only, which fired on 24.7% of calls; the
          // intake answers turn the note into the normal case rather than the
          // exception. composeAiNotes remains the real gate — this clause only
          // has to be no NARROWER than it, or a job silently never gets a note.
          sql`(COALESCE(${outboundCallLogs.correctionsMade}, '') <> ''
               OR COALESCE(${outboundCallLogs.newDestination}, '') <> ''
               OR COALESCE(${outboundCallLogs.keysAndPresence}, '') <> ''
               OR COALESCE(${outboundCallLogs.accessNotes}, '') <> ''
               OR COALESCE(${outboundCallLogs.vehicleCondition}, '') <> ''
               OR COALESCE(${outboundCallLogs.vehicleDetails}, '') <> ''
               OR COALESCE(${outboundCallLogs.issueDescription}, '') <> ''
               OR COALESCE(${outboundCallLogs.confirmedDestination}, '') <> '')`,
          // Never retry a job we already attempted and failed on in this window;
          // a broken selector would otherwise re-open a browser every 5 minutes
          // for every call, forever.
          sql`NOT EXISTS (
                SELECT 1 FROM ai_note_writes w
                 WHERE w.call_log_id = ${outboundCallLogs.id}
                   AND w.attempted_at > NOW() - (${AI_NOTES_RETRY_BACKOFF_HOURS} * INTERVAL '1 hour')
              )`,
          tenantId ? eq(outboundCallLogs.tenantId, tenantId) : sql`true`,
        ),
      )
      .orderBy(desc(outboundCallLogs.callTime))
      .limit(limit);

    return rows;
  }

  private async markLogWritten(callLogId: string): Promise<void> {
    await this.db
      .update(outboundCallLogs)
      .set({ towbookNotesUpdated: true })
      .where(eq(outboundCallLogs.id, callLogId));
  }

  private async audit(
    c: NoteCandidate,
    outcome: 'written' | 'dry_run' | 'already_present' | 'skipped' | 'failed',
    detail: string | null,
    block: string,
    verified: boolean,
  ): Promise<void> {
    await this.db
      .insert(aiNoteWrites)
      .values({
        tenantId: c.tenantId,
        callLogId: c.callLogId,
        jobId: c.jobId,
        sourceAdapter: (c.source ?? 'unknown').toUpperCase(),
        sourceJobId: c.sourceJobId,
        outcome,
        detail,
        notesBlock: block,
        blockChars: block.length,
        verified,
      })
      .catch((err) => {
        // An audit failure must not swallow the write result it is describing.
        this.logger.warn(`[ai-notes] audit insert failed: ${(err as Error).message}`);
      });
  }
}

export interface AiNotesSweepResult {
  considered: number;
  composed: number;
  written: number;
  dryRun: number;
  skipped: number;
  failed: number;
  dryRunMode: boolean;
}

interface NoteCandidate {
  tenantId: string;
  callLogId: string;
  customerName: string | null;
  customerPhone: string;
  correctionsMade: string | null;
  newDestination: string | null;
  flipOutcome: string | null;
  callTime: Date | null;
  jobId: string;
  source: string | null;
  sourceJobId: string;
  keysAndPresence: string | null;
  accessNotes: string | null;
  vehicleCondition: string | null;
  vehicleDetails: string | null;
  issueDescription: string | null;
  confirmedDestination: string | null;
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function envInt(name: string, fallback: number): number {
  const n = Number((process.env[name] ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Off by default. This types into a live ticket in software the customer's
 * dispatchers are using right now; it gets turned on deliberately, per tenant,
 * after a dry run has been read.
 */
const AI_NOTES_WRITEBACK_ENABLED = envFlag('AI_NOTES_WRITEBACK_ENABLED', false);

/**
 * And when on, still a dry run until explicitly told otherwise. Two switches
 * rather than one because "enabled" and "actually writing" are different
 * decisions, and the interesting day is the one where the first is true and the
 * second is not.
 */
const AI_NOTES_WRITEBACK_DRY_RUN = envFlag('AI_NOTES_WRITEBACK_DRY_RUN', true);

/** One Playwright session per job, so keep the batch small. */
const AI_NOTES_BATCH_SIZE = envInt('AI_NOTES_BATCH_SIZE', 10);

/** A note is worthless once the tow is finished. */
const AI_NOTES_LOOKBACK_HOURS = envInt('AI_NOTES_LOOKBACK_HOURS', 6);

/** Do not re-attempt the same call for this long after any attempt. */
const AI_NOTES_RETRY_BACKOFF_HOURS = envInt('AI_NOTES_RETRY_BACKOFF_HOURS', 2);
