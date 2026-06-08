import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRequest } from '../admin/admin.types';
import { SupportService } from './support.service';
import { z } from 'zod';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';

const CreateTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(255),
  description: z.string().min(1, "Description is required"),
});
type CreateTicketDto = z.infer<typeof CreateTicketSchema>;

@Controller('v1/admin/support')
@UseGuards(JwtAuthGuard)
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
}
