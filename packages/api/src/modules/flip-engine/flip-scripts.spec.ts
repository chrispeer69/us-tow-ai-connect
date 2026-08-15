import { describe, it, expect } from 'vitest';
import {
  pickScriptVariant,
  renderCallBody,
  renderConfirmDetails,
  renderConviniPitch,
  renderOffer1,
  renderOffer2,
  renderOffer3,
} from './flip-scripts';

describe('flip-scripts — 2026-08-11 review fixes', () => {
  const base = {
    repName: 'Emily',
    companyName: 'Roadside Towing',
    motorClub: '',
    callbackNumber: '+15551234567',
    conviniLink: 'https://convini.live',
    customerFirstName: 'Pat',
    vehicle: '2017 Ford Escape',
    pickupLocation: 'I-70 near exit 101',
    destination: 'Firestone on Main',
    issue: 'a check engine light',
    nearestShop: "Wayne's Westerville",
    nearestShopDistanceMiles: 2,
    rentalsAvailable: true,
  };

  it('never says "just zero miles away"', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      nearestShopDistanceMiles: 0,
    });
    expect(body).not.toMatch(/just 0 miles/i);
    expect(body).not.toMatch(/0 miles away/i);
    expect(body).toContain("Wayne's Westerville");
  });

  it('says "about N miles" rather than "just N miles" for distant shops', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      nearestShopDistanceMiles: 9,
    });
    expect(body).toContain('about 9 miles');
    expect(body).not.toMatch(/just 9 miles/i);
  });

  it('keeps "just" for a genuinely close shop', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('just 2 miles');
  });

  it('asks for the destination instead of improvising when it is missing', () => {
    const body = renderCallBody('competitor_repair', { ...base, destination: '' });
    expect(body).toContain('can you tell me the name or address of the shop this is going to?');
    expect(body).toContain('DESTINATION IS MISSING');
    expect(body).not.toMatch(/\{\{[^}]*\}\}/);
  });

  it('suppresses every offer when no partner shop is on file', () => {
    const body = renderCallBody('competitor_repair', { ...base, nearestShop: null });
    expect(body).toContain('There is NO partner shop on file');
    // Assert the OFFER is absent, not the words — the suppression instruction
    // itself legitimately names the things the agent must not say.
    expect(body).not.toContain('one quick option and then');
    expect(body).not.toContain('up to 10 percent off parts and labor');
    expect(body).not.toContain("can I ask what's taking you to");
    expect(body).not.toContain('50 dollar credit');
  });

  it('suppresses the mechanical-diagnostic offer on collision work', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      issueSubcategory: 'collision',
      issue: 'a collision',
    });
    expect(body).toContain('collision, body or glass work');
    expect(body).not.toContain('up to 10 percent off parts and labor');
  });

  it('suppresses the offer on glass damage even without a subcategory', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      issue: 'a cracked windshield',
    });
    expect(body).toContain('collision, body or glass work');
  });

  it('front-loads offer 1 with the ask before the terms', () => {
    const body = renderCallBody('competitor_repair', base);
    const offerIdx = body.indexOf('one quick option and then');
    const termsIdx = body.indexOf('up to 10 percent off parts and labor');
    expect(offerIdx).toBeGreaterThan(-1);
    expect(offerIdx).toBeLessThan(termsIdx);
    expect(body).toContain('Want me to send the driver there instead, or keep Firestone on Main?');
  });

  // Session 75 — dispatch intake. These questions produce the AI Notes block a
  // driver actually reads, replacing motor-club notes that get deleted on
  // arrival.
  it('asks the three intake questions the driver needs', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('nose-in or nose-out');
    expect(body).toContain('are all four tires up, or is any of them flat');
    expect(body).toContain('will you be there to meet the driver with the keys');
  });

  it('asks color and drivetrain open rather than confirming them', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('What color is it?');
    expect(body).toContain('front-wheel, rear-wheel or all-wheel drive');
    // The ticket is ~50% accurate on these, so a confirm invites a reflexive yes.
    expect(body).toContain('do NOT read the color or drivetrain off the ticket');
  });

  // The keys answer can stop a truck rolling. It must not be answered with
  // invented policy — the agent has improvised policy on live calls before.
  it('treats keys as a gate and forbids improvising the release process', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('GATE');
    expect(body).toContain('do NOT improvise what happens next');
    expect(body).toContain('do not describe a release form');
    expect(body).toContain('our office will call you to confirm the details');
  });

  it('runs intake on both arms, so it cannot confound the 3.0 experiment', () => {
    for (const scriptVariant of ['control', 'reframe'] as const) {
      const body = renderCallBody('competitor_repair', { ...base, scriptVariant });
      expect(body).toContain('DISPATCH INTAKE');
      expect(body).toContain('nose-in or nose-out');
    }
  });

  it('asks intake before pitching the offer', () => {
    const body = renderCallBody('competitor_repair', base);
    const keys = body.indexOf('meet the driver with the keys');
    const offer = body.indexOf('We work with');
    expect(keys).toBeGreaterThan(-1);
    expect(offer).toBeGreaterThan(keys);
  });

  // Session 75 — tire jobs, Chris 2026-08-15. The flip is unchanged (a flat
  // still tows to the closest network shop); the OFFER changes, because a free
  // mechanical diagnostic answers a question a flat-tire customer did not ask.
  const tire = { ...base, issue: 'a flat tire', issueSubcategory: 'single_tire_issue' as const };

  it('offers brakes, tire condition and fluids on a tire job', () => {
    const body = renderCallBody('competitor_repair', tire);
    expect(body).toContain('free visual brake inspection and tire condition assessment');
    expect(body).toContain('check and top off your fluids');
    // The standard mechanical pitch must not appear — that was the 08-14 defect.
    expect(body).not.toContain('visual mechanical diagnostic');
    expect(body).not.toContain('$179');
  });

  it('moves the 10 percent to the NEXT visit on a tire job', () => {
    const body = renderCallBody('competitor_repair', tire);
    expect(body).toContain('10 percent off your next set of tires, brake job, or oil change and rotation');
    expect(body).not.toContain('up to 10 percent off parts and labor');
    // And says so explicitly, so the agent cannot collapse the two.
    expect(body).toContain("it is NOT a discount on today's repair");
  });

  it('forbids promising how fast a tire will be fixed', () => {
    const body = renderCallBody('competitor_repair', tire);
    expect(body).toContain('Never promise how fast the tire will be fixed');
  });

  it('still flips a tire job to the nearest network shop', () => {
    const body = renderCallBody('competitor_repair', tire);
    expect(body).toContain("Wayne's Westerville");
    expect(body).toContain('Want me to send the driver there instead');
  });

  it('applies the tire offer to a full set as well as a single flat', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      issue: 'needs all four tires',
      issueSubcategory: 'full_tire_set',
    });
    expect(body).toContain('free visual brake inspection and tire condition assessment');
  });

  it('leaves the standard offer untouched on non-tire jobs', () => {
    const body = renderCallBody('competitor_repair', { ...base, issueSubcategory: 'no_start' });
    expect(body).toContain('visual mechanical diagnostic');
    expect(body).toContain('up to 10 percent off parts and labor');
    expect(body).not.toContain('brake inspection and tire condition assessment');
  });

  it('keeps offer 2 consistent with the tire offer', () => {
    const body = renderCallBody('competitor_repair', tire);
    expect(body).toContain('free brake and tire check plus the 10 percent off your next');
    expect(body).not.toContain('free VIP diagnostic and up to 10 percent off parts and labor');
  });

  // Session 75 — the tow home, Chris 2026-08-15. Real capability, but the
  // second tow is requested and paid for by the customer. The failure mode is
  // implying it is free or included.
  it('offers the tow home only as an authorized answer, never as a promise', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('you can request a tow home');
    expect(body).toContain('through your motor club again, or straight from the Roadside App');
    expect(body).toContain('Do NOT say or imply that tow is free, included, or covered');
    expect(body).toContain('Do NOT quote a price for it');
    // Coverage is between the customer and their club — not ours to state.
    expect(body).toContain('that is between them and their club');
  });

  it('mentions the tow home on both arms, so it cannot confound the A/B', () => {
    for (const scriptVariant of ['control', 'reframe'] as const) {
      const body = renderCallBody('competitor_repair', { ...base, scriptVariant });
      expect(body).toContain('you can request a tow home');
    }
  });

  it('keeps the tow home out of the spoken script — it is answered, not pitched', () => {
    const body = renderCallBody('competitor_repair', base);
    const spoken = body.split('\n').filter((l) => l.startsWith('AI:')).join('\n');
    expect(spoken).not.toContain('tow home');
  });

  // Session 75 — rentals, Chris 2026-08-15. Full coverage insurance is a hard
  // requirement and offering a rental someone cannot take is worse than not
  // offering one, so it is stated while offering rather than at handover.
  it('states the full coverage requirement whenever it offers a rental', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('RENTAL CARS');
    expect(body).toContain("driver's license and full coverage insurance");
    expect(body).toContain('State the full coverage requirement EVERY time');
  });

  it('offers all three rental delivery options and quotes no rate', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('bring one to the shop, or out to your home');
    expect(body).toContain('paperwork digitally');
    expect(body).toContain('rental location on Westerville Road');
    // Pricing lives in the app, so there is no number to get wrong.
    expect(body).toContain('rental offers are all in the Roadside App');
    expect(body).toContain('Do NOT quote a rate');
    expect(body).toContain('do NOT promise a particular vehicle');
  });

  // 3.2 — the ride is the pitch. Chris: 'come to Wayne's and we'll get you
  // home'. It answers the distance objection, which a discount cannot, and it
  // is only true at our shops.
  it('offers the ride in every offer-1 variant', () => {
    for (const extra of [
      { issue: 'a breakdown' },
      { issue: 'a breakdown', alternateShops: [{ name: "Wayne's Columbus", distanceMiles: 6 }] },
      { issue: 'a flat tire', issueSubcategory: 'single_tire_issue' as const },
    ]) {
      const body = renderCallBody('competitor_repair', { ...base, ...extra });
      expect(body).toContain('if you need a ride home from there, we can sort that too');
    }
  });

  it('says can, not will — the ride is not free to everyone', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('we can sort that too');
    expect(body).not.toContain("we'll get you home");
  });

  it('runs the ride from our shops only, and refuses it out of network', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('The ride service runs from OUR partner shops ONLY');
    expect(body).toContain('you may NOT offer one, and must not hint that we might');
  });

  it('may use the ride against a distance objection, framed as a gain', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('You MAY raise the ride as a reason to come to us');
    expect(body).toContain('Never say it as a threat');
  });

  // Session 75 audit. The conditional offer makes a real destination change
  // and had no consent gate, and rendered 'certified shopabout 4 miles'.
  it('gates the conditional offer on explicit consent too', () => {
    const body = renderCallBody('unknown', {
      ...base,
      nearestShop: null,
      conditionalShop: "Wayne's Powell",
      conditionalShopDistanceMiles: 4,
    });
    expect(body).toContain('Would you like me to switch the drop-off to');
    expect(body).toContain('is that a yes to sending the driver to');
    expect(body).toContain('Only log a destination change on an explicit yes');
  });

  it('spaces the conditional distance phrase correctly', () => {
    const body = renderCallBody('unknown', {
      ...base,
      nearestShop: null,
      conditionalShop: "Wayne's Powell",
      conditionalShopDistanceMiles: 4,
    });
    expect(body).toContain('certified shop, about 4 miles from you');
    expect(body).not.toMatch(/shopabout|shopjust/);
  });

  // 3.0 A/B split.
  it('splits variants stably and roughly evenly', () => {
    // Same seed must always give the same arm — a retry that switched arms
    // would count one conversation under two scripts.
    expect(pickScriptVariant('job-abc')).toBe(pickScriptVariant('job-abc'));
    expect(pickScriptVariant('')).toBe('control');
    expect(pickScriptVariant(null)).toBe('control');

    let reframe = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (pickScriptVariant(`0f8b2c1e-4a7d-4c2b-9e11-${String(i).padStart(12, '0')}`) === 'reframe') {
        reframe++;
      }
    }
    // Not exactly 50/50, but nowhere near a degenerate split.
    expect(reframe).toBeGreaterThan(n * 0.4);
    expect(reframe).toBeLessThan(n * 0.6);
  });

  it('control arm is unchanged by the 3.0 split', () => {
    const body = renderCallBody('competitor_repair', { ...base, scriptVariant: 'control' });
    expect(body).toContain("I'm the AI assistant helping confirm the details");
    expect(body).toContain('CONVINIcar app link');
    expect(body).not.toContain('Roadside Emergency Management App');
    expect(body).not.toContain('a few great offers');
  });

  it('reframe arm pre-frames the offer, states it, and closes on the new app', () => {
    const body = renderCallBody('competitor_repair', { ...base, scriptVariant: 'reframe' });
    // Told up front that an offer is coming.
    expect(body).toContain('I can also save you some money at one of our partner repair shops');
    // Introduced as a statement, never a permission question.
    expect(body).toContain('Now I would like to mention a few great offers from our in-network partner shops');
    expect(body).toContain('Do NOT turn it into a question');
    expect(body).not.toContain('Would you like to hear');
    // New close.
    expect(body).toContain('Roadside Emergency Management App');
    expect(body).toContain('all-in-one emergency services app');
    expect(body).toContain('24/7 roadside assistance');
    expect(body).not.toContain('CONVINIcar app link');
    // AI disclosure survives the rewrite.
    expect(body).toContain("I'm an AI assistant");
  });

  it('reframe arm confirms the destination before the vehicle', () => {
    const body = renderCallBody('competitor_repair', { ...base, scriptVariant: 'reframe' });
    const dest = body.indexOf('I have the destination as');
    const vehicle = body.indexOf('And I have a');
    expect(dest).toBeGreaterThan(-1);
    expect(vehicle).toBeGreaterThan(-1);
    expect(dest).toBeLessThan(vehicle);
  });

  it('keeps the consent gate and guardrails in both arms', () => {
    for (const scriptVariant of ['control', 'reframe'] as const) {
      const body = renderCallBody('competitor_repair', { ...base, scriptVariant });
      expect(body).toContain('Only log a destination change on an explicit yes');
      expect(body).toContain('let them finish');
    }
  });

  // 2.9. A test call on 2026-08-14 offered one shop and then told the customer
  // we had no other partner shops when he asked for somewhere local. We have 9.
  it('offers a choice of shops when alternates exist', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      nearestShop: "Wayne's Powell",
      nearestShopDistanceMiles: 4,
      alternateShops: [
        { name: "Wayne's Columbus", distanceMiles: 6 },
        { name: 'Wrench Recovery', distanceMiles: 10 },
      ],
    });
    expect(body).toContain('several certified partner shops in your area');
    expect(body).toContain("Wayne's Powell, about 4 miles away");
    expect(body).toContain("Wayne's Columbus, about 6 miles away");
    expect(body).toContain('Wrench Recovery, about 10 miles away');
    expect(body).toContain('send the driver to the closest one');
    // The benefit is stated once for all three shops, not repeated per shop.
    // Scoped to offer 1 — offer 2's reassurance legitimately restates it later.
    const offer1 = body.slice(
      body.indexOf('We work with several certified partner shops'),
      body.indexOf('[AGENT: This offer names more than one shop'),
    );
    expect(offer1.split('up to 10 percent off parts and labor').length - 1).toBe(1);
    expect(offer1.split('visual mechanical diagnostic').length - 1).toBe(1);
  });

  it('never claims we have no other partner shops on a distance objection', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      nearestShop: "Wayne's Powell",
      nearestShopDistanceMiles: 4,
      alternateShops: [{ name: "Wayne's Columbus", distanceMiles: 6 }],
    });
    expect(body).toContain('DISTANCE OBJECTION');
    expect(body).toContain('NEVER say we have no other partner shops');
    // And it must not promise something nearer than the nearest.
    expect(body).toContain('Do not promise anything nearer');
  });

  it('falls back to the single-shop offer when nothing else is in catchment', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      nearestShop: "Wayne's Powell",
      nearestShopDistanceMiles: 4,
      alternateShops: [],
    });
    expect(body).toContain('We work with a certified shop');
    expect(body).not.toContain('several certified partner shops');
    // Still must not claim an empty network.
    expect(body).toContain('do NOT claim we have no other partner shops');
  });

  it('makes offer 2 a reason-finding question, not a restatement', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain("can I ask what's taking you to Firestone on Main?");
    expect(body).toContain('Ask that question and LISTEN');
  });

  // 2.8. Offer 2 fired on 0 of 13 offer-1 declines on 2026-08-14 because both
  // the question and the directive behind it treated "it's my regular shop" —
  // the most common decline there is — as a reason to stop. The rung is worth
  // 12 of the programme's 62 all-time wins.
  it('never speaks its own surrender inside offer 2', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).not.toContain("I'll leave it exactly as it is");
    expect(body).not.toContain('If it\'s just what was on the ticket');
  });

  it('sorts a preference from a constraint and still pitches on a preference', () => {
    const body = renderCallBody('competitor_repair', base);
    // The constraint branch keeps its graceful exit.
    expect(body).toContain('CONSTRAINT');
    expect(body).toContain("That makes sense, I'll leave it as it is");
    // The preference branch reaches a real second offer.
    expect(body).toContain('PREFERENCE');
    expect(body).toContain("it's my regular shop");
    expect(body).toContain('written estimate before any work starts');
    expect(body).toContain('Want me to switch it?');
  });

  it('puts the offer-2 reassurance after the question, not inside it', () => {
    const body = renderCallBody('competitor_repair', base);
    const questionIdx = body.indexOf("can I ask what's taking you to Firestone on Main?");
    const reassuranceIdx = body.indexOf('written estimate before any work starts');
    expect(questionIdx).toBeGreaterThan(-1);
    expect(reassuranceIdx).toBeGreaterThan(questionIdx);
  });

  it('requires explicit consent before a destination change', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('is that a yes to sending the driver to');
    expect(body).toContain('Only log a destination change on an explicit yes');
  });

  it('avoids greeting the customer with an unusable name field', () => {
    const coords = renderCallBody('competitor_repair', {
      ...base,
      customerFirstName: '39.9612,-82.9988',
    });
    expect(coords).toContain('Am I speaking with the owner of the vehicle?');
    expect(coords).not.toContain('39.9612');

    const named = renderCallBody('competitor_repair', base);
    expect(named).toContain('Am I speaking with Pat?');
  });

  // Second round — found by adversarial review of the first round.
  it('says "1 mile", never "1 miles"', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      nearestShopDistanceMiles: 1,
    });
    expect(body).toContain('just 1 mile from you');
    expect(body).not.toContain('1 miles');
  });

  it('claims no distance at all below half a mile', () => {
    for (const miles of [0.4, 0.1]) {
      const body = renderCallBody('competitor_repair', {
        ...base,
        nearestShopDistanceMiles: miles,
      });
      expect(body).not.toContain(`${miles} mile`);
      expect(body).toContain("Wayne's Westerville");
    }
  });

  it('keeps the certified credibility marker in offer 1', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('a certified shop');
  });

  it('tells the agent plainly there is no offer in the no-flip scenario', () => {
    // Scenario C is where the orchestrator lands every non-eligible job — the
    // one place an agent with nothing to offer actually stands.
    const body = renderCallBody('unknown', { ...base, nearestShop: null });
    expect(body).toContain('THERE IS NO REPAIR-SHOP OFFER ON THIS CALL');
    expect(body).toContain('ride in the tow truck');
    expect(body).not.toContain('one quick option and then');
  });

  it('carries the global rules that stop invented shops and spoken scaffolding', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('THE SCRIPT DECIDES WHETHER TO PITCH, NOT YOU');
    expect(body).toContain('never tell a customer they can ride in the tow truck');
    expect(body).toContain('Never say "AI"');
    expect(body).toContain('Never read a raw latitude/longitude pair aloud');
  });
});

describe('flip-scripts', () => {
  // Regression: the global-rules block was concatenated into the call body
  // without interpolation, so `{{callback_number}}` shipped verbatim inside
  // script_body. Retell substitutes its prompt template once and does not
  // recurse into the injected body, so live callers heard the literal token.
  it('leaves no template placeholders anywhere in the rendered call body', () => {
    const body = renderCallBody('competitor_repair', {
      repName: 'Emily',
      companyName: 'Roadside Towing',
      motorClub: '',
      callbackNumber: '+15551234567',
      conviniLink: 'https://convini.live',
      customerFirstName: 'Pat',
      vehicle: '2017 Ford Escape',
      pickupLocation: 'I-70 near exit 101',
      destination: 'Firestone on Main',
      issue: 'a flat tire',
      nearestShop: "Wayne's Westerville",
      nearestShopDistanceMiles: 2,
      rentalsAvailable: true,
    });

    expect(body).not.toMatch(/\{\{[^}]*\}\}/);
    // The global-rules line that leaked — now carries the real number.
    expect(body).toContain('+15551234567');
  });

  it('strips markup fragments pasted into tenant custom rules', () => {
    const body = renderCallBody('unknown', {
      repName: 'Emily',
      companyName: 'Roadside Towing',
      motorClub: '',
      callbackNumber: '+15551234567',
      conviniLink: 'https://convini.live',
      customerFirstName: 'Pat',
      vehicle: '2017 Ford Escape',
      pickupLocation: 'I-70 near exit 101',
      destination: 'home',
      issue: 'a flat tire',
      rentalsAvailable: true,
      // Exactly the shape that leaked into a live call.
      customAgentRules:
        'Always give the callback <parameter name="callback_number_placeholder">value</parameter> politely.',
    });

    expect(body).not.toContain('<parameter');
    expect(body).not.toContain('</parameter>');
    expect(body).toContain('Always give the callback');
  });

  it('keeps deliberate [AGENT:] and [STEP] directives intact', () => {
    const body = renderCallBody('competitor_repair', {
      repName: 'Emily',
      companyName: 'Roadside Towing',
      motorClub: '',
      callbackNumber: '+15551234567',
      conviniLink: 'https://convini.live',
      customerFirstName: 'Pat',
      vehicle: '2017 Ford Escape',
      pickupLocation: 'I-70 near exit 101',
      destination: 'Firestone on Main',
      issue: 'a flat tire',
      nearestShop: "Wayne's Westerville",
      nearestShopDistanceMiles: 2,
      rentalsAvailable: true,
    });

    expect(body).toContain('[AGENT:');
  });

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
      pitchConvini: true,
      rentalsAvailable: true,
    });

    expect(body).toContain('listed as a winch-out');
    expect(body).toContain('pulled back onto solid ground');
    expect(body).toContain('have a few photos of the situation ready');
    expect(body).toContain('I have the service location as I-70 near exit 101');
    expect(body).toContain('Do not ask for or assume a delivery destination on winch-out calls');
    expect(body).not.toContain('is there anywhere else it needs to be towed');
    expect(body).not.toContain('headed to your location as planned');
    // 2.3 — the close names the pickup leg explicitly. A winch-out has no
    // second leg, so it must stop there and never imply a tow destination.
    expect(body).toContain('coming to you at I-70 near exit 101');
    expect(body).not.toContain('then taking the vehicle to');
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
      pitchConvini: true,
      rentalsAvailable: true,
    });

    expect(body).toContain('I do not have a separate tow destination listed');
    expect(body).toContain('service at 123 Main St');
    expect(body).not.toContain('vehicle being towed to your destination');
    expect(body).toContain('coming to you at 123 Main St');
    expect(body).not.toContain('then taking the vehicle to');
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
