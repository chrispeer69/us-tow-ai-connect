import { describe, it, expect } from 'vitest';
import {
  renderCallBody,
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

  it('Offer 1 mentions free diagnostic + 10% off and action-framed routing', () => {
    const body = renderOffer1({
      ourShopName: "Wayne's Westerville",
      distanceMilesSaved: 2.3,
      rentalsAvailable: true,
    });
    expect(body).toContain("Wayne's Westerville");
    expect(body).toContain('10 percent');
    expect(body).toContain('2.3 miles');
    expect(body).toContain("Would you like me to switch the drop-off to Wayne's Westerville?");
    expect(body).not.toContain("I'll send it there");
    expect(body).not.toContain('Would you like me to make that switch');
  });

  it('Offer 1 omits rental line when rentalsAvailable=false', () => {
    const body = renderOffer1({
      ourShopName: "Wayne's Westerville",
      distanceMilesSaved: null,
      rentalsAvailable: false,
    });
    expect(body).not.toMatch(/rental/i);
  });

  it('Offer 2 stacks speed, written estimate, and original discount', () => {
    const body = renderOffer2({
      ourShopName: 'Hilliard Auto',
      distanceMilesSaved: null,
      rentalsAvailable: true,
    });
    expect(body).toContain('look at your car quickly');
    expect(body).toContain('written estimate');
    expect(body).toContain('10 percent');
  });

  it('Offer 3 applies the $50 credit to this repair and does not mention reviews', () => {
    const body = renderOffer3({
      ourShopName: 'Petty\u2019s Auto',
      distanceMilesSaved: null,
      rentalsAvailable: true,
    });
    expect(body).toContain('50 dollar');
    expect(body).toContain('this repair');
    expect(body.toLowerCase()).not.toContain('google review');
    expect(body.toLowerCase()).not.toContain('gift card');
  });

  it('CONVINI soft pitch is send-first and does not ask permission', () => {
    const body = renderConviniPitch({ intensity: 'soft', rentalsAvailable: true });
    expect(body).toContain('CONVINI');
    expect(body).toContain("I'm texting you");
    expect(body).not.toContain('Can I text you');
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

  it('CONVINI hard pitch stays send-first', () => {
    const soft = renderConviniPitch({ intensity: 'soft', rentalsAvailable: true });
    const medium = renderConviniPitch({ intensity: 'medium', rentalsAvailable: true });
    const hard = renderConviniPitch({ intensity: 'hard', rentalsAvailable: true });
    expect(soft).toContain("I'm texting you");
    expect(medium).toContain("I'm texting you");
    expect(hard).toContain("I'm texting you");
    expect(hard).not.toContain('Did it come through');
  });

  it('adds winch-out recovery and photo guidance to the call body', () => {
    const body = renderCallBody('unknown', {
      repName: 'Emily',
      companyName: 'Roadside Towing',
      motorClub: '',
      callbackNumber: '+15551234567',
      conviniLink: 'https://convini.live',
      customerFirstName: 'Pat',
      vehicle: '2017 Ford Escape',
      pickupLocation: 'I-70 near exit 101',
      destination: 'your location',
      issue: 'a stuck or off-road recovery',
      issueSubcategory: 'winch_out',
      rentalsAvailable: true,
    });

    expect(body).toContain('listed as a winch-out');
    expect(body).toContain('pulled back onto solid ground');
    expect(body).toContain('have a few photos of the situation ready');
    expect(body).toContain('I have the service location as I-70 near exit 101');
    expect(body).toContain('Do not ask for or assume a delivery destination on winch-out calls');
    expect(body).not.toContain('is there anywhere else it needs to be towed');
    expect(body).not.toContain('headed to your location as planned');
    expect(body).toContain('headed to the service location as planned');
  });

  it('does not confirm a delivery destination when no separate destination exists', () => {
    const body = renderCallBody('unknown', {
      repName: 'Emily',
      companyName: 'Roadside Towing',
      motorClub: '',
      callbackNumber: '+15551234567',
      conviniLink: 'https://convini.live',
      customerFirstName: 'Pat',
      vehicle: '2017 Ford Escape',
      pickupLocation: '123 Main St',
      destination: 'your destination',
      issue: 'a jump start',
      issueSubcategory: 'jump_start',
      rentalsAvailable: true,
    });

    expect(body).toContain('I do not have a separate tow destination listed');
    expect(body).toContain('service at 123 Main St');
    expect(body).not.toContain('vehicle being towed to your destination');
    expect(body).toContain('headed to the service location as planned');
  });

  it('treats matching pickup and destination as one service location', () => {
    const body = renderCallBody('unknown', {
      repName: 'Emily',
      companyName: 'Roadside Towing',
      motorClub: '',
      callbackNumber: '+15551234567',
      conviniLink: 'https://convini.live',
      customerFirstName: 'Pat',
      vehicle: '2017 Ford Escape',
      pickupLocation: '123 Main Street',
      destination: '123 Main St.',
      issue: 'a fuel delivery',
      issueSubcategory: 'fuel_delivery',
      rentalsAvailable: true,
    });

    expect(body).toContain('I do not have a separate tow destination listed');
    expect(body).not.toContain('vehicle being towed to 123 Main St.');
  });
});
