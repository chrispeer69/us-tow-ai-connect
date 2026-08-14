import { describe, expect, it } from 'vitest';
import { renderCallBody, type ScriptContext } from './flip-scripts';

/**
 * Session 74 — the conditional offer.
 *
 * Eligibility is decided before the call from a map lookup, but the answer
 * arrives during it: the script already asks whether the destination is a
 * repair shop. Over the 10 days to 2026-08-13, 142 calls (17% of volume) had an
 * unresolved destination and a 4% eligibility rate, and a customer answering
 * "repair shop" met an agent that had nothing to offer and standing orders never
 * to invent one.
 *
 * The rule these tests protect: an offer appears ONLY for an unresolved
 * destination with a shop in range, and it is gated behind the customer's own
 * confirmation. Every other route into Scenario C keeps the hard no-offer text.
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
  destination: 'unconfirmed',
  issue: 'a breakdown',
  rentalsAvailable: true,
  pitchConvini: true,
};

const renderUnknown = (ctx: Partial<ScriptContext>) =>
  renderCallBody('unknown', { ...base, ...ctx } as ScriptContext);

const NO_OFFER_LINE = 'THERE IS NO REPAIR-SHOP OFFER ON THIS CALL';

describe('conditional offer on unresolved destinations', () => {
  it('offers nothing when no conditional shop is supplied', () => {
    const body = renderUnknown({});

    expect(body).toContain(NO_OFFER_LINE);
    // Not "free diagnostic" — the refusal itself names the thing it forbids.
    // The offer question is what must be absent.
    expect(body).not.toContain('Would you like me to switch the drop-off');
  });

  it('carries a gated offer when the destination is unknown and a shop is in range', () => {
    const body = renderUnknown({
      conditionalShop: 'Complete Brake Service',
      conditionalShopDistanceMiles: 3,
    });

    // The hard blanket refusal is replaced, not merely appended to.
    expect(body).not.toContain(NO_OFFER_LINE);
    expect(body).toContain('THE DESTINATION ON FILE IS UNCONFIRMED');
    expect(body).toContain('ONLY IF the customer confirms');
    expect(body).toContain('Complete Brake Service');
    expect(body).toContain('free VIP visual mechanical diagnostic');
  });

  // The whole risk of this change is an agent that offers before it has asked.
  it('forbids naming the shop before the customer confirms a repair destination', () => {
    const body = renderUnknown({
      conditionalShop: 'Complete Brake Service',
      conditionalShopDistanceMiles: 3,
    });

    expect(body).toContain(
      'Do not mention any shop, discount or diagnostic before the customer has answered it',
    );
    expect(body).toContain('there is NO offer on this call');
    expect(body).toContain('Do not make a second or third offer on this call');
  });

  it('still requires an unambiguous yes before changing the destination', () => {
    const body = renderUnknown({
      conditionalShop: 'Complete Brake Service',
      conditionalShopDistanceMiles: 3,
    });

    expect(body).toContain('is that a yes to sending the driver to Complete Brake Service instead?');
    expect(body).toContain('Never infer a destination change');
  });

  it('omits a distance claim when the shop rounds to zero miles', () => {
    const body = renderUnknown({
      conditionalShop: 'Complete Brake Service',
      conditionalShopDistanceMiles: 0,
    });

    expect(body).toContain('Complete Brake Service');
    expect(body).not.toContain('zero miles');
  });

  it('treats a blank shop name as no shop', () => {
    const body = renderUnknown({ conditionalShop: '   ', conditionalShopDistanceMiles: 4 });

    expect(body).toContain(NO_OFFER_LINE);
  });
});
