// The corridor shapes a trial can run on, and the demand that goes with each.
//
// ─── WHY MORE THAN ONE ───────────────────────────────────────────────────
//
// Almost every conclusion this trial reaches is a property of the CORRIDOR as
// much as of the controller, and running one shape would report the corridor's
// arithmetic as if it were the algorithm's.
//
// The clearest case is alighting-only (`mpc/boardingLimit.ts`). It fires when a
// bus is at a stop with another close behind, and its absolute left-behind cap
// is 240 seconds - somebody refused a bus must not wait longer than four
// minutes for the next. On the inter-city corridor, where the planned headway
// is 1,800 s, a bus within 240 s behind occurs on 1.8% of decisions, so the law
// declines almost always and correctly. That is not "Algorithm E does not
// work"; it is "Algorithm E is an urban lever", and only a second corridor can
// tell those apart.
//
// The same is true of the headline result. Holding is paid for by the people
// aboard and buys time for the people waiting, so whether it is worth doing
// depends on the ratio between them - which is a demand and headway question,
// not a control question.
//
// Both shapes are INVENTED, like everything else about the traffic here. What
// makes them worth having is that they differ in the ways that matter:
// headway, stop spacing, dwell, and how many passengers are aboard when a bus
// is asked to wait.
import { DEFAULT_FLEET_CORRIDOR, type FleetCorridorSpec } from './corridor.js';
import type { ModelledInputs } from '../rehearsal/run.js';

/**
 * The trial's own modelled demand, and why it is not the rehearsal's.
 *
 * ─── THE SATURATION TRAP ─────────────────────────────────────────────────
 *
 * A stop boards `rate x H* / 60` passengers and sheds `alightingFraction` of the
 * load, so the steady-state occupancy is `rate x (H* / 60) / alightingFraction`.
 * At 0.38/min against 26% on a 30-minute headway that is about 44 of 55 seats -
 * loaded, with headroom. Push it to the seat count and the corridor SATURATES,
 * and a saturated corridor is the one regime in which the headline metric
 * cannot respond to control at all: waiting time is bounded by how many seats
 * exist rather than by how they are spaced, and holding a full bus only
 * strands more people. An evaluation run there reports "no effect" about a
 * working controller. `evaluation/spec.ts` documents the same trap, and
 * `SpacingKpis.saturated` flags any arm that fell into it anyway.
 *
 * ─── DWELL IS AN INTER-CITY DWELL ────────────────────────────────────────
 *
 * 120 s at the door, not the 20 s of an urban stop. It matters more than it
 * looks: dwell is the feedback path that turns a late bus into a bunched pair,
 * because a late bus finds more passengers waiting and is delayed further by
 * collecting them. A trial with an urban dwell on an inter-city corridor would
 * have almost no such feedback and would be measuring travel-time noise alone.
 *
 * 60 km/h over 44 km legs makes a 400 km trip take about seven hours, which is
 * what an inter-city trunk actually looks like.
 */
export const FLEET_TRIAL_INPUTS: Partial<ModelledInputs> = {
  cruiseSpeedKmph: 60,
  travelTimeVariation: 0.14,
  boardingRatePerMinute: 0.38,
  alightingFraction: 0.26,
  baseDwellSeconds: 120,
  secondsPerBoarding: 2.5,
  secondsPerAlighting: 1.5,
  vehicleCapacity: 55,
};


export type CorridorPresetId = 'intercity' | 'suburban' | 'urban';

export interface CorridorPreset {
  id: CorridorPresetId;
  title: string;
  /** What this shape is, and what it is here to test that the other cannot. */
  description: string;
  corridor: FleetCorridorSpec;
  /** Demand and running times for this shape. Merged over the trial's shared defaults. */
  inputs: Partial<ModelledInputs>;
}

/**
 * The urban shape.
 *
 * 24 km, 25 stops a kilometre apart, a six-minute headway and an 18 km/h
 * running speed - a city trunk route, not a highway. Every number here was
 * chosen to put the corridor in the regime the inter-city one cannot reach:
 *
 *   * A bus is within four minutes of the one behind it often enough for
 *     alighting-only to have a decision to make.
 *   * Dwell is 20 s of door cycle rather than 120 s of an inter-city station
 *     stop, so the dwell-driven amplification loop turns over far faster.
 *   * Steady-state load is `rate x H* / 60 / alightingFraction` = about 29 of
 *     60 seats, so a bus is half full when it is asked to wait. That ratio -
 *     passengers aboard against passengers waiting - is what decides whether
 *     holding is worth doing at all, and it is the single biggest difference
 *     between the two shapes.
 */
export const URBAN_CORRIDOR: FleetCorridorSpec = {
  ...DEFAULT_FLEET_CORRIDOR,
  routeDirectionId: 'fleet-trial-urban',
  routeName: 'Trial corridor: 24 km city trunk',
  totalDistanceMeters: 24_000,
  stationCount: 25,
  targetHeadwaySeconds: 360,
  // Every stop is a holding point, matching the inter-city shape's convention.
  // The placement study varies this on both.
  holdingPointCount: undefined,
  maxHoldSeconds: 120,
  // Proportionate to the headway: a third of H* on both shapes.
  maxLatenessSeconds: 120,
};

/**
 * The shape between the other two.
 *
 * 60 km, fifteen stops 4.3 km apart, a twelve-minute headway. It exists to
 * answer a question the two extremes cannot: whether the difference between
 * them - the controller roughly break-even on one and strongly positive on the
 * other - is a THRESHOLD the corridor crosses or a GRADIENT it slides along.
 *
 * Twelve minutes is also the headway the industry draws its own line at:
 * below it passengers turn up rather than consulting a timetable, so headway
 * regularity IS the punctuality objective; above it they plan around a
 * published departure and lateness starts to matter on its own account.
 */
export const SUBURBAN_CORRIDOR: FleetCorridorSpec = {
  ...DEFAULT_FLEET_CORRIDOR,
  routeDirectionId: 'fleet-trial-suburban',
  routeName: 'Trial corridor: 60 km suburban radial',
  totalDistanceMeters: 60_000,
  stationCount: 15,
  targetHeadwaySeconds: 720,
  holdingPointCount: undefined,
  maxHoldSeconds: 240,
  maxLatenessSeconds: 240,
};

export const CORRIDOR_PRESETS: Record<CorridorPresetId, CorridorPreset> = {
  intercity: {
    id: 'intercity',
    title: '400 km inter-city trunk',
    description:
      'Ten stations 44 km apart, a thirty-minute headway, and buses carrying about forty-four of fifty-five seats. Long legs, long dwells, and a large load paying for every hold.',
    corridor: DEFAULT_FLEET_CORRIDOR,
    inputs: FLEET_TRIAL_INPUTS,
  },
  suburban: {
    id: 'suburban',
    title: '60 km suburban radial',
    description:
      'Fifteen stops about four kilometres apart, a twelve-minute headway, and buses around two thirds full. The shape between the other two, and the headway the industry draws its own line at between turning up and consulting a timetable.',
    corridor: SUBURBAN_CORRIDOR,
    inputs: {
      cruiseSpeedKmph: 32,
      travelTimeVariation: 0.16,
      boardingRatePerMinute: 0.75,
      alightingFraction: 0.25,
      baseDwellSeconds: 45,
      secondsPerBoarding: 2.5,
      secondsPerAlighting: 1.5,
      vehicleCapacity: 55,
    },
  },
  urban: {
    id: 'urban',
    title: '24 km city trunk',
    description:
      'Twenty-five stops a kilometre apart, a six-minute headway, and buses about half full. Short legs and fast turnover, which is the regime alighting-only was designed for and the one the inter-city corridor cannot reach.',
    corridor: URBAN_CORRIDOR,
    inputs: {
      cruiseSpeedKmph: 18,
      travelTimeVariation: 0.18,
      boardingRatePerMinute: 1.2,
      alightingFraction: 0.25,
      baseDwellSeconds: 20,
      secondsPerBoarding: 2.5,
      secondsPerAlighting: 1.5,
      vehicleCapacity: 60,
    },
  },
};
