// Session 45 — Members + roles RBAC.
//
// Exports MembersService and PermissionGuard so other modules (e.g.
// digital-dispatch) can apply @RequirePermission enforcement. SendGrid comes
// from AdminDigestModule (soft dependency — logs only if unconfigured).

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AcceptInviteController } from './accept-invite.controller';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PermissionGuard } from './permission.guard';

@Module({
  imports: [AuthModule],
  controllers: [MembersController, AcceptInviteController],
  providers: [MembersService, PermissionGuard],
  exports: [MembersService, PermissionGuard],
})
export class MembersModule {}
