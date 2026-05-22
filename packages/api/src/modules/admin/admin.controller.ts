import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AgentConfigUpdateSchema,
  CompanyUpdateSchema,
  MemberCreateSchema,
  MemberUpdateSchema,
  RoutingRuleCreateSchema,
  SaveCredentialsSchema,
  type AgentConfigUpdateBody,
  type CompanyUpdateBody,
  type MemberCreateBody,
  type MemberUpdateBody,
  type RoutingRuleCreateBody,
  type SaveCredentialsBody,
} from '@ustow/shared';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminService } from './admin.service';

@Controller('v1/admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  // --- Credentials ---
  @Post('credentials')
  @UsePipes(new ZodValidationPipe(SaveCredentialsSchema))
  saveCredentials(@Req() req: AdminRequest, @Body() body: SaveCredentialsBody) {
    return this.service.saveCredentials(req.tenantId, body);
  }

  @Post('credentials/test')
  testConnection(@Req() req: AdminRequest) {
    return this.service.testConnection(req.tenantId);
  }

  @Get('integrations/status')
  getIntegrationStatus(@Req() req: AdminRequest) {
    return this.service.getIntegrationStatus(req.tenantId);
  }

  // --- Routing rules ---
  @Get('routing-rules')
  getRoutingRules(@Req() req: AdminRequest) {
    return this.service.getRoutingRules(req.tenantId);
  }

  @Post('routing-rules')
  @UsePipes(new ZodValidationPipe(RoutingRuleCreateSchema))
  createRoutingRule(@Req() req: AdminRequest, @Body() body: RoutingRuleCreateBody) {
    return this.service.createRoutingRule(req.tenantId, body);
  }

  @Post('routing-rules/:id/activate')
  activateRule(@Req() req: AdminRequest, @Param('id') ruleId: string) {
    return this.service.activateRule(req.tenantId, ruleId);
  }

  @Delete('routing-rules/:id')
  deleteRule(@Req() req: AdminRequest, @Param('id') ruleId: string) {
    return this.service.deleteRule(req.tenantId, ruleId);
  }

  // --- Call logs ---
  @Get('interaction-logs')
  async getInteractionLogs(
    @Req() req: AdminRequest,
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.getInteractionLogs(req.tenantId, query);
    if (query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="call_logs.csv"');
      return toCsv(result.items as unknown as Array<Record<string, unknown>>);
    }
    return result;
  }

  // --- Company ---
  @Get('company')
  getCompany(@Req() req: AdminRequest) {
    return this.service.getCompany(req.tenantId);
  }

  @Put('company')
  @UsePipes(new ZodValidationPipe(CompanyUpdateSchema))
  updateCompany(@Req() req: AdminRequest, @Body() body: CompanyUpdateBody) {
    return this.service.updateCompany(req.tenantId, body);
  }

  // --- Members ---
  @Get('members')
  listMembers(@Req() req: AdminRequest) {
    return this.service.listMembers(req.tenantId);
  }

  @Post('members')
  @UsePipes(new ZodValidationPipe(MemberCreateSchema))
  inviteMember(@Req() req: AdminRequest, @Body() body: MemberCreateBody) {
    return this.service.inviteMember(req.tenantId, body);
  }

  @Put('members/:id')
  updateMember(
    @Req() req: AdminRequest,
    @Param('id') memberId: string,
    @Body(new ZodValidationPipe(MemberUpdateSchema)) body: MemberUpdateBody,
  ) {
    return this.service.updateMember(req.tenantId, memberId, body);
  }

  @Delete('members/:id')
  removeMember(@Req() req: AdminRequest, @Param('id') memberId: string) {
    return this.service.removeMember(req.tenantId, memberId);
  }

  // --- Agent config ---
  @Get('agent-config')
  getAgentConfig(@Req() req: AdminRequest) {
    return this.service.getAgentConfig(req.tenantId);
  }

  @Put('agent-config')
  @UsePipes(new ZodValidationPipe(AgentConfigUpdateSchema))
  updateAgentConfig(@Req() req: AdminRequest, @Body() body: AgentConfigUpdateBody) {
    return this.service.updateAgentConfig(req.tenantId, body);
  }
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set()),
  );
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : JSON.stringify(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(','));
  return lines.join('\n');
}
