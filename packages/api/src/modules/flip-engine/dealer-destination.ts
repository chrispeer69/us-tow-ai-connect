/**
 * 3.12 (2026-09-09) — is the customer's destination a franchise dealership?
 *
 * From the 2026-09-08 daily review and the numbers behind it. Since data
 * became trustworthy (2026-08-17) dealership-bound tows have been pitched 142
 * times: offer 1 won 5, and offer 2 — the "can I ask what's taking you
 * there?" re-ask — won 0 of 80. Every decline the review read gave a
 * structural reason (warranty, prepaid service plan, bought the car there)
 * and then heard the same discount re-pitched. So on a dealership destination
 * the ladder is one rung: make offer 1, take the first no as final.
 *
 * Two signals, either is enough: Google's `car_dealer` place type, or a
 * franchise brand / dealer-group name in the destination text. Parts counters
 * ("Roush Honda Parts Store") count — they are the same service drive.
 */
const DEALER_NAME =
  /\b(germain|ricart|byers|coughlin|bob[- ]?boyd|dave gill|roush|jack maxton|lindsay|crown|hugh white|jeff wyler|bob caldwell|mark wahlberg|great lakes|honda|toyota|chevrolet|chevy|ford|kia|hyundai|nissan|subaru|mercedes|mercedes-benz|bmw|lexus|mazda|volkswagen|vw|buick|gmc|dodge|jeep|chrysler|ram|acura|infiniti|audi|lincoln|cadillac|volvo|porsche|genesis|mitsubishi|tesla|land rover|jaguar|mini|dealer|dealership|automall|auto mall)\b/i;

/** "Ford" inside "Oxford", "Bedford", "Stratford", "Radford" is a street, not a dealer. */
const FALSE_FORD = /\b(ox|bed|strat|rad|hart|med|mil|craw|wat|guil|san|stam|brad|ash)ford\b/gi;

export function isDealerDestination(
  placeTypes: readonly string[] | null | undefined,
  ...names: Array<string | null | undefined>
): boolean {
  if (placeTypes?.includes('car_dealer')) return true;
  for (const raw of names) {
    const name = (raw ?? '').trim();
    if (!name) continue;
    const cleaned = name.replace(FALSE_FORD, ' ');
    if (DEALER_NAME.test(cleaned)) return true;
  }
  return false;
}
