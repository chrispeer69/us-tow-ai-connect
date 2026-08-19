import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { attentionDismissals, outboundCalls } from '../../db/schema';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { PushService } from './push.service';

/**
 * Session 77 — device registration for the flip board's win alerts.
 *
 * Separate from PushController (`/v1/driver-push`) because the auth is
 * different, not because the push is: that one is guarded by the tenant API key
 * the driver PWA carries, this one by the admin JWT the flip board already
 * holds. Sharing a controller would mean weakening one of the two.
 *
 * The tenant always comes from the verified request and never from the body, so
 * a device can only ever be registered against the caller's own tenant.
 */
@Controller('v1/admin/flip-push')
@UseGuards(AdminAuthGuard)
export class FlipPushController {
  constructor(
    private readonly push: PushService,
    @Inject(DB_CLIENT) private readonly db: DbClient,
  ) {}

  /**
   * The client needs the VAPID public key before it can call
   * `pushManager.subscribe`. Public by design — it identifies us to the push
   * service and is useless without the private half.
   */
  @Get('public-key')
  publicKey() {
    const key = this.push.getPublicKey();
    return { data: { enabled: Boolean(key), publicKey: key || null } };
  }

  @Get('devices')
  async devices(@Req() req: AdminRequest) {
    return { data: await this.push.listAdminDevices(req.tenantId) };
  }

  @Post('subscribe')
  async subscribe(
    @Req() req: AdminRequest,
    @Body() body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; label?: string },
  ) {
    const endpoint = body?.endpoint?.trim();
    const p256dh = body?.keys?.p256dh?.trim();
    const auth = body?.keys?.auth?.trim();
    if (!endpoint || !p256dh || !auth) {
      throw new BadRequestException('endpoint and keys.p256dh and keys.auth are required');
    }
    // Only real push endpoints. Without this the table becomes a small SSRF
    // surface: an attacker-supplied URL would receive our VAPID-signed requests.
    if (!/^https:\/\//i.test(endpoint)) {
      throw new BadRequestException('endpoint must be https');
    }

    await this.push.subscribeAdminDevice({
      tenantId: req.tenantId,
      endpoint,
      p256dh,
      auth,
      label: body.label?.slice(0, 80) ?? null,
      userAgent: (req.headers?.['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
    });
    return { data: { ok: true } };
  }

  @Delete('subscribe')
  async unsubscribe(@Req() req: AdminRequest, @Body() body: { endpoint?: string }) {
    const endpoint = body?.endpoint?.trim();
    if (!endpoint) throw new BadRequestException('endpoint is required');
    const removed = await this.push.unsubscribeAdminDevice(req.tenantId, endpoint);
    return { data: { removed } };
  }


  /**
   * Mark an unanswered job as handled, for everybody.
   *
   * Chris, 2026-08-19, on the red card's dismiss button: "where does it go
   * then?" It went nowhere — localStorage on one phone. For an admin team that
   * is the wrong shape: two people see the same card, both ring the same
   * customer, and nobody can say afterwards whether anyone did.
   *
   * A dismissal is now an event. It clears the card on every device on the next
   * refresh, and the row is the record of the intervention.
   */
  @Post('attention/:id/dismiss')
  async dismissAttention(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: { dismissedBy?: string; note?: string },
  ) {
    // Confirm the call belongs to the caller's tenant before writing anything.
    // The id arrives from a phone; without this, one tenant could clear
    // another's board by guessing a uuid.
    const owned = await this.db
      .select({ id: outboundCalls.id })
      .from(outboundCalls)
      .where(and(eq(outboundCalls.id, id), eq(outboundCalls.tenantId, req.tenantId)))
      .limit(1);
    if (owned.length === 0) {
      throw new BadRequestException('unknown call for this tenant');
    }

    await this.db
      .insert(attentionDismissals)
      .values({
        tenantId: req.tenantId,
        outboundCallId: id,
        dismissedBy: body?.dismissedBy?.slice(0, 80) ?? null,
        note: body?.note?.slice(0, 500) ?? null,
      })
      // Two admins tapping at the same moment is one intervention, and the
      // first one to land is the one that happened.
      .onConflictDoNothing({ target: attentionDismissals.outboundCallId });

    return { data: { ok: true } };
  }

  /**
   * Send a test push to every registered device on this tenant.
   *
   * Exists because the real trigger is a flip win, which cannot be summoned on
   * demand. Without it the only way to know push works is to wait for a win and
   * hope — which is exactly how you ship a broken notification path.
   */
  @Post('test')
  async test(@Req() req: AdminRequest) {
    const res = await this.push.sendToTenantAdmins(req.tenantId, {
      title: 'Test alert',
      body: 'Push is working. A real flip win will look like this.',
      url: '/m/flip',
      tag: 'push-test',
    });
    return { data: res };
  }
}
