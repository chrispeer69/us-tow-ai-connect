import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { driverPings, tenants, trackingLinks, type TrackingLinkRow } from '../../db/schema';
import { TwilioSmsService } from '../outbound-sms/twilio-sms.service';

const TOKEN_LENGTH = 12;
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PING_FRESHNESS_SECONDS = 30 * 60;

export interface CreateTrackingLinkInput {
  callerPhone: string;
  callerName?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  jobId?: string | null;
}

export interface CreateTrackingLinkResult {
  tracking_url: string;
  token: string;
  expires_at: string;
  sms_status: string | null;
}

export interface TrackingStatusView {
  caller_name: string | null;
  status: string;
  assigned_driver_name: string | null;
  last_eta_minutes: number | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  expires_at: string;
  expired: boolean;
  caller_phone_last4: string | null;
}

export interface UpdateTrackingLinkInput {
  status?: string;
  assignedDriverPhone?: string | null;
  assignedDriverName?: string | null;
  lastEtaMinutes?: number | null;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    private readonly sms: TwilioSmsService,
  ) {}

  generateToken(): string {
    const buf = randomBytes(TOKEN_LENGTH);
    let out = '';
    for (let i = 0; i < TOKEN_LENGTH; i++) {
      out += TOKEN_ALPHABET[buf[i] % TOKEN_ALPHABET.length];
    }
    return out;
  }

  async create(tenantId: string, input: CreateTrackingLinkInput): Promise<CreateTrackingLinkResult> {
    const token = await this.allocateUniqueToken();
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

    const inserted = await this.db
      .insert(trackingLinks)
      .values({
        tenantId,
        token,
        callerPhone: input.callerPhone,
        callerName: input.callerName ?? null,
        pickupLat: input.pickupLat != null ? String(input.pickupLat) : null,
        pickupLng: input.pickupLng != null ? String(input.pickupLng) : null,
        jobId: input.jobId ?? null,
        status: 'created',
        expiresAt,
      })
      .returning();
    const row = inserted[0];

    const trackingUrl = await this.buildTrackingUrl(tenantId, token);
    const smsResult = await this.sendInitialSms(tenantId, input.callerPhone, trackingUrl, row.id);

    return {
      tracking_url: trackingUrl,
      token: row.token,
      expires_at: row.expiresAt.toISOString(),
      sms_status: smsResult,
    };
  }

  async getPublicView(token: string): Promise<TrackingStatusView> {
    const row = await this.getByToken(token);
    const now = Date.now();
    const expired = row.expiresAt.getTime() < now;

    let driverLat: number | null = null;
    let driverLng: number | null = null;
    if (row.assignedDriverPhone) {
      const latest = await this.db
        .select({ lat: driverPings.lat, lng: driverPings.lng, recordedAt: driverPings.recordedAt })
        .from(driverPings)
        .where(
          and(
            eq(driverPings.tenantId, row.tenantId),
            eq(driverPings.driverPhone, row.assignedDriverPhone),
          ),
        )
        .orderBy(desc(driverPings.recordedAt))
        .limit(1);
      const ping = latest[0];
      if (ping) {
        const age = (now - ping.recordedAt.getTime()) / 1000;
        if (age <= PING_FRESHNESS_SECONDS) {
          driverLat = Number(ping.lat);
          driverLng = Number(ping.lng);
        }
      }
    }

    const phoneDigits = row.callerPhone.replace(/\D/g, '');
    const last4 = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : null;

    return {
      caller_name: row.callerName,
      status: expired ? 'expired' : row.status,
      assigned_driver_name: row.assignedDriverName,
      last_eta_minutes: row.lastEtaMinutes,
      pickup_lat: row.pickupLat != null ? Number(row.pickupLat) : null,
      pickup_lng: row.pickupLng != null ? Number(row.pickupLng) : null,
      driver_lat: driverLat,
      driver_lng: driverLng,
      expires_at: row.expiresAt.toISOString(),
      expired,
      caller_phone_last4: last4,
    };
  }

  async update(tenantId: string, token: string, input: UpdateTrackingLinkInput) {
    const row = await this.getByTenantAndToken(tenantId, token);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = input.status;
    if (input.assignedDriverPhone !== undefined) patch.assignedDriverPhone = input.assignedDriverPhone;
    if (input.assignedDriverName !== undefined) patch.assignedDriverName = input.assignedDriverName;
    if (input.lastEtaMinutes !== undefined) patch.lastEtaMinutes = input.lastEtaMinutes;

    await this.db.update(trackingLinks).set(patch).where(eq(trackingLinks.id, row.id));
    return { id: row.id, token: row.token, status: (patch.status as string) ?? row.status };
  }

  async getByToken(token: string): Promise<TrackingLinkRow> {
    const rows = await this.db
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.token, token))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ status: 'error', code: 'TRACKING_NOT_FOUND' });
    }
    return row;
  }

  private async getByTenantAndToken(tenantId: string, token: string): Promise<TrackingLinkRow> {
    const rows = await this.db
      .select()
      .from(trackingLinks)
      .where(and(eq(trackingLinks.tenantId, tenantId), eq(trackingLinks.token, token)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ status: 'error', code: 'TRACKING_NOT_FOUND' });
    }
    return row;
  }

  private async allocateUniqueToken(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = this.generateToken();
      const existing = await this.db
        .select({ id: trackingLinks.id })
        .from(trackingLinks)
        .where(eq(trackingLinks.token, candidate))
        .limit(1);
      if (existing.length === 0) return candidate;
    }
    throw new Error('Failed to allocate a unique tracking token after 5 attempts');
  }

  private async buildTrackingUrl(tenantId: string, token: string): Promise<string> {
    const tenant = (
      await this.db
        .select({ trackingUrlBase: tenants.trackingUrlBase })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    const base = (tenant?.trackingUrlBase ?? process.env.TRACKING_URL_BASE ?? 'https://ustowapi-production.up.railway.app/track').replace(/\/$/, '');
    return `${base}/${token}`;
  }

  private async sendInitialSms(
    tenantId: string,
    callerPhone: string,
    trackingUrl: string,
    trackingLinkId: string,
  ): Promise<string | null> {
    const tenant = (
      await this.db
        .select({ smsEnabled: tenants.smsEnabled })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    if (tenant && tenant.smsEnabled === false) {
      this.logger.warn(`SMS opt-out: tenant ${tenantId} has sms_enabled=false — skipping tracking SMS`);
      return 'skipped_opt_out';
    }
    const body = `Roadside Towing: Track your tow live → ${trackingUrl}. Reply STOP to opt out.`;
    try {
      const result = await this.sms.sendSms({
        to: callerPhone,
        body,
        tenantId,
        related: { trackingLinkId },
      });
      return result.status;
    } catch (err) {
      this.logger.warn(`Tracking SMS failed for ${callerPhone}: ${(err as Error).message}`);
      return 'error';
    }
  }
}
