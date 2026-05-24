// Session 45 — public invite acceptance (Task 8).
//
// POST /v1/auth/accept-invite — intentionally unguarded: the invitee is not yet
// authenticated. Authorization is the unguessable invite token itself. On
// success the member flips INVITED → ACTIVE.

import { Body, Controller, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AcceptInviteSchema, type AcceptInviteBody } from './members.dto';
import { MembersService } from './members.service';

@Controller('v1/auth')
export class AcceptInviteController {
  constructor(private readonly members: MembersService) {}

  @Post('accept-invite')
  accept(@Body(new ZodValidationPipe(AcceptInviteSchema)) body: AcceptInviteBody) {
    return this.members.acceptInvite(body.token, body.email);
  }
}
