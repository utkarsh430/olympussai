import { bandFigures, bandLabel } from './bands';
import { proposalImpact } from './impact';
import { proposalReason } from './proposalReasons';
import { compareProposals } from './proposals';
import type { NeedInputs, Proposal, RouteHourFigures } from './types';

/*
 * An "add" can only draw on the buses its source depot had standing in its yard. When
 * that pool was observed and is smaller than the band's gap, the add is cut to the pool
 * and its reason says that fewer stand there than the gap calls for. Pure.
 */

export interface CapInput {
  readonly proposals: readonly Proposal[];
  readonly hours: readonly RouteHourFigures[];
  readonly need: NeedInputs;
  readonly lengthKm: number;
  readonly deadKmPerTrip?: number | null;
}

const figure = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** The observed pool of an add's source, when it is smaller than the add. */
function shortPool(p: Proposal): number | null {
  if (p.kind !== 'add_buses' || p.source === null || p.source.basis !== 'observed') return null;
  const pool = p.source.standingInYard;
  return pool !== null && pool < p.change ? Math.max(0, pool) : null;
}

/** The reason when the yard had no bus at all: the gap, and that none can come from there. */
function noPoolReason(p: Proposal, hours: readonly RouteHourFigures[]): string {
  const { deployed, needed } = bandFigures(p.band, hours);
  const depot = p.source?.depotName ?? 'the depot';
  return (
    `${bandLabel(p.band)}: modelled demand needs about ${figure(needed)} buses against ` +
    `${figure(deployed)} deployed; ${depot} had none standing in its yard the hour before, ` +
    'so no bus can be added from it.'
  );
}

function capped(p: Proposal, pool: number, input: Readonly<CapInput>): Proposal {
  if (pool === 0) return { ...p, change: 0, impact: null, reason: noPoolReason(p, input.hours) };
  const figures = bandFigures(p.band, input.hours);
  const reason =
    proposalReason({ kind: 'add_buses', band: p.band, ...figures, change: pool, source: p.source }) +
    ` Only ${pool} stand in that yard, fewer than the ${p.change} the gap calls for.`;
  const impact = proposalImpact({
    change: pool,
    band: p.band,
    hours: input.hours,
    need: input.need,
    lengthKm: input.lengthKm,
    deadKmPerTrip: input.deadKmPerTrip,
  });
  return { ...p, change: pool, reason, impact };
}

/** The proposals with every add cut to its observed standing pool, ordered as `buildProposals` orders. */
export function capAddsAtStanding(input: Readonly<CapInput>): Proposal[] {
  const out = input.proposals.map((p) => {
    const pool = shortPool(p);
    return pool === null ? p : capped(p, pool, input);
  });
  return out.some((p, i) => p !== input.proposals[i]) ? out.sort(compareProposals) : out;
}
