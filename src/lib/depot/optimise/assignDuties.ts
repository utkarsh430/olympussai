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
import { hungarian } from './hungarian';

const MINUTES_PER_HOUR = 60;
/** Age assumed for a bus the fleet master does not know when the master is empty. */
const EMPTY_MASTER_AGE_YEARS = 0;
const DEFAULT_CLASS: ServiceClass = 'ordinary';

type Exclusion = 'off_road' | 'dark' | 'not_in_yard';

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
   * As of when the plan is made (ruling S55). On the feed clock, a duty that
   * has started by then prefers a bus on the road and one still to start a
   * standing bus. For a later day, how the buses stand now does not count: the
   * buses standing in the yard are the ones that will leave it, so only they
   * are eligible, and nothing is ranked by being on the road. Defaults to a
   * feed with no clock: no duty is treated as started.
   */
  readonly now?: PlanNow;
}

const NO_FEED_CLOCK: PlanNow = { kind: 'no_feed_clock' };

/** Standing, on a report recent enough to say where the bus is standing now. */
function isStandingNow(bus: DepotBusView): boolean {
  return (
    bus.state === 'standing' && isRecentlyHeard(bus.gpsAgeMin) && (bus.notHeardMin ?? null) === null
  );
}

/**
 * How an eligible bus stands now, or why it is not eligible: off the road and
 * dark never; in service or on the road always (it is out working); a standing
 * bus only on a recent report (yard or not: an old report cannot say where it
 * stands now, which `not_in_yard` covers) and, when a yard is established,
 * only in it.
 */
function standingOf(
  bus: DepotBusView,
  yardEstablished: boolean,
  now: PlanNow,
): BusStandingNow | Exclusion {
  if (bus.state === 'off_road') return 'off_road';
  if (bus.state === 'dark') return 'dark';
  if (now.kind === 'later_day') return laterDayStanding(bus, yardEstablished);
  if (bus.state === 'in_service' || bus.state === 'on_road') return 'on_road';
  if (!isStandingNow(bus)) return 'not_in_yard';
  if (!yardEstablished) return 'standing';
  return bus.location === 'in_yard' ? 'in_yard' : 'not_in_yard';
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
}

/** The pair's cost in tiers, highest first; each tier but the last is 0 or 1. */
function tiersOf(duty: Duty, candidate: Candidate, ctx: CostContext): readonly number[] {
  const { bus, standing } = candidate;
  const onRoad = standing === 'on_road';
  const modelled = ctx.fleet.get(bus.registrationNumber);
  const started = ctx.feedMinute !== null && duty.startMin <= ctx.feedMinute;
  const age =
    modelled !== undefined && Number.isFinite(modelled.ageYears) ? modelled.ageYears : ctx.fallbackAge;
  return [
    onRoad ? 0 : 1,
    bus.routeName === duty.routeName ? 0 : 1,
    (modelled?.serviceClass ?? DEFAULT_CLASS) === duty.serviceClass ? 0 : 1,
    started === onRoad ? 0 : 1,
    Math.round(age * Math.round((duty.endMin - duty.startMin) / MINUTES_PER_HOUR)),
  ];
}

interface CostContext {
  readonly fleet: ReadonlyMap<string, ModelledBus>;
  readonly fallbackAge: number;
  readonly feedMinute: number | null;
}

/**
 * Weights that make the tiers lexicographic: each tier's weight exceeds the
 * most every lower tier can add up to over a whole matching (`pairs` pairs),
 * so no number of lower-tier savings can pay for one higher-tier cost. The
 * top weight grows as (pairs + 1)^4 x largest base: for 400 pairs (a larger
 * depot than any in the network) and a base of 20 years x 20 hours it is about
 * 1.03e13, and a matching's total is under pairs x 2 x the top weight, about
 * 8.2e15, below 2^53 (9.0e15), so every sum and every reduced cost is exact.
 * The guard checks that bound; should a depot ever pass it, the base tier (age
 * x hours, the least important) is dropped rather than lose precision.
 */
function tierWeights(pairs: number, largestBase: number): readonly number[] {
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
 * Proposes which bus runs which duty: an exact minimum-cost matching (ruling
 * S47). Buses off the road or dark, and standing buses that are not known to
 * be in the yard now, are excluded first, each with one reason. Every other
 * pairing is allowed and costed in lexicographic tiers:
 *  1. a bus on the road (in service or not) before a standing one, so when
 *     there are fewer duties than buses the buses left over are standing ones;
 *  2. a bus reporting the duty's route live takes that route's duty;
 *  3. a bus of the duty's service class;
 *  4. time fit: a duty started by the feed time on a bus on the road, a duty
 *     still to start on a standing bus;
 *  5. `ageYears x round(durationHours)`, so longer duties prefer younger buses;
 *     then the matcher's fixed scan order over buses sorted by registration.
 * A bus missing from the fleet master counts as ordinary at the master's
 * median age. The matching never fails: duties without a bus are reported as
 * `no_eligible_bus`, eligible buses without a duty as spare. Deterministic
 * whatever the order of `buses`; a repeated registration throws a RangeError.
 * Recommendation only.
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
      eligible.push({ bus, standing });
    } else excluded.push({ registrationNumber: bus.registrationNumber, reason: standing });
  }
  const feedMinute = now.kind === 'feed_time' ? now.feedMinute : null;
  const ctx = { fleet, fallbackAge: medianAge(fleet), feedMinute };
  const tiers = duties.map((duty) => eligible.map((c) => tiersOf(duty, c, ctx)));
  const largestBase = tiers.reduce(
    (most, row) => row.reduce((m, t) => Math.max(m, t[TIERS - 1] as number), most),
    0,
  );
  const weights = tierWeights(Math.min(duties.length, eligible.length), largestBase);
  const cost = tiers.map((row) =>
    row.map((t) => t.reduce((sum, value, i) => sum + value * (weights[i] as number), 0)),
  );
  const { rowToCol } = hungarian(cost);

  const assignments: DutyAssignment[] = duties.map((duty, row) => {
    const matched = eligible[rowToCol[row] ?? -1];
    return matched !== undefined
      ? {
          dutyId: duty.id,
          registrationNumber: matched.bus.registrationNumber,
          reason: 'assigned',
          busStanding: matched.standing,
        }
      : { dutyId: duty.id, registrationNumber: null, reason: 'no_eligible_bus', busStanding: null };
  });
  const used = new Set(rowToCol.filter((c) => c >= 0));
  return {
    assignments,
    spareBuses: eligible.filter((_, col) => !used.has(col)).map((c) => c.bus.registrationNumber),
    excluded,
    unassignedDuties: rowToCol.filter((c) => c < 0).length,
  };
}
