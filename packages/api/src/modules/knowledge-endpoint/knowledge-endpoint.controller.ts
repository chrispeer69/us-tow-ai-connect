import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { KnowledgeEndpointService } from './knowledge-endpoint.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('public/knowledge')
export class KnowledgeEndpointController {
  constructor(private readonly service: KnowledgeEndpointService) {}

  @Get(':tenantId/profile.md')
  async getTenantProfile(@Param('tenantId') tenantId: string, @Res() res: Response) {
    if (!UUID_RE.test(tenantId)) {
      throw new NotFoundException('Tenant not found');
    }

    const markdown = await this.service.generateTenantMarkdown(tenantId);
    if (!markdown) throw new NotFoundException('Tenant not found');

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(markdown);
  }
}
