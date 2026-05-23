import { Controller, Get, Logger, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { KnowledgeEndpointService } from './knowledge-endpoint.service';
import { KnowledgePackService } from '../knowledge-pack/knowledge-pack.service';
import { renderKnowledgePackMarkdown } from '../knowledge-pack/knowledge-pack-renderer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('public/knowledge')
export class KnowledgeEndpointController {
  private readonly logger = new Logger(KnowledgeEndpointController.name);

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
    // Both calls are wrapped — Thinkrr's KP scraper polls this endpoint
    // every ~60s and a 500 here breaks every tenant's voice agent. A
    // minimal stub markdown is far better than a 500.
    let markdown: string | null = null;
    try {
      const v2 = await this.kpV2.getPublishedContent(tenantId);
      if (v2) {
        markdown = renderKnowledgePackMarkdown(v2.tenantName, v2.content);
      }
    } catch (err) {
      this.logger.warn(
        `[kp-controller] v2 lookup failed for tenant ${tenantId}: ${(err as Error).message}`,
      );
    }

    if (!markdown) {
      try {
        markdown = await this.service.generateTenantMarkdown(tenantId);
      } catch (err) {
        this.logger.error(
          `[kp-controller] v1 generateTenantMarkdown failed for tenant ${tenantId}: ${(err as Error).message}`,
        );
        markdown = stubMarkdown(tenantId);
      }
    }

    if (!markdown) {
      throw new NotFoundException('Tenant not found');
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(markdown);
  }
}

function stubMarkdown(tenantId: string): string {
  return `# Tenant ${tenantId}

The Knowledge Pack for this tenant is temporarily unavailable. The
voice agent should transfer the caller to the dispatch team if any
specific question cannot be answered from prior conversation context.

This is a fallback response — the operator has been alerted via the
API logs.
`;
}
