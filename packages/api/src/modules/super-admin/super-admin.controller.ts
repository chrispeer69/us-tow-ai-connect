import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ImpersonateSchema, type ImpersonateBody } from '@ustow/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SuperAdminAuthGuard, type SuperAdminRequest } from './super-admin-auth.guard';
import { SuperAdminService } from './super-admin.service';

@Controller('v1/super-admin')
@UseGuards(SuperAdminAuthGuard)
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

  @Get('tenants')
  listTenants() {
    return this.service.listTenants();
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.service.getTenant(id);
  }

  @Post('impersonate')
  @UsePipes(new ZodValidationPipe(ImpersonateSchema))
  impersonate(@Req() req: SuperAdminRequest, @Body() body: ImpersonateBody) {
    return this.service.startImpersonation(req.superAdminEmail, body.targetTenantId);
  }

  @Post('impersonate/stop')
  stopImpersonation(@Req() req: SuperAdminRequest, @Body() body: { token: string }) {
    return this.service.stopImpersonation(req.superAdminEmail, body.token);
  }
}
