import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { SuperAdminAuthGuard } from './super-admin-auth.guard';
import { SuperAdminService } from './super-admin.service';

@Controller('v1/super-admin')
@UseGuards(SuperAdminAuthGuard)
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

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
}
