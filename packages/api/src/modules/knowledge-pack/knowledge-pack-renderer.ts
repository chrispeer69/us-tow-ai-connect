import type { KnowledgePackV2 } from '@ustow/shared';

export function renderKnowledgePackMarkdown(name: string, kp: KnowledgePackV2): string {
  const identity = kp.identity;
  const brands =
    identity.brands && identity.brands.length > 0
      ? `\n- Operating brands: ${identity.brands.join(', ')}`
      : '';
  const slogan = identity.slogan ? `\n- Slogan: "${identity.slogan}"` : '';
  const founded = identity.founded_year ? `\n- Founded: ${identity.founded_year}` : '';
  const license =
    identity.license_numbers && identity.license_numbers.length > 0
      ? `\n- Licenses: ${identity.license_numbers.join(', ')}`
      : '';

  const servicesBlock =
    kp.services.length > 0
      ? kp.services
          .map((s) => {
            const avail = s.availability_24_7 ? '24/7' : 'business hours';
            const disclaimer = s.price_range_disclaimer
              ? `\n    Price disclaimer: ${s.price_range_disclaimer}`
              : '';
            const desc = s.description ? `\n    ${s.description}` : '';
            return `- **${s.name}** (${avail})${desc}${disclaimer}`;
          })
          .join('\n')
      : '- Contact dispatch for service availability';

  const areasBlock =
    kp.service_areas.length > 0
      ? kp.service_areas
          .map((a) => {
            const cities = a.cities.length > 0 ? `\n    Cities: ${a.cities.join(', ')}` : '';
            const zips =
              a.zip_prefixes.length > 0 ? `\n    Zip prefixes: ${a.zip_prefixes.join(', ')}` : '';
            return `- **${a.county}**${cities}${zips}`;
          })
          .join('\n')
      : '- Local area';

  const hours = kp.hours.regular;
  const afterHours = kp.hours.after_hours_premium
    ? '\n- After-hours premium pricing applies'
    : '';

  const fleetBlock =
    kp.fleet.length > 0
      ? kp.fleet.map((v) => `- ${v.count} × ${v.type}`).join('\n')
      : '- Fleet composition not specified';

  const transfersBlock =
    kp.transfer_rules.length > 0
      ? kp.transfer_rules
          .map((t) => `- **${t.trigger}**: transfer to ${t.phone} (${t.label})`)
          .join('\n')
      : '- No transfer rules configured';

  const pricing = kp.pricing_policy;
  const motorClubs =
    pricing.accepts_motor_clubs.length > 0
      ? `\n- Accepts motor clubs: ${pricing.accepts_motor_clubs.join(', ')}`
      : '';
  const payment =
    [pricing.cash_accepted ? 'Cash' : null, pricing.cards_accepted ? 'Cards' : null]
      .filter(Boolean)
      .join(', ') || 'See dispatcher';

  const escal = kp.escalation;
  const managers =
    escal.manager_phones.length > 0
      ? `\n- Manager phones: ${escal.manager_phones.join(', ')}`
      : '';

  return `# ${name}

## Identity
- Company: ${identity.name || name}${brands}${slogan}${founded}${license}

## Hours
- Mon–Fri: ${hours.mon_fri}
- Sat: ${hours.sat}
- Sun: ${hours.sun}${afterHours}

## Services Offered
${servicesBlock}

## Service Areas
${areasBlock}

## Fleet
${fleetBlock}

## Transfer Rules
${transfersBlock}

## Pricing
- Quote at dispatch: ${pricing.quote_at_dispatch ? 'Yes' : 'No'}
- Accepted payment: ${payment}${motorClubs}

## Escalation
- Escalate after ${escal.escalate_after_min_on_hold} minutes on hold${managers}
`;
}
