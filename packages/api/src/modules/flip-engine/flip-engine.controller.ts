import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { FlipEngineService } from './flip-engine.service';

const ShopTypeEnum = z.enum(['REPAIR', 'BODY']);

const ShopCreateSchema = z.object({
  name: z.string().min(1).max(180),
  shopType: ShopTypeEnum,
  addressLine: z.string().min(1).max(255),
  city: z.string().min(1).max(100),
  state: z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/),
  postalCode: z.string().min(1).max(20),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  phone: z
    .string()
    .max(20)
    .regex(/^[+0-9 ()\-]+$/)
    .optional()
    .nullable(),
  website: z.string().url().optional().nullable(),
  rentalPickupAvailable: z.boolean().optional(),
  active: z.boolean().optional(),
  specialties: z.array(z.string()).optional(),
  notes: z.string().optional().nullable(),
});
type ShopCreateBody = z.infer<typeof ShopCreateSchema>;

const ShopPatchSchema = ShopCreateSchema.partial();
type ShopPatchBody = z.infer<typeof ShopPatchSchema>;

const BlocklistMatchEnum = z.enum(['NAME_PATTERN', 'EXACT_NAME', 'EXACT_ADDRESS', 'PHONE']);

const BlocklistCreateSchema = z.object({
  matchType: BlocklistMatchEnum,
  matchValue: z.string().min(1).max(255),
  label: z.string().min(1).max(180),
  notes: z.string().optional().nullable(),
});
type BlocklistCreateBody = z.infer<typeof BlocklistCreateSchema>;

const ConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  config: z
    .object({
      poll_interval_seconds: z.number().int().min(15).max(3600).optional(),
      no_flip_confidence_threshold: z.number().min(0).max(1).optional(),
      no_flip_categories: z.array(z.string()).optional(),
      daily_report_hour_local: z.number().int().min(0).max(23).optional(),
      batch_summary_size: z.number().int().min(1).max(200).optional(),
      send_batch_summaries: z.boolean().optional(),
      send_daily_report: z.boolean().optional(),
      mention_rentals: z.boolean().optional(),
    })
    .partial()
    .optional(),
});
type ConfigPatchBody = z.infer<typeof ConfigPatchSchema>;

const NearestQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  shopType: ShopTypeEnum,
});
type NearestQueryBody = z.infer<typeof NearestQuerySchema>;

@Controller('v1/admin/flip-engine')
@UseGuards(AdminAuthGuard)
export class FlipEngineController {
  constructor(private readonly service: FlipEngineService) {}

  // ----- shops -----

  @Get('shops')
  async listShops(@Req() req: AdminRequest) {
    const items = await this.service.listShops(req.tenantId);
    return { status: 'success', data: { items } };
  }

  @Get('shops/:id')
  async getShop(@Req() req: AdminRequest, @Param('id') id: string) {
    const row = await this.service.getShop(req.tenantId, id);
    if (!row) {
      throw new NotFoundException({ status: 'error', code: 'NOT_FOUND', message: 'shop not found' });
    }
    return { status: 'success', data: row };
  }

  @Post('shops')
  @UsePipes(new ZodValidationPipe(ShopCreateSchema))
  async createShop(@Req() req: AdminRequest, @Body() body: ShopCreateBody) {
    const row = await this.service.createShop({
      tenantId: req.tenantId,
      name: body.name,
      shopType: body.shopType,
      addressLine: body.addressLine,
      city: body.city,
      state: body.state.toUpperCase(),
      postalCode: body.postalCode,
      lat: body.lat == null ? null : (body.lat as never),
      lng: body.lng == null ? null : (body.lng as never),
      phone: body.phone ?? null,
      website: body.website ?? null,
      rentalPickupAvailable: body.rentalPickupAvailable ?? true,
      active: body.active ?? true,
      specialties: (body.specialties ?? []) as never,
      notes: body.notes ?? null,
    });
    return { status: 'success', data: row };
  }

  @Put('shops/:id')
  @UsePipes(new ZodValidationPipe(ShopPatchSchema))
  async updateShop(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: ShopPatchBody,
  ) {
    const row = await this.service.updateShop(req.tenantId, id, {
      ...body,
      state: body.state ? body.state.toUpperCase() : undefined,
      lat: body.lat == null ? body.lat : (body.lat as never),
      lng: body.lng == null ? body.lng : (body.lng as never),
      specialties: body.specialties ? (body.specialties as never) : undefined,
    });
    return { status: 'success', data: row };
  }

  @Delete('shops/:id')
  @HttpCode(200)
  async deleteShop(@Req() req: AdminRequest, @Param('id') id: string) {
    await this.service.deleteShop(req.tenantId, id);
    return { status: 'success', data: { id } };
  }

  @Post('shops/nearest')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(NearestQuerySchema))
  async pickNearest(@Req() req: AdminRequest, @Body() body: NearestQueryBody) {
    const result = await this.service.pickNearestShop({
      tenantId: req.tenantId,
      pickupLat: body.lat,
      pickupLng: body.lng,
      shopType: body.shopType,
    });
    return { status: 'success', data: result };
  }

  // ----- AAA-branded blocklist -----

  @Get('aaa-blocklist')
  async listBlocklist(@Req() req: AdminRequest) {
    const items = await this.service.listBlocklist(req.tenantId);
    return { status: 'success', data: { items } };
  }

  @Post('aaa-blocklist')
  @UsePipes(new ZodValidationPipe(BlocklistCreateSchema))
  async createBlocklist(@Req() req: AdminRequest, @Body() body: BlocklistCreateBody) {
    const row = await this.service.createBlocklistEntry({
      tenantId: req.tenantId,
      matchType: body.matchType,
      matchValue: body.matchValue,
      label: body.label,
      notes: body.notes ?? null,
      addedBy: 'admin',
    });
    return { status: 'success', data: row };
  }

  @Patch('aaa-blocklist/:id')
  async patchBlocklist(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: { active?: boolean },
  ) {
    if (typeof body?.active !== 'boolean') {
      throw new BadRequestException({
        status: 'error',
        code: 'INVALID_BODY',
        message: 'body.active boolean is required',
      });
    }
    const row = await this.service.setBlocklistEntryActive(req.tenantId, id, body.active);
    if (!row) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'blocklist entry not found',
      });
    }
    return { status: 'success', data: row };
  }

  @Delete('aaa-blocklist/:id')
  @HttpCode(200)
  async deleteBlocklist(@Req() req: AdminRequest, @Param('id') id: string) {
    await this.service.deleteBlocklistEntry(req.tenantId, id);
    return { status: 'success', data: { id } };
  }

  // Diagnostic: run the AAA-branded check against ad-hoc input. Useful for
  // letting an operator test their blocklist edits without placing a real
  // call.
  @Post('aaa-blocklist/check')
  @HttpCode(200)
  async checkBlocklist(
    @Req() req: AdminRequest,
    @Body()
    body: {
      destinationName?: string | null;
      destinationAddress?: string | null;
      destinationPhone?: string | null;
    },
  ) {
    const result = await this.service.checkAaaBranded({
      tenantId: req.tenantId,
      destinationName: body?.destinationName,
      destinationAddress: body?.destinationAddress,
      destinationPhone: body?.destinationPhone,
    });
    return { status: 'success', data: result };
  }

  // ----- config -----

  @Get('config')
  async getConfig(@Req() req: AdminRequest) {
    const result = await this.service.getConfig(req.tenantId);
    return { status: 'success', data: result };
  }

  @Patch('config')
  @UsePipes(new ZodValidationPipe(ConfigPatchSchema))
  async patchConfig(@Req() req: AdminRequest, @Body() body: ConfigPatchBody) {
    const result = await this.service.updateConfig(req.tenantId, body);
    return { status: 'success', data: result };
  }
}
