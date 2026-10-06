import { formatCount } from '../format';
import { MIN_PEER_GROUP } from '../score/config';
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

export interface RankingShortfallNotice {
  readonly lead: string;
  readonly linkText: string;
  readonly tail: string;
}

/** Why few depots are ranked; null unless fewer than half the operating depots are ranked. */
export function rankingShortfallNotice(
  depots: readonly EconomicsDepotRow[],
): RankingShortfallNotice | null {
  const operating = depots.filter((d) => d.kind === 'depot');
  const ranked = operating.filter((d) => d.score.ranked).length;
  if (operating.length === 0 || ranked * 2 >= operating.length) return null;
  const noun = operating.length === 1 ? 'operating depot' : 'operating depots';
  return {
    lead: `Only ${formatCount(ranked)} of ${formatCount(operating.length)} ${noun} are ranked. A depot is ranked when a duty is run in its modelled day and its peer group has at least ${formatCount(MIN_PEER_GROUP)} depots with complete figures. Earnings per kilometre on a route do not depend on its length, but a depot's figures weight its routes by the distance they run, so no depot waits for route profiles to be ranked; a real length, once a route is opened on the `,
    linkText: 'Routes page',
    // The same claim as `lengthCoverageLine` below: a length can move the rank.
    tail: ", replaces the modelled one, and can move the depot's figures and its rank.",
  };
}

/**
 * How many of the routes run across the operating depots rest on a real length
 * (a coverage figure, never a reason to hide a number); null when
 * no route ran. A route's own earnings per kilometre do not depend on its
 * length, but a depot's figures are means weighted by the distance each route
 * runs, so a real length can move them and the depot's rank.
 */
export function lengthCoverageLine(depots: readonly EconomicsDepotRow[]): string | null {
  const operating = depots.filter((d) => d.kind === 'depot');
  const real = operating.reduce((total, d) => total + d.lengthCoverage.n, 0);
  const run = operating.reduce((total, d) => total + d.lengthCoverage.of, 0);
  if (run <= 0) return null;
  const noun = run === 1 ? 'route' : 'routes';
  return `Route lengths: ${formatCount(real)} of ${formatCount(run)} ${noun} run in the modelled day rest on a real route profile; the rest use a modelled typical length for their class. Earnings per kilometre on a route do not depend on its length, but a depot's figures weight its routes by the distance they run, so a real length can move a depot's figures and its rank.`;
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
      'Fuel cost per kilometre is MODELLED too: it comes from the distance each bus runs in the modelled day (the route of its duty, out and back), a fuel economy by service class and a fixed price per litre. It counts fuel only, and it is the same figure the fuel page of the depot shows. Fuel issue records from the depots would replace it, alongside the ticketing feed and the route master.',
    ],
  };
}
