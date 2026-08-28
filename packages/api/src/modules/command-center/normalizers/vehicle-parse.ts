const COLORS = new Set([
  'red', 'blue', 'black', 'white', 'silver', 'gray', 'grey', 'green', 'yellow',
  'orange', 'brown', 'gold', 'tan', 'beige', 'purple', 'pink', 'maroon',
]);

export interface ParsedVehicle {
  year: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
}

/**
 * Best-effort split of a free-form vehicle string like "2018 Honda Civic Red".
 * 4-digit prefix → year, next token → make, color tokens → color, the
 * remainder is the model. Unparseable input returns nulls; the original
 * string is always preserved by the caller in source_payload.
 */
export function parseVehicleString(input: string | null | undefined): ParsedVehicle {
  if (!input) return { year: null, make: null, model: null, color: null };

  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { year: null, make: null, model: null, color: null };

  let year: string | null = null;
  if (/^(19|20)\d{2}$/.test(tokens[0])) {
    year = tokens.shift() ?? null;
  }

  let color: string | null = null;
  if (tokens.length > 0 && COLORS.has(tokens[tokens.length - 1].toLowerCase())) {
    color = tokens.pop() ?? null;
  }

  const make = tokens.shift() ?? null;
  const model = tokens.length > 0 ? tokens.join(' ') : null;

  return { year, make, model, color };
}

/**
 * Drops a trailing color word from a free-form vehicle string, e.g.
 * "2019 Chevrolet Tahoe Black" -> "2019 Chevrolet Tahoe". The outbound flip
 * call asks color as its own open question (the Towbook ticket's color is
 * only ~50% accurate, so it's never read back as a stated fact) — leaving it
 * in the vehicle description made the agent state the color as fact one
 * breath before asking the customer what color it is.
 */
export function stripTrailingColor(input: string): string {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && COLORS.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }
  return tokens.join(' ');
}
