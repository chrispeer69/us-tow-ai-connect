import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { KnowledgeEndpointService } from './knowledge-endpoint.service';
import { KnowledgePackService } from '../knowledge-pack/knowledge-pack.service';
import { renderKnowledgePackMarkdown } from '../knowledge-pack/knowledge-pack-renderer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('public/knowledge')
export class KnowledgeEndpointController {
  constructor(
    private readonly service: KnowledgeEndpointService,
    private readonly kpV2: KnowledgePackService,
  ) {}

  @Get(':tenantId/profile.md')
  async getTenantProfile(@Param('tenantId') tenantId: string, @Res() res: Response) {
    if (!UUID_RE.test(tenantId)) {
      throw new NotFoundException('Tenant not found');
    }

    // Prefer KP v2 published content when available; fall back to legacy
    // v1 renderer so existing tenants without a v2 publish keep serving.
    const v2 = await this.kpV2.getPublishedContent(tenantId);
    if (v2) {
      const md = renderKnowledgePackMarkdown(v2.tenantName, v2.content);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.send(md);
      return;
    }

    const markdown = await this.service.generateTenantMarkdown(tenantId);
    if (!markdown) throw new NotFoundException('Tenant not found');

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(markdown);
  }
}
