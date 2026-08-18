import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
  constructor(private readonly push: PushService) {}

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
