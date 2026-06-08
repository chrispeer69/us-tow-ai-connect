import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { supportTickets } from '../../db/schema';

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
}
