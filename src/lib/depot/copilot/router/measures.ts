import type { DepotMeasure } from '@/lib/depot/copilot/queries';

/**
 * Round 8 A: the words that ask for one figure. Order matters: the first match
 * wins, so "off the road" is read before "on the road", visiting buses before the
 * yard, and the rank before the index ("index and rank" asks for the rank).
 */
export const MEASURE_PATTERNS: readonly (readonly [DepotMeasure, RegExp])[] = [
  ['powerCut', /\b(main power|power (?:is )?off|power[\s-]?cut)\b/],
  ['offRoad', /\boff[\s-]?(?:the[\s-]?)?road\b|\b(maintenance|workshop|breakdowns?)\b/],
  ['onRoad', /\bon[\s-]?(?:the[\s-]?)?road\b|\b(running|in service)\b/],
  ['dark', /\b(dark|no[\s-]?signal|lost signal|silent|offline|unreachable)\b/],
  ['visitors', /\b(visit\w*|from other depots)\b/],
  ['inYard', /\b(?:in|inside) (?:the |its )?yard\b/],
  ['rank', /\b(rank\w*|position)\b/],
  ['index', /\b(efficiency|index|score)\b/],
  ['standing', /\b(standing|stationary|idle)\b/],
  [
    'fleet',
    /\b(fleet[\s-]?size|size of (?:the |its )?fleet|how big)\b|\bhow many buses (?:does|do)\b.*\bhave\b/,
  ],
];

export function measureOf(text: string): DepotMeasure | undefined {
  return MEASURE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
}

/** The text without the measure's own words, so "on the road" is not read as a place. */
export function withoutMeasureWords(text: string): string {
  return MEASURE_PATTERNS.reduce(
    (rest, [, pattern]) => rest.replace(new RegExp(pattern.source, 'g'), ' '),
    text,
  );
}
