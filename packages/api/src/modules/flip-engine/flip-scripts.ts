/**
 * Session 49c — Flip + CONVINI scripts.
 *
 * Each renderer returns the body the Thinkrr outbound agent will read.
 * Variables are interpolated with the `{{name}}` syntax.
 */

export interface ConfirmDetailsInput {
  customerName: string;
  companyName: string;
  vehicle: string;
  pickupLocation: string;
  destination: string;
}

export function renderConfirmDetails(i: ConfirmDetailsInput): string {
  return [
    `Hi {{customer_name}}, this is {{company_name}} calling about your tow.`,
    `I want to confirm a few details. We have your vehicle as a {{vehicle}}, picking up at {{pickup}}, going to {{destination}}.`,
    `Is that correct?`,
  ]
    .join(' ')
    .replace(/\{\{customer_name\}\}/g, i.customerName)
    .replace(/\{\{company_name\}\}/g, i.companyName)
    .replace(/\{\{vehicle\}\}/g, i.vehicle)
    .replace(/\{\{pickup\}\}/g, i.pickupLocation)
    .replace(/\{\{destination\}\}/g, i.destination);
}

export interface FlipOfferInput {
  ourShopName: string;
  distanceMilesSaved: number | null;
  rentalsAvailable: boolean;
}

export function renderOffer1(i: FlipOfferInput): string {
  const rentalLine = i.rentalsAvailable
    ? ' And if you need a rental while we work on your car, we have one ready — no third-party hassle.'
    : '';
  const distLine = i.distanceMilesSaved != null
    ? ` It's about {{miles}} miles closer for our driver too.`
    : '';
  return (
    `I'd love to redirect your tow to {{shop}}. As a thank-you, we'll cover the diagnostic and take ten percent off your repair.${distLine}${rentalLine} Want me to switch it?`
  )
    .replace(/\{\{shop\}\}/g, i.ourShopName)
    .replace(/\{\{miles\}\}/g, String(i.distanceMilesSaved ?? ''));
}

export function renderOffer2(i: FlipOfferInput): string {
  const rentalLine = i.rentalsAvailable
    ? ' And we have rental cars available right at the shop if you need one.'
    : '';
  return (
    `I understand. Let me sweeten this — at {{shop}} we'll guarantee same-day priority service AND a written estimate in your hands within one hour.${rentalLine} Sound better?`
  ).replace(/\{\{shop\}\}/g, i.ourShopName);
}

export function renderOffer3(i: FlipOfferInput): string {
  return (
    `Final offer: switch to {{shop}}, we'll credit fifty dollars toward your invoice and another twenty-five once you leave us a Google review. Take it?`
  ).replace(/\{\{shop\}\}/g, i.ourShopName);
}

export interface ConviniPitchInput {
  intensity: 'soft' | 'medium' | 'hard';
  rentalsAvailable: boolean;
  ourBodyShopMention?: { shop1: string; shop2: string };
}

export function renderConviniPitch(i: ConviniPitchInput): string {
  const rentals = i.rentalsAvailable ? ' We have thirty-five rental cars in our fleet too.' : '';
  if (i.intensity === 'soft') {
    return `Last thing — I'd love to text you our free CONVINI app. It handles towing, repairs, and rentals.${rentals} Want me to send it?`;
  }
  if (i.intensity === 'medium') {
    const bodyMention = i.ourBodyShopMention
      ? ` By the way, we also own two body shops — {{b1}} and {{b2}} — if you ever need cosmetic work down the road.`
      : '';
    return (
      `Before you go — we offer a free app called CONVINI that handles roadside assistance, repair scheduling, and rentals.${rentals}${bodyMention} Can I text you the link?`
    )
      .replace(/\{\{b1\}\}/g, i.ourBodyShopMention?.shop1 ?? '')
      .replace(/\{\{b2\}\}/g, i.ourBodyShopMention?.shop2 ?? '');
  }
  // hard
  return (
    `I want to make sure you're covered next time something happens. We have a free app called CONVINI — one tap gets you a tow, a rental, and a repair shop.${rentals} The app is free; can I text you the download link right now?`
  );
}

export function renderClosing(_i: { customerName: string }): string {
  return `Thank you for choosing us. Have a safe rest of your day.`;
}
