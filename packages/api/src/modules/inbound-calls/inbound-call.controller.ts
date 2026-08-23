import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { inboundCallLogs } from '../../db/schema';
import {
  buildSignaturePayloads,
  retellSecretsFromEnv,
  verifyRetellSignature,
} from '../../common/utils/retell-signature';

/**
 * Post-call events for calls that come IN to the Roadside line.
 *
 * Until 2026-08-23 the inbound agent had no webhook at all, so a customer could
 * ring, describe a breakdown, and hang up leaving no trace in this system. That
 * was tolerable while the line only handled callbacks about jobs that already
 * existed. It stopped being tolerable when the same line started taking a full
 * new-tow intake — the bar Chris set is "90 percent right most of the time",
 * and the only way to find the other ten per cent is to read the calls.
 *
 * Deliberately a separate endpoint from the campaign and flip webhooks. Those
 * two resolve a call back to a lead or a flip attempt and act on it; this one
 * records what happened on a call that may have no prior record at all.
 */
interface InboundWebhookBody {
  event: 'call_started' | 'call_ended' | 'call_analyzed';
  call?: {
    call_id?: string;
    agent_id?: string;
    agent_version?: number | string;
    direction?: string;
    from_number?: string;
    to_number?: string;
    call_status?: string;
    disconnection_reason?: string;
    duration_ms?: number;
    transcript?: string;
    recording_url?: string;
    start_timestamp?: number;
    end_timestamp?: number;
    call_analysis?: {
      call_summary?: string;
      custom_analysis_data?: Record<string, unknown>;
    };
  };
}

/**
 * Which of the three branches the caller actually went down.
 *
 * Read from the agent's own post-call answer when it gave one, and otherwise
 * inferred from the transcript. Inference is a fallback and not a substitute:
 * it exists so a call still gets classified when post-call analysis is not
 * configured, which is the state the agent is in today.
 */
export function classifyBranch(
  analysis: Record<string, unknown> | undefined,
  transcript: string | undefined,
): 'update' | 'new_tow' | 'motor_club' | 'unknown' {
  const stated = String(analysis?.call_branch ?? analysis?.branch ?? '').toLowerCase();
  if (stated.includes('motor')) return 'motor_club';
  if (stated.includes('new')) return 'new_tow';
  if (stated.includes('update') || stated.includes('existing')) return 'update';

  const t = (transcript ?? '').toLowerCase();
  if (!t) return 'unknown';
  // Ordered by how distinctive the evidence is, not by how common the branch
  // is. A purchase order number is near-proof of a motor club; "where is my
  // truck" is merely typical of an update.
  if (/purchase order|\bp\.?o\.? number|dispatch number|claim number|calling from/.test(t)) {
    return 'motor_club';
  }
  if (/need a tow|i broke down|i'm stuck|im stuck|won't start|wont start|flat tire|locked out|out of gas/.test(t)) {
    return 'new_tow';
  }
  if (/where is|how much longer|how long|my driver|someone called me|status/.test(t)) {
    return 'update';
  }
  return 'unknown';
}

@Controller('webhooks/retell')
export class InboundCallController {
  private readonly logger = new Logger(InboundCallController.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  @Post('inbound')
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Headers('x-retell-signature') signature: string | undefined,
    @Body() body: InboundWebhookBody,
  ) {
    const secrets = retellSecretsFromEnv();
    if (secrets.length > 0) {
      const payloads = buildSignaturePayloads(req, body);
      if (!verifyRetellSignature(signature, secrets, payloads)) {
        throw new UnauthorizedException('bad signature');
      }
    } else {
      // Loud, because an unsigned public webhook that writes to the database is
      // not a state to drift into quietly.
      this.logger.warn('RETELL_WEBHOOK_SECRET is not set — inbound webhook is UNVERIFIED');
    }

    const call = body.call;
    if (!call?.call_id) return { ok: true, ignored: 'no call_id' };

    // Only terminal events carry a transcript worth storing, and call_started
    // would otherwise write a row we immediately have to update.
    if (body.event === 'call_started') return { ok: true, ignored: 'call_started' };

    const tenantId = process.env.ROADSIDE_TENANT_ID;
    if (!tenantId) {
      this.logger.error('ROADSIDE_TENANT_ID is not set — inbound call not recorded');
      return { ok: true, ignored: 'no tenant configured' };
    }

    const analysis = call.call_analysis?.custom_analysis_data;
    const values = {
      tenantId,
      providerCallId: call.call_id,
      agentId: call.agent_id ?? null,
      agentVersion: call.agent_version != null ? String(call.agent_version) : null,
      fromNumber: call.from_number ?? null,
      toNumber: call.to_number ?? null,
      branch: classifyBranch(analysis, call.transcript),
      durationSeconds: call.duration_ms != null ? Math.round(call.duration_ms / 1000) : null,
      disconnectionReason: call.disconnection_reason ?? null,
      transcript: call.transcript ?? null,
      recordingUrl: call.recording_url ?? null,
      summary: call.call_analysis?.call_summary ?? null,
      analysis: (call.call_analysis ?? null) as never,
      startedAt: call.start_timestamp ? new Date(call.start_timestamp) : null,
      endedAt: call.end_timestamp ? new Date(call.end_timestamp) : null,
    };

    // call_ended and call_analyzed both arrive for the same call, the second
    // carrying the transcript and summary. Upsert so the later, richer event
    // fills in what the earlier one could not — and so a Retell redelivery
    // cannot produce a duplicate.
    await this.db
      .insert(inboundCallLogs)
      .values(values)
      .onConflictDoUpdate({
        target: inboundCallLogs.providerCallId,
        set: {
          branch: values.branch,
          durationSeconds: values.durationSeconds,
          disconnectionReason: values.disconnectionReason,
          // Never overwrite a transcript we already have with an empty one.
          ...(values.transcript ? { transcript: values.transcript } : {}),
          ...(values.recordingUrl ? { recordingUrl: values.recordingUrl } : {}),
          ...(values.summary ? { summary: values.summary } : {}),
          ...(values.analysis ? { analysis: values.analysis } : {}),
          ...(values.endedAt ? { endedAt: values.endedAt } : {}),
          updatedAt: sql`now()`,
        },
      });

    return { ok: true, branch: values.branch };
  }
}
