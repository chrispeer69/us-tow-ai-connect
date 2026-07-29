import { Module } from '@nestjs/common';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';
import { SuperAdminAuthGuard } from './super-admin-auth.guard';
import { ImpersonationTokenService } from './impersonation-token.service';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [AdminModule],
  controllers: [SuperAdminController],
  providers: [SuperAdminService, SuperAdminAuthGuard, ImpersonationTokenService],
  exports: [SuperAdminService, ImpersonationTokenService],
})
export class SuperAdminModule {}
