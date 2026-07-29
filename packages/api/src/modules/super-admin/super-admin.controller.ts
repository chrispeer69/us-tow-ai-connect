import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SuperAdminAuthGuard } from './super-admin-auth.guard';
import { SuperAdminService } from './super-admin.service';
import { AdminService } from '../admin/admin.service';
import { FlipEngineService } from '../flip-engine/flip-engine.service';
import { BadRequestException } from '@nestjs/common';

@Controller('v1/super-admin')
@UseGuards(SuperAdminAuthGuard)
export class SuperAdminController {
  constructor(
    private readonly service: SuperAdminService,
    private readonly adminService: AdminService,
    private readonly flipEngineService: FlipEngineService,
  ) {}

  @Get('tenants')
  listTenants() {
    return this.service.listTenants();
  }

  @Get('demo-call-settings')
  getDemoCallSettings() {
    return this.service.getDemoCallSettings();
  }

  @Patch('demo-call-settings')
  updateDemoCallSettings(@Body() body: { enabled?: boolean }) {
    return this.service.updateDemoCallSettings({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    });
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.service.getTenant(id);
  }

  @Patch('tenants/:id/demo-settings')
  updateTenantDemoSettings(
    @Param('id') id: string,
    @Body() body: { demoMode?: boolean; demoCallsEnabled?: boolean },
  ) {
    return this.service.updateTenantDemoSettings(id, {
      demoMode: typeof body.demoMode === 'boolean' ? body.demoMode : undefined,
      demoCallsEnabled:
        typeof body.demoCallsEnabled === 'boolean' ? body.demoCallsEnabled : undefined,
    });
  }

  @Patch('tenants/:id/call-controls')
  updateTenantCallControls(
    @Param('id') id: string,
    @Body()
    body: {
      outboundVoiceEnabled?: boolean;
      demoMode?: boolean;
      demoCallsEnabled?: boolean;
      freeTrialCallMinutes?: number;
      testModeEnabled?: boolean;
      testOverrideNumber?: string | null;
      plan?: string;
    },
  ) {
    return this.service.updateTenantCallControls(id, {
      outboundVoiceEnabled:
        typeof body.outboundVoiceEnabled === 'boolean'
          ? body.outboundVoiceEnabled
          : undefined,
      demoMode: typeof body.demoMode === 'boolean' ? body.demoMode : undefined,
      demoCallsEnabled:
        typeof body.demoCallsEnabled === 'boolean'
          ? body.demoCallsEnabled
          : undefined,
      freeTrialCallMinutes:
        typeof body.freeTrialCallMinutes === 'number'
          ? body.freeTrialCallMinutes
          : undefined,
      testModeEnabled:
        typeof body.testModeEnabled === 'boolean'
          ? body.testModeEnabled
          : undefined,
      testOverrideNumber:
        typeof body.testOverrideNumber === 'string' || body.testOverrideNumber === null
          ? body.testOverrideNumber
          : undefined,
      plan: typeof body.plan === 'string' ? body.plan : undefined,
    });
  }

  @Get('tickets')
  listTickets() {
    return this.service.listSupportTickets();
  }

  @Patch('tickets/:id/status')
  updateTicketStatus(@Param('id') id: string, @Body() body: { status: string }) {
    if (!body.status) throw new BadRequestException('status is required');
    return this.service.updateSupportTicketStatus(id, body.status);
  }

  // --- Diagnostics ---
  @Get('diagnostics/adapter-test')
  testAdapterPickup(@Query('tenantId') tenantId: string, @Query('softwareType') softwareType: string) {
    if (!tenantId) throw new BadRequestException('tenantId is required');
    if (!softwareType) throw new BadRequestException('softwareType is required');
    return this.adminService.testAdapterPickup(tenantId, softwareType);
  }

  @Get('diagnostics/ai-context')
  getAiDiagnosticContext(@Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId is required');
    return this.adminService.getAiDiagnosticContext(tenantId);
  }

  @Post('diagnostics/sandbox-ping')
  sandboxPing(@Body() body: { tenantId: string; phone: string }) {
    if (!body.tenantId) throw new BadRequestException('tenantId is required');
    if (!body.phone) throw new BadRequestException('phone is required');
    return { success: false, message: 'Sandbox ping not yet implemented' };
  }

  @Get('diagnostics/ai-ping')
  aiPing(@Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId is required');
    return this.adminService.testAiVoicePing(tenantId);
  }

  @Get('diagnostics/run-all')
  async runAllDiagnostics(@Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId is required');
    try {
      return await this.adminService.runFullDiagnostics(tenantId);
    } catch (err: any) {
      console.error('FATAL DIAGNOSTIC ERROR:', err);
      return { success: false, error: err.message, stack: err.stack };
    }
  }
}
