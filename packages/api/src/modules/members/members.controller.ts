import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { resolveUserEmail } from './current-user';
import {
  InviteMemberSchema,
  UpdateMemberSchema,
  type InviteMemberBody,
  type UpdateMemberBody,
} from './members.dto';
import { MembersService } from './members.service';

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
  @UsePipes(new ZodValidationPipe(InviteMemberSchema))
  invite(@Req() req: AdminRequest, @Body() body: InviteMemberBody) {
    return this.members.invite(req.tenantId, {
      email: body.email,
      role: body.role,
      name: body.name,
      invitedBy: resolveUserEmail(req),
    });
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
