import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, asc, and } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants, aiAgentConfigs, routingRules } from '../../db/schema';

type ServiceToggleEntry = {
  enabled?: boolean;
  classes?: Record<string, string>;
};

@Injectable()
export class KnowledgeEndpointService {
  private readonly logger = new Logger(KnowledgeEndpointService.name);

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async generateTenantMarkdown(tenantId: string): Promise<string | null> {
    if (!process.env.DATABASE_URL) {
      this.logger.warn('DATABASE_URL not set — knowledge endpoint cannot resolve tenant');
      return null;
    }

    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      with: { agentConfig: true, routingRules: true },
    });

    if (!tenant || !tenant.isActive) return null;

    const config = tenant.agentConfig;

    const activeRule =
      tenant.routingRules?.find((r) => r.isActiveNow) ??
      (
        await this.db
          .select()
          .from(routingRules)
          .where(and(eq(routingRules.tenantId, tenantId), eq(routingRules.isActiveNow, true)))
          .orderBy(asc(routingRules.priorityOrder))
          .limit(1)
      )[0];

    const services = (config?.serviceToggles ?? {}) as Record<string, ServiceToggleEntry>;
    const serviceLines = Object.entries(services)
      .filter(([, val]) => val?.enabled)
      .map(([name, val]) => {
        const classes = Object.entries(val.classes ?? {})
          .map(([cls, handling]) => `  - ${cls}: ${handling}`)
          .join('\n');
        return classes ? `- ${name}\n${classes}` : `- ${name}`;
      })
      .join('\n');

    const transferTarget = activeRule?.phoneNumber ?? 'the dispatch team';
    const transferLabel = activeRule?.ruleName ?? 'Dispatch';

    return `# ${tenant.companyName}

## Company Information
- Company: ${tenant.companyName}
- Timezone: ${tenant.timezone}
- Status: Active

## Services Offered
${serviceLines || '- Contact dispatch for service availability'}

## Typical Response Times
- Default estimated arrival: ${config?.defaultEtaMins ?? 45} minutes
- Response times vary based on location, traffic, and driver availability

## Call Transfer
- When a caller requests to speak with a human, transfer to: ${transferTarget}
- Transfer label: ${transferLabel}

## Impound Inquiries
- Impound service: ${config?.impoundEnabled ? 'Available — ask for details' : 'Not available at this location'}

## Important Notes
- Always confirm the caller's name, phone number, vehicle details, and location
- For new tow requests, collect: location, vehicle year/make/model/color, issue description, and desired destination
- If you cannot help the caller, transfer them to the dispatch team
`;
  }
}
