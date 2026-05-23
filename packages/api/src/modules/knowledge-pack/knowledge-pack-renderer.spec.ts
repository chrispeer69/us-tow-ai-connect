import { describe, expect, it } from 'vitest';
import { renderKnowledgePackMarkdown } from './knowledge-pack-renderer';
import type { KnowledgePackV2 } from '@ustow/shared';

const SAMPLE: KnowledgePackV2 = {
  identity: {
    name: 'Acme Towing',
    brands: ['Acme Towing', 'Acme Roadside'],
    slogan: 'Always on the move',
    founded_year: 1995,
    license_numbers: ['OH-12345'],
  },
  services: [
    {
      name: 'Light Duty Tow',
      description: 'Up to 1-ton vehicles',
      price_range_disclaimer: '$75 hook + $4/mi',
      availability_24_7: true,
    },
  ],
  service_areas: [{ county: 'Franklin', cities: ['Columbus', 'Worthington'], zip_prefixes: ['432'] }],
  hours: { regular: { mon_fri: '24/7', sat: '24/7', sun: '24/7' }, after_hours_premium: false },
  fleet: [{ type: 'flatbed', count: 3 }],
  transfer_rules: [{ trigger: 'human_request', phone: '+16145551111', label: 'Dispatch' }],
  pricing_policy: {
    quote_at_dispatch: true,
    accepts_motor_clubs: ['AAA', 'Allstate'],
    cash_accepted: true,
    cards_accepted: true,
  },
  escalation: { manager_phones: ['+16145552222'], escalate_after_min_on_hold: 5 },
};

describe('renderKnowledgePackMarkdown', () => {
  it('renders sections from the structured content', () => {
    const md = renderKnowledgePackMarkdown('Acme Towing', SAMPLE);
    expect(md).toContain('# Acme Towing');
    expect(md).toContain('## Identity');
    expect(md).toContain('Acme Towing, Acme Roadside');
    expect(md).toContain('Founded: 1995');
    expect(md).toContain('Licenses: OH-12345');
    expect(md).toContain('## Hours');
    expect(md).toContain('Mon–Fri: 24/7');
    expect(md).toContain('## Services Offered');
    expect(md).toContain('Light Duty Tow');
    expect(md).toContain('Up to 1-ton vehicles');
    expect(md).toContain('## Service Areas');
    expect(md).toContain('Franklin');
    expect(md).toContain('Columbus, Worthington');
    expect(md).toContain('## Fleet');
    expect(md).toContain('3 × flatbed');
    expect(md).toContain('## Transfer Rules');
    expect(md).toContain('transfer to +16145551111');
    expect(md).toContain('Accepts motor clubs: AAA, Allstate');
    expect(md).toContain('Escalate after 5 minutes');
    expect(md).toContain('+16145552222');
  });

  it('handles empty arrays gracefully', () => {
    const md = renderKnowledgePackMarkdown('Empty Inc', {
      ...SAMPLE,
      services: [],
      service_areas: [],
      fleet: [],
      transfer_rules: [],
      pricing_policy: { ...SAMPLE.pricing_policy, accepts_motor_clubs: [] },
      escalation: { ...SAMPLE.escalation, manager_phones: [] },
    });
    expect(md).toContain('Contact dispatch for service availability');
    expect(md).toContain('Local area');
    expect(md).toContain('Fleet composition not specified');
    expect(md).toContain('No transfer rules configured');
  });
});
