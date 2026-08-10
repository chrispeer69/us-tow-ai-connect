import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { resolveUserEmail } from './current-user';
import {
  InviteMemberSchema,
  SetMemberPasswordSchema,
  UpdateMemberSchema,
  type InviteMemberBody,
  type SetMemberPasswordBody,
  type UpdateMemberBody,
} from './members.dto';
import { MembersService, type ActingUser } from './members.service';

@Controller('v1/admin/members')
@UseGuards(AdminAuthGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@Req() req: AdminRequest) {
    return this.members.listByTenant(req.tenantId);
  }

  /** Current user + their effective permission keys. */
  @Get('me')
  me(@Req() req: AdminRequest) {
    return this.members.currentUser(req.tenantId, resolveUserEmail(req));
  }

  @Post()
  async invite(
    @Req() req: AdminRequest,
    @Body(new ZodValidationPipe(InviteMemberSchema)) body: InviteMemberBody,
  ) {
    // Handing out a password is credential issuance, not an invitation — gate
    // it the same way as a reset. A plain invite keeps its existing behaviour.
    if (body.password) {
      await this.members.assertCanManageCredentials(req.tenantId, req.user as ActingUser);
    }
    return this.members.invite(req.tenantId, {
      email: body.email,
      role: body.role,
      name: body.name,
      password: body.password,
      invitedBy: resolveUserEmail(req),
    });
  }

  /** Owner-only: set or reset a member's sign-in password. */
  @Post(':id/password')
  async setPassword(
    @Req() req: AdminRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SetMemberPasswordSchema)) body: SetMemberPasswordBody,
  ) {
    await this.members.assertCanManageCredentials(req.tenantId, req.user as ActingUser);
    return this.members.setPassword(
      req.tenantId,
      id,
      body.password,
      (req.user as ActingUser)?.email ?? resolveUserEmail(req),
    );
  }

  @Patch(':id')
  update(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateMemberSchema)) body: UpdateMemberBody,
  ) {
    return this.members.update(req.tenantId, id, body);
  }

  @Delete(':id')
  revoke(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.members.revoke(req.tenantId, id);
  }
}
