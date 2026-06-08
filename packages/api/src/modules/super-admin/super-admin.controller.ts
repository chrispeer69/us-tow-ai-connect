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

  @Get('tickets')
  listTickets() {
    return this.service.listSupportTickets();
  }
}
