/*
 * Parsers for what a planner types into the sandbox. Each accepts only a
 * strict decimal or whole-number pattern and answers with a sentence when it
 * refuses, so a field never silently drops part of what was typed.
 */

export type ParseResult =
  | { readonly ok: true; readonly value: number }
  | {
      readonly ok: false;
      readonly error: string;
    };

const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;
const WHOLE_PATTERN = /^[+-]?\d+$/;

function parseDecimal(raw: string, unit: RegExp, what: string): ParseResult {
  const text = raw.trim().replace(unit, '').trim();
  if (text === '') return { ok: false, error: `Enter ${what}.` };
  if (!DECIMAL_PATTERN.test(text))
    return { ok: false, error: `${capital(what)} must be a number.` };
  return { ok: true, value: Number(text) };
}

function capital(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function parseSparePercent(raw: string): ParseResult {
  return parseDecimal(raw, /%$/, 'a spare ratio as a percentage');
}

export function parseDistanceKm(raw: string): ParseResult {
  return parseDecimal(raw, /km$/i, 'a distance in kilometres');
}

export function parseSurgePercent(raw: string): ParseResult {
  return parseDecimal(raw, /%$/, 'a demand change as a percentage');
}

/** Buses are whole: a fraction is refused here rather than truncated out of sight. */
export function parseBusDelta(raw: string): ParseResult {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Enter a change in buses, such as +12 or -5.' };
  if (!WHOLE_PATTERN.test(text)) {
    return { ok: false, error: 'A change in buses must be a whole number, such as +12 or -5.' };
  }
  const value = Number(text);
  if (value === 0) return { ok: false, error: 'Enter a change other than zero.' };
  return { ok: true, value };
}
