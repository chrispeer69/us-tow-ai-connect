import { Body, Controller, Get, Post, Param, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { SupportService } from './support.service';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { resolveUserEmail } from '../members/current-user';

const CreateTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(255),
  description: z.string().min(1, "Description is required"),
});
type CreateTicketDto = z.infer<typeof CreateTicketSchema>;

const ReplyTicketSchema = z.object({
  message: z.string().min(1, "Message is required"),
});
type ReplyTicketDto = z.infer<typeof ReplyTicketSchema>;

@Controller('v1/admin/support')
@UseGuards(AdminAuthGuard)
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Get()
  async getTickets(@Req() req: AdminRequest) {
    const tickets = await this.service.listTickets(req.tenantId);
    return { status: 'success', data: tickets };
  }

  @Post()
  async createTicket(
    @Req() req: AdminRequest,
    @Body(new ZodValidationPipe(CreateTicketSchema)) body: CreateTicketDto,
  ) {
    const ticket = await this.service.createTicket(req.tenantId, body.subject, body.description);
    return { status: 'success', data: ticket };
  }

  @Get(':id')
  async getTicket(@Req() req: AdminRequest, @Param('id') id: string) {
    const ticket = await this.service.getTicket(req.tenantId, id);
    return { status: 'success', data: ticket };
  }

  @Post(':id/reply')
  async replyToTicket(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReplyTicketSchema)) body: ReplyTicketDto,
  ) {
    const email = resolveUserEmail(req);
    if (!email) {
      throw new UnauthorizedException('User email not found');
    }
    const message = await this.service.replyToTicket(req.tenantId, id, email, body.message);
    return { status: 'success', data: message };
  }
}
