import type { DepotBusView } from '../api';
import type {
  AssignmentPlan,
  BusStandingNow,
  Duty,
  DutyAssignment,
  Ineligibility,
  PlanNow,
} from '../duties/types';
import type { ModelledBus, ServiceClass } from '../sim/types';
import { isRecentlyHeard } from '../infer/busState';
import { MAX_BUS_AGE_YEARS } from '../sim/config';
import { hungarian } from './hungarian';
import { MINUTES_PER_HOUR } from '@/lib/depot/units';

/** Age assumed for a bus the fleet master does not know when the master is empty. */
const EMPTY_MASTER_AGE_YEARS = 0;
const DEFAULT_CLASS: ServiceClass = 'ordinary';
/** The longest modelled duty, in whole hours (`sim/duties.ts` caps a duty at 960 min). */
const MAX_DUTY_HOURS = 16;
/** The base tier's cap: the oldest modelled bus on the longest duty. */
export const MAX_BASE_COST = MAX_BUS_AGE_YEARS * MAX_DUTY_HOURS;

type Exclusion = 'off_road' | 'dark' | 'not_in_yard' | 'not_heard';

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Median of the finite ages in the fleet master; zero when there are none, as
 * for an empty master. A non-finite age is data noise and must not reach a cost.
 */
function medianAge(fleet: ReadonlyMap<string, ModelledBus>): number {
  const ages = [...fleet.values()]
    .map((b) => b.ageYears)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (ages.length === 0) return EMPTY_MASTER_AGE_YEARS;
  const mid = Math.floor(ages.length / 2);
  return ages.length % 2 === 1
    ? (ages[mid] as number)
    : ((ages[mid - 1] as number) + (ages[mid] as number)) / 2;
}

export interface AssignDutiesOptions {
  /**
   * False when the depot has no yard established. Location is then unknown,
   * not "away", so it cannot decide eligibility: a standing bus heard within
   * the reporting window is eligible. Defaults to true (location decides).
   */
  readonly yardEstablished?: boolean;
  /**
   * As of when the plan is made. On the feed clock, a duty that
   * has started by then prefers a bus on the road and one still to start a
   * standing bus. Before the first duty of the feed's date every
   * bus eligible on the feed clock can take a duty, but the buses standing in
   * the yard leave first: they hold the earliest duties and the buses still out
   * take the ones after, with no time fit. For a later day how the buses stand
   * now does not count: the buses standing in the yard are the ones that will
   * leave it, so only they are eligible. Defaults to a feed with no clock: no
   * duty is treated as started.
   */
  readonly now?: PlanNow;
}

const NO_FEED_CLOCK: PlanNow = { kind: 'no_feed_clock' };

/**
 * Heard within the module's reporting window (`isRecentlyHeard`, the rule a
 * bus's "not heard for N min" comes from), whether moving or standing. A last
 * report older than that cannot say how the bus stands now.
 */
function isHeardRecently(bus: DepotBusView): boolean {
  return isRecentlyHeard(bus.gpsAgeMin) && (bus.notHeardMin ?? null) === null;
}

/**
 * How an eligible bus stands now, or why it is not eligible: off the road and
 * dark never; then, when the feed has a clock (on it, or before the first duty
 * read off it), a bus not heard recently (`not_heard`) whether moving or
 * standing; with no clock no report can be aged, so recency is not judged. In
 * service or on the road is eligible (it is out working); a standing bus, when
 * a yard is established, only in it. A later day takes the yard buses only.
 */
function standingOf(
  bus: DepotBusView,
  yardEstablished: boolean,
  now: PlanNow,
): BusStandingNow | Exclusion {
  if (bus.state === 'off_road') return 'off_road';
  if (bus.state === 'dark') return 'dark';
  if (now.kind === 'later_day') return laterDayStanding(bus, yardEstablished);
  const clocked = now.kind === 'feed_time' || now.kind === 'before_first_duty';
  if (clocked && !isHeardRecently(bus)) return 'not_heard';
  if (bus.state === 'in_service' || bus.state === 'on_road') return 'on_road';
  if (!yardEstablished) return 'standing';
  return bus.location === 'in_yard' ? 'in_yard' : 'not_in_yard';
}

/**
 * False for a later day and before the feed date's first duty: no duty has started, so there is no time to fit and being out working
 * does not put a bus first.
 */
function dayHasBegun(now: PlanNow): boolean {
  return now.kind !== 'later_day' && now.kind !== 'before_first_duty';
}

/**
 * For a later day: a bus the feed places in the yard will leave it (the yard's
 * parking order is about exactly these buses); every other bus is not in the
 * yard. With no yard established, location cannot decide: every available bus.
 */
function laterDayStanding(bus: DepotBusView, yardEstablished: boolean): BusStandingNow | Exclusion {
  if (!yardEstablished) return 'standing';
  return bus.location === 'in_yard' ? 'in_yard' : 'not_in_yard';
}

interface Candidate {
  readonly bus: DepotBusView;
  readonly standing: BusStandingNow;
  /**
   * Tiers 1 and 2 in one per-bus rank: 0 in service, 1 merely on the road,
   * 2 standing. Before the first duty a standing bus (in the yard) ranks 0 and
   * a bus still out 1; for a later day every bus ranks 0.
   */
  readonly rank: number;
}

function rankOf(bus: DepotBusView, standing: BusStandingNow, now: PlanNow): number {
  if (now.kind === 'before_first_duty') return standing === 'on_road' ? 1 : 0;
  if (now.kind === 'later_day') return 0;
  if (standing !== 'on_road') return 2;
  return bus.state === 'in_service' ? 0 : 1;
}

/**
 * Tiers 1 and 2 depend on the bus alone, and every duty can take every
 * eligible bus, so a matching is lexicographically best on them exactly when
 * it uses every bus ranked better than the `pairs`-th best rank and none ranked
 * worse. The worse ones are left spare here; of the rest, a 0/1 "boundary"
 * tier (the bus has that boundary rank) makes the matching use all the better
 * ones first. Two per-bus tiers thus cost one 0/1 tier, which keeps the
 * weights inside exact integer arithmetic (see `tierWeights`).
 */
function selectByRank(
  eligible: readonly Candidate[],
  pairs: number,
): { readonly inPlay: readonly Candidate[]; readonly boundary: number } {
  const ranks = eligible.map((c) => c.rank).sort((a, b) => a - b);
  const boundary = pairs > 0 ? (ranks[pairs - 1] as number) : 0;
  return { inPlay: eligible.filter((c) => c.rank <= boundary), boundary };
}

/**
 * The top tier. Once the day has begun: the boundary tier (`selectByRank`).
 * Before the first duty it also says which duties: a bus that
 * leaves first (rank 0) on one of the earliest duties, a bus still out on one
 * after them. That is still 0 or 1 per pair, and a total of 0 exists, so the
 * yard buses hold the earliest duties and, as the boundary tier would make
 * them, every one of them runs before a bus still out does.
 */
function firstTier(duty: Duty, rank: number, ctx: CostContext): number {
  if (ctx.leavesFirst === null) return rank < ctx.boundary ? 0 : 1;
  return (rank === 0) === ctx.leavesFirst.has(duty.id) ? 0 : 1;
}

/**
 * Before the first duty: the ids of the earliest duties, as many as there are
 * buses in play that leave first, by start then id; otherwise null.
 */
function earliestDuties(
  duties: readonly Duty[],
  inPlay: readonly Candidate[],
  now: PlanNow,
): ReadonlySet<string> | null {
  if (now.kind !== 'before_first_duty') return null;
  const first = inPlay.filter((c) => c.rank === 0).length;
  const ordered = [...duties].sort((a, b) => a.startMin - b.startMin || compare(a.id, b.id));
  return new Set(ordered.slice(0, first).map((d) => d.id));
}

/** The pair's cost in tiers, highest first; each tier but the last is 0 or 1. */
function tiersOf(duty: Duty, candidate: Candidate, ctx: CostContext): readonly number[] {
  const { bus, standing, rank } = candidate;
  const onRoad = standing === 'on_road';
  const modelled = ctx.fleet.get(bus.registrationNumber);
  const started = ctx.feedMinute !== null && duty.startMin <= ctx.feedMinute;
  const age =
    modelled !== undefined && Number.isFinite(modelled.ageYears) ? modelled.ageYears : ctx.fallbackAge;
  const base = Math.round(age * Math.round((duty.endMin - duty.startMin) / MINUTES_PER_HOUR));
  return [
    firstTier(duty, rank, ctx),
    bus.routeName === duty.routeName ? 0 : 1,
    (modelled?.serviceClass ?? DEFAULT_CLASS) === duty.serviceClass ? 0 : 1,
    !ctx.timeFit || started === onRoad ? 0 : 1,
    Math.min(Math.max(base, 0), MAX_BASE_COST),
  ];
}

interface CostContext {
  readonly fleet: ReadonlyMap<string, ModelledBus>;
  readonly fallbackAge: number;
  readonly feedMinute: number | null;
  /** The rank the last pairs are drawn from (`selectByRank`). */
  readonly boundary: number;
  /** Before the first duty, the duties the buses that leave first hold (`earliestDuties`). */
  readonly leavesFirst: ReadonlySet<string> | null;
  /** False before the first duty and for a later day: no duty has started, so no time fit. */
  readonly timeFit: boolean;
}

/**
 * Weights that make the tiers lexicographic: each tier's weight exceeds the
 * most every lower tier can add up to over a whole matching (`pairs` pairs),
 * so no number of lower-tier savings can pay for one higher-tier cost.
 *
 * The bound. There are five weighted tiers in every mode: the
 * top tier (the boundary tier, which carries "on the road" and "in service",
 * see `selectByRank`; before the first duty, the yard buses on the earliest
 * duties, see `firstTier`), route, class, time fit (0 throughout when no duty
 * has started), each 0 or 1, and the base, capped at MAX_BASE_COST = 15
 * years x 16 h = 240. With P pairs the weights are 1, then w(k+1) = 1 + P x
 * (B + w1 + ... + wk) for B = 240, so the top weight is under (P + 1)^4 x B.
 * At P = 400 it is about 6.2e12; a cell is under 2 x the top weight, and a
 * matching's total under P x that: 2 x 6.2e12 x 401 is about 5.0e15 < 2^53
 * (9.0e15). Every cell, total and reduced cost is an exact integer. The guard
 * re-checks it; past about 450 pairs (no depot comes near) the base tier is
 * dropped rather than lose precision in the tiers above it.
 */
export function tierWeights(pairs: number, largestBase: number): readonly number[] {
  const build = (base: number): number[] => {
    const weights = [1];
    let reach = pairs * base;
    for (let tier = 0; tier < TIERS - 1; tier += 1) {
      const weight = reach + 1;
      weights.unshift(weight);
      reach += pairs * weight;
    }
    return weights;
  };
  const full = build(largestBase);
  const top = (full[0] as number) * 2 * (pairs + 1);
  return top < Number.MAX_SAFE_INTEGER ? full : [...build(0).slice(0, -1), 0];
}

const TIERS = 5;

/**
 * Proposes which bus runs which duty: an exact minimum-cost matching.
 * Buses off the road or dark, buses not heard recently (when the
 * feed has a clock), and standing buses away from an established yard are
 * excluded first, each with one reason; a later day's plan takes the buses in
 * the yard only. Every other pairing is allowed and costed in lexicographic
 * tiers:
 *  1. a bus on the road before a standing one, so when there are fewer duties
 *     than buses the buses left over are standing ones (before the first duty
 *     it is the other way round: a bus standing in the yard leaves
 *     first, on the earliest duties, and the buses still out take the ones
 *     after);
 *  2. a bus in service before one merely moving (tiers 1 and 2 are per bus,
 *     and are applied as one 0/1 tier by `selectByRank`);
 *  3. a bus reporting the duty's route live takes that route's duty;
 *  4. a bus of the duty's service class;
 *  5. time fit: a duty started by the feed time on a bus on the road, a duty
 *     still to start on a standing bus;
 *  6. `ageYears x round(durationHours)`, capped at MAX_BASE_COST, so longer
 *     duties prefer younger buses;
 *     then the matcher's fixed scan order over buses sorted by registration.
 * A later day has no tiers 1, 2 and 5; before the first duty there are no
 * tiers 2 and 5, and tier 1 is the yard first. A bus missing from the fleet master
 * counts as ordinary at the master's median age. The matching never fails:
 * duties without a bus are reported as `no_eligible_bus`, eligible buses
 * without a duty as spare. Deterministic whatever the order of `buses`; a
 * repeated registration throws a RangeError. Recommendation only.
 */
export function assignDuties(
  duties: readonly Duty[],
  buses: readonly DepotBusView[],
  fleet: ReadonlyMap<string, ModelledBus>,
  options: AssignDutiesOptions = {},
): AssignmentPlan {
  const yardEstablished = options.yardEstablished ?? true;
  const now = options.now ?? NO_FEED_CLOCK;
  const seen = new Set<string>();
  for (const bus of buses) {
    if (seen.has(bus.registrationNumber)) {
      throw new RangeError(`Duplicate registration ${bus.registrationNumber}`);
    }
    seen.add(bus.registrationNumber);
  }
  const sorted = [...buses].sort((a, b) => compare(a.registrationNumber, b.registrationNumber));
  const excluded: { registrationNumber: string; reason: Ineligibility }[] = [];
  const eligible: Candidate[] = [];
  for (const bus of sorted) {
    const standing = standingOf(bus, yardEstablished, now);
    if (standing === 'on_road' || standing === 'in_yard' || standing === 'standing') {
      eligible.push({ bus, standing, rank: rankOf(bus, standing, now) });
    } else excluded.push({ registrationNumber: bus.registrationNumber, reason: standing });
  }
  const feedMinute = now.kind === 'feed_time' ? now.feedMinute : null;
  const pairs = Math.min(duties.length, eligible.length);
  const { inPlay, boundary } = selectByRank(eligible, pairs);
  const ctx: CostContext = {
    fleet,
    fallbackAge: medianAge(fleet),
    feedMinute,
    boundary,
    leavesFirst: earliestDuties(duties, inPlay, now),
    timeFit: dayHasBegun(now),
  };
  const tiers = duties.map((duty) => inPlay.map((c) => tiersOf(duty, c, ctx)));
  const weights = tierWeights(pairs, MAX_BASE_COST);
  const cost = tiers.map((row) =>
    row.map((t) => t.reduce((sum, value, i) => sum + value * (weights[i] as number), 0)),
  );
  const { rowToCol } = hungarian(cost);

  const assignments: DutyAssignment[] = duties.map((duty, row) => {
    const matched = inPlay[rowToCol[row] ?? -1];
    return matched !== undefined
      ? {
          dutyId: duty.id,
          registrationNumber: matched.bus.registrationNumber,
          reason: 'assigned',
          busStanding: matched.standing,
        }
      : { dutyId: duty.id, registrationNumber: null, reason: 'no_eligible_bus', busStanding: null };
  });
  const used = new Set(rowToCol.filter((c) => c >= 0).map((c) => inPlay[c]));
  const spare = eligible.filter((c) => !used.has(c));
  const count = (standing: BusStandingNow): number =>
    spare.filter((c) => c.standing === standing).length;
  return {
    assignments,
    spareBuses: spare.map((c) => c.bus.registrationNumber),
    spareByStanding: { inYard: count('in_yard'), standing: count('standing'), onRoad: count('on_road') },
    excluded,
    unassignedDuties: rowToCol.filter((c) => c < 0).length,
  };
}
