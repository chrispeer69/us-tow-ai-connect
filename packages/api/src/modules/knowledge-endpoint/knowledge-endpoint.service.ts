import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, asc, and } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants, aiAgentConfigs, routingRules } from '../../db/schema';

type ServiceToggleEntry = {
  enabled?: boolean;
  classes?: Record<string, string>;
};

interface KnowledgePackBlob {
  brands?: string[];
  service_area?: { region?: string; counties?: string[] };
  hours?: string;
  services?: Array<{ key: string; label: string }>;
  transfer_phone?: string;
  transfer_label?: string;
  impound_policy?: string;
  default_eta_minutes?: number;
  payment_methods?: string[];
  agent_voice?: string;
  agent_greeting?: string;
}

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
    const kp = ((config?.knowledgePack ?? {}) as KnowledgePackBlob) || {};

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

    // Prefer the knowledge-pack service list (richer labels). Fall back to
    // service_toggles if no KP services are present. Dedupe so a service
    // present in both blobs doesn't render twice.
    const kpServiceKeys = new Set((kp.services ?? []).map((s) => s.key));
    const kpServices = (kp.services ?? []).map(
      (s) => `- ${s.label} (${s.key})`,
    );
    const toggleServices = Object.entries(
      (config?.serviceToggles ?? {}) as Record<string, ServiceToggleEntry>,
    )
      .filter(([key, val]) => val?.enabled && !kpServiceKeys.has(key))
      .map(([name]) => `- ${name}`);

    const serviceBlock =
      [...kpServices, ...toggleServices].join('\n') ||
      '- Contact dispatch for service availability';

    const transferTarget =
      kp.transfer_phone ?? activeRule?.phoneNumber ?? 'the dispatch team';
    const transferLabel =
      kp.transfer_label ?? activeRule?.ruleName ?? 'Dispatch';

    const brandsLine =
      kp.brands && kp.brands.length > 0
        ? `- Brands operating under this tenant: ${kp.brands.join(', ')}`
        : '';

    const serviceAreaBlock = kp.service_area
      ? `## Service Area
- Region: ${kp.service_area.region ?? 'Local'}
- Counties served: ${(kp.service_area.counties ?? []).join(', ') || 'Local area'}`
      : '';

    const hoursLine = kp.hours ?? '24/7';
    const eta = kp.default_eta_minutes ?? config?.defaultEtaMins ?? 45;

    const paymentBlock =
      kp.payment_methods && kp.payment_methods.length > 0
        ? `## Accepted Payment Methods
${kp.payment_methods.map((m) => `- ${m}`).join('\n')}`
        : '';

    const greeting = kp.agent_greeting ?? config?.greetingMessage ?? 'Thank you for calling.';
    const impoundLine = kp.impound_policy
      ? kp.impound_policy
      : config?.impoundEnabled
        ? 'Available — ask for details'
        : 'Not available at this location';

    return `# ${tenant.companyName}

## Company Information
- Company: ${tenant.companyName}
- Timezone: ${tenant.timezone}
- Hours of operation: ${hoursLine}
- Status: Active
${brandsLine ? `${brandsLine}\n` : ''}
## Greeting
${greeting}

${serviceAreaBlock}

## Services Offered
${serviceBlock}

## Typical Response Times
- Default estimated arrival: ${eta} minutes
- Response times vary based on location, traffic, and driver availability

## Call Transfer
- When a caller requests to speak with a human, transfer to: ${transferTarget}
- Transfer label: ${transferLabel}

## Impound Inquiries
- ${impoundLine}

${paymentBlock}

## Important Notes
- Always confirm the caller's name, phone number, vehicle details, and location
- For new tow requests, collect: location, vehicle year/make/model/color, issue description, and desired destination
- If you cannot help the caller, transfer them to the dispatch team
`;
  }
}
