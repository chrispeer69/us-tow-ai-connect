import { describe, expect, it } from 'vitest';
import { renderCallBody, type ScriptContext } from './flip-scripts';

/**
 * Session 74 — the 2026-08-13 review approvals.
 *
 * Two of these protect the caller's ears: an unusable name must never be spoken,
 * and the vocative must vanish rather than degrade into a placeholder. On that
 * day customers were greeted as "there", "Salvage" and "Hexion-Customers".
 */
const base: ScriptContext = {
  repName: 'Emily',
  companyName: 'Roadside Towing',
  motorClub: '',
  callbackNumber: '+16145550000',
  conviniLink: 'https://convini.live',
  customerFirstName: 'Chris',
  vehicle: '2019 Honda Civic',
  pickupLocation: '123 Main St',
  destination: 'Some Other Garage',
  issue: 'a breakdown',
  nearestShop: 'Complete Brake Service',
  nearestShopDistanceMiles: 3,
  nearestShopAddress: '580 W Town St in Columbus',
  rentalsAvailable: true,
  pitchConvini: true,
};

const flip = (over: Partial<ScriptContext> = {}) =>
  renderCallBody('competitor_repair', { ...base, ...over } as ScriptContext);

describe('the offer names the shop address', () => {
  it('puts the street address in offer 1', () => {
    const body = flip();
    expect(body).toContain('Complete Brake Service at 580 W Town St in Columbus');
  });

  it('puts it in offer 2 alongside the written-estimate reassurance', () => {
    const body = flip();
    expect(body).toContain('written estimate before any work starts');
    // Named in tier 2 as well, since that is where the hesitation surfaces.
    expect(body.split('580 W Town St').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('omits the phrase entirely when no address is on file', () => {
    const body = flip({ nearestShopAddress: null });
    expect(body).toContain('Complete Brake Service');
    expect(body).not.toContain(' at ,');
    expect(body).not.toContain('{{nearest_shop_address}}');
  });
});

describe('unusable customer names are never spoken', () => {
  it.each(['there', 'Salvage', 'Hexion-Customers', 'Unknown', '39.9612', 'Dipping'])(
    'does not greet the caller as %s',
    (name) => {
      const body = flip({ customerFirstName: name });
      expect(body).toContain('Am I speaking with the owner of the vehicle?');
      expect(body).not.toContain(`Am I speaking with ${name}?`);
      expect(body).not.toContain(`You're all set, ${name}`);
    },
  );

  it('drops the vocative from the close rather than substituting a placeholder', () => {
    const body = flip({ customerFirstName: 'Salvage' });
    expect(body).toContain("You're all set.");
    expect(body).not.toContain("You're all set, there");
  });

  it('still uses a real first name in both greeting and close', () => {
    const body = flip({ customerFirstName: 'Chris' });
    expect(body).toContain('Am I speaking with Chris?');
    expect(body).toContain("You're all set, Chris.");
  });
});
