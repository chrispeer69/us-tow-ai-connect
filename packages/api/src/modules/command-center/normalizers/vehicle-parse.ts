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
