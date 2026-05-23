import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { BrandingSchema, type BrandingBody } from '@ustow/shared';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BrandingService } from './branding.service';
import { BrandingAssetsService } from './branding-assets.service';
import { TenantApiKeyGuard } from '../../common/guards/tenant-api-key.guard';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawBody {
  rawBody?: Buffer;
}

/**
 * Admin (cookie / header tenant) + tenant API-key surface for branding.
 *  - GET  /v1/admin/branding              tenant API key OR admin auth
 *  - PUT  /v1/admin/branding              admin auth
 *  - POST /v1/admin/branding/upload/:kind admin auth (logo|favicon)
 * Public asset serving lives at /branding/:tenant_id/:filename.
 */
@Controller('v1/admin/branding')
export class BrandingAdminController {
  constructor(
    private readonly branding: BrandingService,
    private readonly assets: BrandingAssetsService,
  ) {}

  @Get()
  @UseGuards(AdminAuthGuard)
  get(@Req() req: AdminRequest) {
    return this.branding.get(req.tenantId);
  }

  @Put()
  @UseGuards(AdminAuthGuard)
  @UsePipes(new ZodValidationPipe(BrandingSchema))
  put(@Req() req: AdminRequest, @Body() body: BrandingBody) {
    const actor = (req.headers['x-actor-email'] as string | undefined) ?? 'admin';
    return this.branding.put(req.tenantId, body, actor);
  }

  /**
   * Multipart-free upload. The client posts the raw image bytes with the
   * appropriate Content-Type header; this keeps multer out of the
   * dependency tree (~2 MB of weight nobody needs).
   */
  @Post('upload/:kind')
  @UseGuards(AdminAuthGuard)
  async upload(
    @Req() req: AdminRequest & RawBody,
    @Param('kind') kind: string,
  ) {
    if (kind !== 'logo' && kind !== 'favicon') {
      throw new NotFoundException({ status: 'error', code: 'BAD_KIND', message: 'Use /upload/logo or /upload/favicon' });
    }
    const mimetype = (req.headers['content-type'] ?? 'application/octet-stream').toString().split(';')[0].trim();
    const buf = req.rawBody ?? (req.body instanceof Buffer ? req.body : null);
    if (!buf) {
      throw new NotFoundException({ status: 'error', code: 'NO_FILE', message: 'No file uploaded' });
    }
    this.assets.validate({ mimetype, size: buf.length });
    const stored = await this.assets.save({
      tenantId: req.tenantId,
      kind,
      mimetype,
      buffer: buf,
    });
    const field = kind === 'logo' ? 'logoUrl' : 'faviconUrl';
    const updated = await this.branding.patchUrl(req.tenantId, field, stored.url);
    return { url: stored.url, branding: updated };
  }
}

/**
 * Tenant-API-key surface for the driver/tracking PWA pages that need
 * branding without an admin session.
 */
@Controller('v1/branding')
export class BrandingTenantController {
  constructor(private readonly branding: BrandingService) {}

  @Get('me')
  @UseGuards(TenantApiKeyGuard)
  getMine(@Req() req: AdminRequest) {
    return this.branding.get(req.tenantId);
  }
}

/**
 * Public branding endpoints — used by the driver PWA, public tracking
 * page, and asset URLs embedded in emails / SMS. NOT auth gated:
 * branding is intentionally public (logos go on customer-facing pages).
 */
@Controller('branding')
export class BrandingPublicController {
  constructor(
    private readonly branding: BrandingService,
    private readonly assets: BrandingAssetsService,
  ) {}

  @Get('public/:tenantId')
  async getPublic(@Param('tenantId') tenantId: string) {
    if (!UUID_RE.test(tenantId)) throw new NotFoundException('Tenant not found');
    return this.branding.getSafe(tenantId);
  }

  @Get(':tenantId/:filename')
  async getAsset(
    @Param('tenantId') tenantId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!UUID_RE.test(tenantId)) throw new NotFoundException('Asset not found');
    // Prevent path traversal — filenames are restricted to logo.* / favicon.*
    if (!/^(logo|favicon)\.(png|jpg|jpeg|webp|svg|ico)$/i.test(filename)) {
      throw new NotFoundException('Asset not found');
    }
    const file = await this.assets.read({ tenantId, filename });
    if (!file) throw new NotFoundException('Asset not found');
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.send(file.buffer);
  }
}
