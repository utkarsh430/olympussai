/**
 * How the cockpit's attention lines sit at each width, so no line is left alone on the
 * last row of a strip of several columns:
 *
 * - on a phone (below 640 px) every strip is a single-column list;
 * - five lines sit 3 + 2 from 640 to 1279 px and on one row from 1280;
 * - six sit three across in two rows from 640; three sit three across from 640;
 * - two and four sit one per row below 1024 and two across from 1024.
 *
 * Where three or more sit across, each line is a stacked cell (count, words, destination)
 * whose words wrap. The classes are written out because Tailwind reads class names
 * literally; a test ties each class set to the columns this model decides.
 */
import { BREAKPOINT_PX } from '@/lib/depot/shell/geometry';

/** Below 640 px, 640 to 1023, 1024 to 1279, and from 1280. */
export type AttentionTier = 'phone' | 'tablet' | 'desktop' | 'wide';

export function attentionTier(viewportPx: number): AttentionTier {
  if (viewportPx < BREAKPOINT_PX.sm) return 'phone';
  if (viewportPx < BREAKPOINT_PX.lg) return 'tablet';
  if (viewportPx < BREAKPOINT_PX.xl) return 'desktop';
  return 'wide';
}

/** The columns a strip of `count` lines takes at a tier. */
export function attentionColumns(count: number, tier: AttentionTier): number {
  if (tier === 'phone' || count <= 1) return 1;
  if (count === 5) return tier === 'wide' ? 5 : 3;
  if (count === 3 || count === 6) return 3;
  return tier === 'tablet' ? 1 : 2;
}

/** The lines on each row, in order, for `count` lines in `columns` columns. */
export function attentionRows(count: number, columns: number): readonly number[] {
  const rows = Math.ceil(count / columns);
  return Array.from({ length: rows }, (_row, index) =>
    Math.min(columns, count - index * columns),
  );
}

/** The classes a strip adds to its list, each line, each link and its parts, and its filler. */
export interface AttentionLayoutClasses {
  readonly list: string;
  readonly item: string;
  readonly link: string;
  readonly count: string;
  readonly words: string;
  /** An empty last cell that carries the rule between rows, or null when none is needed. */
  readonly filler: string | null;
}

/** A cell stacked from 640 px: count, words and destination one under another. */
const STACKED = {
  link: 'sm:h-full sm:flex-col sm:items-start sm:gap-1',
  count: 'sm:w-auto sm:text-left',
  words: '',
} as const;

const SINGLE: AttentionLayoutClasses = {
  list: '',
  item: '',
  link: '',
  count: '',
  words: 'sm:truncate',
  filler: null,
};

const PAIRS: AttentionLayoutClasses = {
  ...SINGLE,
  list: 'lg:grid-cols-2 lg:gap-x-8',
  item: 'lg:[&:nth-child(2)]:border-t-0',
};

/** Three across from 640: the first row draws no top rule, a row's first cell no left one. */
const THREES: AttentionLayoutClasses = {
  ...STACKED,
  list: 'sm:grid-cols-3',
  item:
    'sm:border-l sm:pl-4 sm:[&:nth-child(3n+1)]:border-l-0 sm:[&:nth-child(3n+1)]:pl-0 ' +
    'sm:[&:nth-child(-n+3)]:border-t-0',
  filler: null,
};

/** Five: 3 + 2 from 640 to 1279 (an empty sixth cell keeps the rule), one row from 1280. */
const FIVE: AttentionLayoutClasses = {
  ...STACKED,
  list: 'sm:grid-cols-3 xl:grid-cols-5',
  item:
    'sm:border-l sm:pl-4 sm:max-xl:[&:nth-child(3n+1)]:border-l-0 ' +
    'sm:max-xl:[&:nth-child(3n+1)]:pl-0 sm:max-xl:[&:nth-child(-n+3)]:border-t-0 ' +
    'xl:border-t-0 xl:first:border-l-0 xl:first:pl-0',
  filler: 'hidden border-t border-depot-line sm:block xl:hidden',
};

export function attentionLayoutClasses(count: number): AttentionLayoutClasses {
  if (count === 5) return FIVE;
  if (count === 3 || count === 6) return THREES;
  if (count === 2 || count === 4) return PAIRS;
  return SINGLE;
}
