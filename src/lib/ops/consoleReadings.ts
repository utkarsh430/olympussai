/**
 * The control room's rule for showing a number, and the reason it is a module
 * rather than a habit.
 *
 * Every upstream this console reads degrades the same way: it returns an empty
 * array and a flag. `getGuardrailBreaches` hands back `data: []` when the
 * control service answered "no breaches today" AND when it could not be
 * reached at all. `getDailyKpiSnapshots` does the same. So does
 * `getObservabilitySnapshot` with its incident list. Render `data.length`
 * straight into a KPI tile and the console reports a calm, confident `0`
 * during a total outage — the single most dangerous thing an operations
 * display can do, and precisely the fabrication Phase 3 exists to remove.
 *
 * A reading therefore carries WHY it is empty, and the three whys are not
 * interchangeable:
 *
 *   observed         the source answered and this is the real value. `0` here
 *                    is a fact an operator may act on.
 *   not-yet-computed the source answered and has nothing for this key yet — no
 *                    headway sample on a corridor that just opened, no daily
 *                    KPI row before the first nightly roll-up. Real, benign,
 *                    and NOT a number.
 *   unavailable      the source did not answer. There is no value, and the
 *                    console must say so rather than draw a zero.
 *
 * The tile renderer keys off `availability`, never off `value === null`, so
 * "nothing to report" and "we cannot see" can never collapse into the same
 * dash on screen.
 */

/** Why a reading has the value it has, or has none. */
export type ReadingAvailability = 'observed' | 'not-yet-computed' | 'unavailable';

export interface ConsoleReading {
  /** The real number, or null whenever `availability` is not 'observed'. */
  value: number | null;
  availability: ReadingAvailability;
  /** One short clause for the tile's hint line. Always says which of the three this is. */
  detail: string;
}

export function observed(value: number, detail: string): ConsoleReading {
  return { value, availability: 'observed', detail };
}

export function notYetComputed(detail: string): ConsoleReading {
  return { value: null, availability: 'not-yet-computed', detail };
}

export function unavailable(detail: string): ConsoleReading {
  return { value: null, availability: 'unavailable', detail };
}

/**
 * A reading from a source that may be down, in one call.
 *
 * `sourceOk` is the caller's own judgement about the upstream, and it is
 * checked FIRST — before the value is even looked at. That ordering is the
 * whole point: a `0` from a dead source must never reach `observed`, and the
 * only way to guarantee that is to refuse to consider the value until the
 * source has been vouched for.
 */
export function readingFrom(
  sourceOk: boolean,
  value: number | null | undefined,
  copy: { observed: string; missing: string; unavailable: string },
): ConsoleReading {
  if (!sourceOk) return unavailable(copy.unavailable);
  if (value === null || value === undefined || Number.isNaN(value)) return notYetComputed(copy.missing);
  return observed(value, copy.observed);
}

/** True when this reading is a real number an operator may act on. */
export function isObserved(reading: ConsoleReading): reading is ConsoleReading & { value: number } {
  return reading.availability === 'observed' && reading.value !== null;
}

/**
 * What the tile prints as its value.
 *
 * The two non-observed states get visibly DIFFERENT glyphs, not a shared em
 * dash. An operator scanning the strip has to be able to tell "nothing has
 * happened" from "I am blind" without reading the hint line under it, because
 * during an incident nobody reads hint lines.
 */
export function readingDisplay(
  reading: ConsoleReading,
  format: (value: number) => string = (value) => String(value),
): string {
  if (isObserved(reading)) return format(reading.value);
  return reading.availability === 'unavailable' ? 'n/a' : '—';
}

/** Seconds, to the nearest second, as an operator reads them. */
export function formatSeconds(value: number): string {
  return `${Math.round(value)}s`;
}

/** A 0-1 ratio as a whole percentage. */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Two decimal places, for the coefficient of variation. */
export function formatRatio(value: number): string {
  return value.toFixed(2);
}
