import { describe, it, expect } from 'vitest';
import {
  renderConfirmDetails,
  renderConviniPitch,
  renderOffer1,
  renderOffer2,
  renderOffer3,
} from './flip-scripts';

describe('flip-scripts', () => {
  it('renders confirm-details with all variables substituted', () => {
    const body = renderConfirmDetails({
      customerName: 'Pat',
      companyName: 'Roadside Towing',
      vehicle: '2019 Honda Civic',
      pickupLocation: 'I-71 South, MM 42',
      destination: '123 Main St',
    });
    expect(body).toContain('Hi Pat');
    expect(body).toContain('Roadside Towing');
    expect(body).toContain('2019 Honda Civic');
    expect(body).toContain('I-71 South, MM 42');
    expect(body).toContain('123 Main St');
    expect(body).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('Offer 1 mentions free diagnostic + 10% off + rentals when enabled', () => {
    const body = renderOffer1({
      ourShopName: "Wayne's Westerville",
      distanceMilesSaved: 2.3,
      rentalsAvailable: true,
    });
    expect(body).toContain("Wayne's Westerville");
    expect(body).toContain('10 percent');
    expect(body).toContain('2.3 miles');
  });

  it('Offer 1 omits rental line when rentalsAvailable=false', () => {
    const body = renderOffer1({
      ourShopName: "Wayne's Westerville",
      distanceMilesSaved: null,
      rentalsAvailable: false,
    });
    expect(body).not.toMatch(/rental/i);
  });

  it('Offer 2 mentions same-day priority + 1-hour estimate', () => {
    const body = renderOffer2({
      ourShopName: 'Hilliard Auto',
      distanceMilesSaved: null,
      rentalsAvailable: true,
    });
    expect(body).toContain('same-day priority');
    expect(body).toContain('one hour');
  });

  it('Offer 3 mentions $50 + Google review', () => {
    const body = renderOffer3({
      ourShopName: 'Petty\u2019s Auto',
      distanceMilesSaved: null,
      rentalsAvailable: true,
    });
    expect(body).toContain('50 dollar');
    expect(body.toLowerCase()).toContain('google review');
  });

  it('CONVINI soft pitch is short and includes app name', () => {
    const body = renderConviniPitch({ intensity: 'soft', rentalsAvailable: true });
    expect(body).toContain('CONVINI');
    expect(body.length).toBeLessThan(250);
  });

  it('CONVINI medium pitch optionally mentions our 2 body shops', () => {
    const body = renderConviniPitch({
      intensity: 'medium',
      rentalsAvailable: true,
      ourBodyShopMention: { shop1: 'Excite Collision', shop2: 'T&C Body' },
    });
    expect(body).toContain('Excite Collision');
    expect(body).toContain('T&C Body');
  });

  it('CONVINI hard pitch is the longest of the three', () => {
    const soft = renderConviniPitch({ intensity: 'soft', rentalsAvailable: true });
    const medium = renderConviniPitch({ intensity: 'medium', rentalsAvailable: true });
    const hard = renderConviniPitch({ intensity: 'hard', rentalsAvailable: true });
    expect(hard.length).toBeGreaterThan(soft.length);
    expect(hard.length).toBeGreaterThan(medium.length);
  });
});
