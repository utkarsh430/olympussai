import { formatCount } from '../format';
import { ECONOMICS_MIN_ROUTE_COVERAGE, ECONOMICS_MIN_ROUTES } from '../sim/revenueConfig';
import type { EconomicsDepotRow } from './api';

/*
 * What the economics page says about itself: that fuel is one cost, what the
 * ranking can and cannot tell a reader, why a ranking may be almost empty, and
 * the MODELLED statement (the revenue page's, with a short preface and the
 * fuel feed that would replace the cost).
 */

/** Printed beside the table. The cost is modelled fuel only, so the pair is not a profit figure. */
export const FUEL_ONLY_NOTE =
  'Fuel is only one cost. The difference between earnings and fuel cost per kilometre is not profit.';

/** Printed near the status line: two thirds of the weight is load factor times class constants. */
export const INDEX_LIMITS_NOTE =
  "This index is driven by the model's class mix and load-factor assumptions; it shows how a ranking will work once ticketing data is supplied and is not a finding about any depot.";

const COUNT_WORDS: readonly string[] = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
];
const SHARE_WORDS: ReadonlyMap<number, string> = new Map([
  [0.25, 'a quarter'],
  [0.5, 'half'],
  [0.2, 'a fifth'],
]);
const PERCENT = 100;

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

function shareWords(share: number): string {
  return SHARE_WORDS.get(share) ?? `${Math.round(share * PERCENT)}%`;
}

export interface RankingShortfallNotice {
  readonly lead: string;
  readonly linkText: string;
  readonly tail: string;
}

/** Why the ranking is nearly empty; null unless fewer than half the operating depots are ranked. */
export function rankingShortfallNotice(
  depots: readonly EconomicsDepotRow[],
): RankingShortfallNotice | null {
  const operating = depots.filter((d) => d.kind === 'depot');
  const ranked = operating.filter((d) => d.score.ranked).length;
  if (operating.length === 0 || ranked * 2 >= operating.length) return null;
  const noun = operating.length === 1 ? 'operating depot' : 'operating depots';
  const rule = `at least ${countWord(ECONOMICS_MIN_ROUTES)} of its routes, and ${shareWords(ECONOMICS_MIN_ROUTE_COVERAGE)} of them`;
  return {
    lead: `Only ${formatCount(ranked)} of ${formatCount(operating.length)} ${noun} can be ranked. A depot is ranked once ${rule}, have a known length; route lengths come from route profiles, which are loaded one route at a time when a route is opened on the `,
    linkText: 'Routes page',
    tail: '.',
  };
}

export interface EconomicsStatement {
  /** Before the revenue statement: what this page adds. */
  readonly preface: readonly string[];
  /** After the revenue statement (definitions, assumptions, replacing feeds, built by modelledStatement): the cost, which the revenue page does not have. */
  readonly closing: readonly string[];
}

/** The economics additions around the revenue statement, which ModelledStatement prints between them. */
export function economicsStatement(): EconomicsStatement {
  return {
    preface: [
      'The Depot Economics Index ranks operating depots on three MODELLED figures: earnings per kilometre, fuel cost per kilometre and load factor. None of them is measured; each is worked out from the assumptions below.',
    ],
    closing: [
      'Fuel cost per kilometre is MODELLED too: it comes from the distance each bus is modelled to run, a fuel economy by service class and a fixed price per litre. It counts fuel only. Fuel issue records from the depots would replace it, alongside the ticketing feed and the route master.',
    ],
  };
}
