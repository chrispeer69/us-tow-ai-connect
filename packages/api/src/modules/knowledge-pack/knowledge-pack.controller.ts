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
import type { Response } from 'express';
import { KnowledgePackV2Schema, type KnowledgePackV2 } from '@ustow/shared';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { KnowledgePackService } from './knowledge-pack.service';
import { renderKnowledgePackMarkdown } from './knowledge-pack-renderer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('v1/admin/knowledge-pack')
@UseGuards(AdminAuthGuard)
export class KnowledgePackAdminController {
  constructor(private readonly service: KnowledgePackService) {}

  @Get()
  get(@Req() req: AdminRequest) {
    return this.service.get(req.tenantId);
  }

  @Put('draft')
  @UsePipes(new ZodValidationPipe(KnowledgePackV2Schema))
  saveDraft(@Req() req: AdminRequest, @Body() body: KnowledgePackV2) {
    const actor = (req.headers['x-actor-email'] as string | undefined) ?? 'admin';
    return this.service.saveDraft(req.tenantId, body, actor);
  }

  @Post('publish')
  publish(@Req() req: AdminRequest) {
    const actor = (req.headers['x-actor-email'] as string | undefined) ?? 'admin';
    return this.service.publish(req.tenantId, actor);
  }
}

/**
 * Public read endpoints. JSON variant for structured consumers (Thinkrr
 * voice agent, future API consumers); MD variant for the legacy Thinkrr
 * Knowledge Pack scraper that expects markdown.
 */
@Controller('public/knowledge')
export class KnowledgePackPublicController {
  constructor(private readonly service: KnowledgePackService) {}

  @Get(':tenantId/profile.json')
  async getJson(@Param('tenantId') tenantId: string) {
    if (!UUID_RE.test(tenantId)) throw new NotFoundException('Tenant not found');
    const published = await this.service.getPublishedContent(tenantId);
    if (!published) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_PUBLISHED',
        message: 'Tenant has no published Knowledge Pack v2',
      });
    }
    return { tenantName: published.tenantName, content: published.content };
  }

  @Get(':tenantId/profile.v2.md')
  async getMarkdown(@Param('tenantId') tenantId: string, @Res() res: Response) {
    if (!UUID_RE.test(tenantId)) throw new NotFoundException('Tenant not found');
    const published = await this.service.getPublishedContent(tenantId);
    if (!published) {
      throw new NotFoundException({
        status: 'error',
        code: 'NOT_PUBLISHED',
        message: 'Tenant has no published Knowledge Pack v2',
      });
    }
    const md = renderKnowledgePackMarkdown(published.tenantName, published.content);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(md);
  }
}
