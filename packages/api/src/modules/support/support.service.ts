import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { desc, eq, and, asc, inArray } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { supportTickets, supportTicketMessages } from '../../db/schema';

@Injectable()
export class SupportService {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async listTickets(tenantId: string) {
    return this.db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.tenantId, tenantId))
      .orderBy(desc(supportTickets.createdAt));
  }

  async createTicket(tenantId: string, subject: string, description: string) {
    const openTickets = await this.db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.tenantId, tenantId),
          inArray(supportTickets.status, ['open', 'in_progress'])
        )
      );
      
    if (openTickets.length >= 3) {
      throw new BadRequestException('You have reached the maximum of 3 open support tickets.');
    }

    const [ticket] = await this.db
      .insert(supportTickets)
      .values({
        tenantId,
        subject,
        description,
      })
      .returning();
    return ticket;
  }

  async getTicket(tenantId: string, ticketId: string) {
    const [ticket] = await this.db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenantId)));
    
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const messages = await this.db
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, ticketId))
      .orderBy(asc(supportTicketMessages.createdAt));

    return { ...ticket, messages };
  }

  async replyToTicket(tenantId: string, ticketId: string, email: string, message: string) {
    const [ticket] = await this.db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenantId)));
    
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      const daysSinceUpdate = (Date.now() - ticket.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate > 3) {
        throw new BadRequestException('Ticket is closed and cannot be reopened after 3 days. Please open a new ticket.');
      }
      
      // Reopen ticket
      await this.db
        .update(supportTickets)
        .set({ status: 'open', updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
    } else {
      await this.db
        .update(supportTickets)
        .set({ updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
    }

    const lastMessage = await this.db
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, ticketId))
      .orderBy(desc(supportTicketMessages.createdAt))
      .limit(1);

    if (lastMessage.length === 0 || lastMessage[0].senderType === 'tenant') {
      throw new BadRequestException('Support will get back to solve your issue and ask questions to get more details if needed.');
    }

    const [newMessage] = await this.db
      .insert(supportTicketMessages)
      .values({
        ticketId,
        senderType: 'tenant',
        senderEmail: email,
        message,
      })
      .returning();

    return newMessage;
  }
}
