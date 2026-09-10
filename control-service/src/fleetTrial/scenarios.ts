// The ways a bus corridor comes apart, as scenarios.
//
// ─── WHY TEN OF THEM AND NOT ONE ─────────────────────────────────────────
//
// Bunching is a single word for several different failures, and a controller
// that fixes one of them can be useless or harmful on another. A late bus
// with a healthy fleet behind it is a problem with ONE culprit, and holding
// its follower is exactly right. A congestion window that delays every bus
// inside it and none outside it has NO culprit - the platoon it compresses is
// full of buses that each did nothing wrong - and the same reflex applied
// there holds buses that are already late. A trial that ran one scenario and
// reported an average would hide that difference behind a mean.
//
// Every archetype below is composed from the engine's own disturbance
// primitives (`simulation/types.ts#Disturbance`) plus the two levers that
// are not disturbances at all: what the modelled inputs are, and when the
// buses are dispatched. Nothing here reaches into the engine.
//
// ─── PLACEMENT IS LOAD-BEARING ───────────────────────────────────────────
//
// A disturbance window has to be put where the buses actually ARE. The
// rehearsal's own scenario builder learned this the expensive way: a window
// expressed in multiples of H* on a 164 km corridor closed roughly two hours
// before the first bus reached the target stop, and the "disturbed" run
// returned results byte-identical to the undisturbed one. Every window below
// is therefore placed against `freeFlowSecondsTo`, the modelled running time
// to the station it targets, and never against the clock alone.
import { Rng } from '../simulation/rng.js';
import type { Disturbance, TerminalDispatchPlan } from '../simulation/types.js';
import type { ModelledInputs } from '../rehearsal/run.js';
import type { CorridorInputs } from '../rehearsal/corridor.js';

export type BunchingScenarioId =
  | 'steady_variability'
  | 'terminal_jitter'
  | 'station_surge'
  | 'slow_bus'
  | 'traffic_shock'
  | 'missed_trip'
  | 'cascade'
  | 'peak_load'
  | 'gps_dropout'
  | 'driver_non_compliance'
  // ─── THE ADVERSARIAL SET ───────────────────────────────────────────────
  //
  // The ten above are the ways a corridor comes apart. These eight are the
  // ways the CONTROLLER comes apart, which is a different question and the
  // reason they were added: measured on the library as it stood, the laws
  // improved net passenger time on nine of ten urban scenarios and seven of
  // ten inter-city ones, and a library a controller mostly passes is not
  // measuring its limits. Each one below names, in its own `whatItTests`, the
  // specific assumption it is built to break.
  | 'phantom_position'
  | 'frozen_feed'
  | 'blind_slowdown'
  | 'hotspot_demand'
  | 'partial_compliance'
  | 'oversaturated'
  | 'shock_and_recovery'
  | 'oscillating_shock'
  | 'building_peak';

export interface ScenarioBuildContext {
  corridor: CorridorInputs;
  inputs: ModelledInputs;
  /** The undisturbed plan: a warm-up run at second 0, then one bus every H*. */
  dispatches: readonly TerminalDispatchPlan[];
  targetHeadwaySeconds: number;
  /**
   * Modelled free-flow running time from the origin to a station, seconds.
   *
   * A property holding a function rather than a method, so destructuring it out
   * of the context (which every scenario below does) cannot be mistaken for
   * detaching a method from its receiver.
   */
  readonly freeFlowSecondsTo: (stopIndex: number) => number;
  /** Seeded, so a scenario's own randomness reproduces with the run. */
  rng: Rng;
}

export interface ScenarioPlan {
  dispatches: TerminalDispatchPlan[];
  disturbances: Disturbance[];
}

export interface BunchingScenario {
  id: BunchingScenarioId;
  title: string;
  /** What physically goes wrong, in one sentence an operator would recognise. */
  mechanism: string;
  /** What a reader should look for in this scenario's numbers. */
  whatItTests: string;
  /**
   * How this scenario perturbs the corridor's own demand and variability,
   * as MULTIPLIERS rather than absolute values.
   *
   * ─── WHY NOT ABSOLUTE ────────────────────────────────────────────────
   *
   * These used to be absolute numbers, and they were tuned for the inter-city
   * corridor. On the urban one they inverted: `peak_load` set 0.48 boardings
   * per minute against an urban default of 1.2, so the scenario whose entire
   * purpose is to load the corridor up became the LIGHTEST one it runs, and
   * `steady_variability` set 0.16 against a default of 0.18 and quietly made
   * the corridor calmer. Both were still reported under their own names,
   * describing conditions that were the opposite of what they claim.
   *
   * A scenario is a perturbation, and a perturbation only means anything
   * relative to what it perturbs. 1 leaves a field alone.
   */
  inputScale: {
    boardingRatePerMinute?: number;
    alightingFraction?: number;
    travelTimeVariation?: number;
  };
  build(context: ScenarioBuildContext): ScenarioPlan;
}

/**
 * Reported buses only, in dispatch order.
 *
 * The warm-up run is machinery - it exists to clear the standing passenger
 * queue that a model starting at midnight would otherwise hand to the first
 * real bus (see `rehearsal/run.ts#WARMUP_VEHICLE_ID`) - and disturbing it
 * would disturb the very thing it is there to normalise.
 */
function reportedDispatches(
  dispatches: readonly TerminalDispatchPlan[],
): TerminalDispatchPlan[] {
  return dispatches.filter((d) => d.vehicleId !== 'WARMUP');
}

/**
 * A spread of buses through the run, rather than one bus near the front.
 *
 * The rehearsal targets a single vehicle because a rehearsal is one operator
 * looking at one corridor for one afternoon. A trial at fleet scale is asking
 * a statistical question, and one disturbed bus in fifty answers it with a
 * sample of one. Skipping the first and last few leaves every disturbed bus
 * with both a leader and a follower for the control laws to work with.
 */
function spreadTargets(
  dispatches: readonly TerminalDispatchPlan[],
  count: number,
): TerminalDispatchPlan[] {
  const reported = reportedDispatches(dispatches);
  // The first bus has no leader and the last has no follower; a disturbance
  // on either measures the edge of the fixture rather than the corridor.
  const eligible = reported.slice(1, Math.max(1, reported.length - 1));
  if (eligible.length === 0 || count <= 0) return [];
  if (count >= eligible.length) return [...eligible];

  const step = eligible.length / count;
  const picked: TerminalDispatchPlan[] = [];
  for (let i = 0; i < count; i++) {
    const item = eligible[Math.floor(i * step)];
    if (item) picked.push(item);
  }
  return picked;
}

/** How many buses a per-vehicle disturbance hits: a fixed SHARE of the fleet, so a bigger trial is not a milder one. */
function targetCount(dispatches: readonly TerminalDispatchPlan[], share: number): number {
  return Math.max(1, Math.round(reportedDispatches(dispatches).length * share));
}

/**
 * When a bus is actually due at a station: running time PLUS the dwell it
 * spends at every station before that one.
 *
 * ─── FREE-FLOW IS NOT AN ARRIVAL TIME ────────────────────────────────────
 *
 * `freeFlowSecondsTo` is running time alone, and on a stopping corridor that
 * is a large underestimate of when a bus gets anywhere: the urban preset's
 * buses spend about 49 s at each of twenty-five stops, so the middle of the
 * route arrives roughly TEN MINUTES - nearly two headways - after free flow
 * says it does. A window placed on the free-flow instant and lasting one
 * hold is therefore a window the target bus never enters.
 *
 * That is the same class of error the file header records for the rehearsal's
 * builder, one level in: placing against running time instead of the clock
 * fixed the corridor-length mistake and left the dwell one. It matters for
 * any window NARROWER than the error, which is every window below - the
 * originals above are wide enough to overlap the true arrival anyway, and are
 * deliberately left as they are so this library's ten baseline scenarios go
 * on meaning exactly what they meant before.
 *
 * Steady-state dwell, from the corridor's own modelled demand. A stop boards
 * `rate x H* / 60` passengers, and in steady state it sheds the same number
 * it takes on, so both terms use that one figure.
 */
function modelledArrivalSecondsTo(context: ScenarioBuildContext, stopIndex: number): number {
  // A bus arriving at `stopIndex` has stood at the `stopIndex` stops before it.
  return context.freeFlowSecondsTo(stopIndex) + modelledDwellSeconds(context) * stopIndex;
}

/** How long a bus stands at one stop under this corridor's own steady-state demand. */
function modelledDwellSeconds(context: ScenarioBuildContext): number {
  const { inputs, targetHeadwaySeconds } = context;
  const boardingsPerStop = (inputs.boardingRatePerMinute * targetHeadwaySeconds) / 60;
  return (
    inputs.baseDwellSeconds +
    (inputs.secondsPerBoarding + inputs.secondsPerAlighting) * boardingsPerStop
  );
}

/**
 * When the last reported bus finishes its trip: the end of the run, in the
 * same clock every disturbance window is placed against.
 *
 * A scenario whose window has to cover the WHOLE run needs this rather than a
 * large constant, for the reason the file header gives: a window in absolute
 * seconds means something different on a 24 km corridor and a 400 km one.
 */
function runHorizonSeconds(context: ScenarioBuildContext): number {
  const reported = reportedDispatches(context.dispatches);
  const last = reported[reported.length - 1];
  return (
    (last?.scheduledDispatchSeconds ?? 0) +
    modelledArrivalSecondsTo(context, context.corridor.stops.length - 1)
  );
}

/**
 * How far a bus travels in one headway, in metres, at this corridor's own
 * modelled pace.
 *
 * The natural unit for a POSITION error, and the reason the estimator
 * scenarios below are expressed in it. A 600 m lie is a whole headway on the
 * urban corridor and a rounding error on the inter-city one; "0.8 of a
 * headway's distance" is the same lie on both, which is what `inputScale`
 * already insists on for demand and what the file header insists on for time.
 */
function headwayDistanceMeters(context: ScenarioBuildContext): number {
  const { corridor, targetHeadwaySeconds } = context;
  // Against the time a trip ACTUALLY takes, dwell included: that is what sets
  // how many buses are on the corridor at once, and therefore how far apart
  // they stand. Free-flow running time would put them a third closer together
  // on the urban preset and understate every position error below.
  const tripSeconds = modelledArrivalSecondsTo(context, corridor.stops.length - 1);
  if (tripSeconds <= 0) return 0;
  return (corridor.totalDistanceMeters / tripSeconds) * targetHeadwaySeconds;
}

export const BUNCHING_SCENARIOS: readonly BunchingScenario[] = [
  {
    id: 'steady_variability',
    title: 'Ordinary day',
    mechanism:
      'Nothing goes wrong. Running times between stations simply vary, as they always do, and gaps drift apart and back together on their own.',
    whatItTests:
      'Whether the controller earns its keep when there is no incident to point at. This is the regime the corridor is in for most of every day, so a control law that only helps during a crisis helps almost never.',
    // Above the corridor's own variability: this is the scenario whose entire
    // content is that variation, so it has to be more of it than an ordinary day.
    inputScale: { travelTimeVariation: 1.2 },
    build: ({ dispatches }) => ({ dispatches: [...dispatches], disturbances: [] }),
  },

  {
    id: 'terminal_jitter',
    title: 'Ragged departures',
    mechanism:
      'Buses leave the origin at irregular intervals rather than one every headway - a driver signing on late, a vehicle swap, a platform conflict.',
    whatItTests:
      'Terminal dispatch regulation, which is the one lever that costs no passenger their seat. A gap that leaves the terminal wrong is a gap that stays wrong for 400 km unless something corrects it there.',
    inputScale: {},
    build: ({ dispatches, targetHeadwaySeconds, rng }) => {
      // +/- 35% of H*. Large enough that the chain leaves the terminal already
      // unevenly spaced, small enough that dispatch ORDER never changes - a
      // reordered dispatch would break the engine's no-overtake bookkeeping,
      // which assumes dispatch order is corridor order.
      const jitterSeconds = targetHeadwaySeconds * 0.35;
      const jittered = dispatches.map((dispatch) => {
        if (dispatch.vehicleId === 'WARMUP') return { ...dispatch };
        const offset = (rng.next() * 2 - 1) * jitterSeconds;
        return {
          ...dispatch,
          scheduledDispatchSeconds: Math.max(0, dispatch.scheduledDispatchSeconds + offset),
        };
      });
      // Re-sorted so the plan stays monotonic even if two jitters crossed.
      // The engine sorts internally too, but a plan that disagrees with the
      // order it will actually be run in is a plan nobody can read.
      jittered.sort((a, b) => a.scheduledDispatchSeconds - b.scheduledDispatchSeconds);
      return { dispatches: jittered, disturbances: [] };
    },
  },

  {
    id: 'station_surge',
    title: 'Crowd at a station',
    mechanism:
      'A burst of passengers builds at one mid-route station - a connecting train, a market day, an event ending. The bus that arrives into it dwells far longer than usual and falls behind.',
    whatItTests:
      'The classic dwell-driven bunch: a long dwell makes a bus late, being late means more passengers waiting at the next station, and the bus behind it closes the gap. This is the failure the whole control theory exists for.',
    inputScale: {},
    build: ({ corridor, dispatches, targetHeadwaySeconds, freeFlowSecondsTo }) => {
      const targets = spreadTargets(dispatches, targetCount(dispatches, 0.12));
      // Mid-corridor: far enough in that a bunch has room to propagate to
      // several stations behind it, not so far that it never reaches one.
      const stopIndex = Math.floor(corridor.stops.length / 2);
      const stop = corridor.stops[stopIndex];
      if (!stop) return { dispatches: [...dispatches], disturbances: [] };

      const runningSeconds = freeFlowSecondsTo(stopIndex);
      const disturbances: Disturbance[] = targets.map((target) => {
        const centre = target.scheduledDispatchSeconds + runningSeconds;
        return {
          type: 'demand_burst',
          stopId: stop.stopId,
          // Opens half a headway before the target bus is due and closes a
          // headway after, so the surge is genuinely waiting when it arrives
          // and has not fully drained when its follower gets there.
          startSeconds: Math.max(0, centre - targetHeadwaySeconds * 0.5),
          endSeconds: centre + targetHeadwaySeconds,
          multiplier: 9,
        };
      });
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'slow_bus',
    title: 'One bus running late',
    mechanism:
      'A vehicle runs well below the fleet pace over the middle third of the route - a mechanical fault, a cautious relief driver, a long boarding sequence repeated at every stop.',
    whatItTests:
      'A bunch with exactly one culprit, which is the case a hold is unambiguously right for: the bus behind should be held, and the gap in front of the slow bus should not be made worse by holding it too.',
    inputScale: {},
    build: ({ corridor, dispatches }) => {
      const targets = spreadTargets(dispatches, targetCount(dispatches, 0.12));
      const third = Math.max(1, Math.floor(corridor.stops.length / 3));
      const disturbances: Disturbance[] = targets.map((target) => ({
        type: 'slow_vehicle',
        vehicleId: target.vehicleId,
        // 1.5x on a 44 km link is about 22 extra minutes over the affected
        // stretch - one and a half headways, so the follower genuinely closes
        // rather than merely gaining on it.
        multiplier: 1.5,
        fromStopIndex: third,
        toStopIndex: third * 2,
      }));
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'traffic_shock',
    title: 'Congestion window',
    mechanism:
      'A stretch of the route runs slow for an hour or two, for every bus that enters it - weather, an incident on the carriageway, a diversion.',
    whatItTests:
      'The hardest case for a holding controller, and the reason this scenario is here. Every bus inside the window is delayed and none outside it is, so the platoon compresses with no single bus at fault - and the honest answer may be that holding helps little.',
    inputScale: {},
    build: ({ corridor, targetHeadwaySeconds, dispatches, freeFlowSecondsTo }) => {
      const lastIndex = corridor.stops.length - 1;
      const fromStopIndex = Math.max(1, Math.floor(corridor.stops.length * 0.3));
      const toStopIndex = Math.min(lastIndex, Math.floor(corridor.stops.length * 0.6));
      const reported = reportedDispatches(dispatches);
      const last = reported[reported.length - 1];
      const horizonSeconds = (last?.scheduledDispatchSeconds ?? 0) + freeFlowSecondsTo(lastIndex);

      // Three windows spread across the run rather than one: a single window
      // in a 20-hour run is one event, and one event is not a measurement.
      const windowSeconds = targetHeadwaySeconds * 5;
      const disturbances: Disturbance[] = [];
      for (let i = 1; i <= 3; i++) {
        const startSeconds = (horizonSeconds * i) / 4 - windowSeconds / 2;
        disturbances.push({
          type: 'link_slowdown',
          startSeconds: Math.max(0, startSeconds),
          endSeconds: Math.max(0, startSeconds) + windowSeconds,
          multiplier: 1.9,
          fromStopIndex,
          toStopIndex,
        });
      }
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'missed_trip',
    title: 'Cancelled departures',
    mechanism:
      'Scheduled trips do not run at all - no vehicle, no driver, a breakdown before sign-on. The gap in front of the next bus is twice what it should be.',
    whatItTests:
      'Whether the controller makes a double gap worse. The bus following a cancellation is late through no fault of its own and is carrying two headways of passengers; holding it would be exactly the wrong instinct, and the safety filter and the objective both exist to prevent that.',
    inputScale: {},
    build: ({ dispatches }) => {
      const targets = spreadTargets(dispatches, targetCount(dispatches, 0.08));
      const disturbances: Disturbance[] = targets.map((target) => ({
        type: 'missed_trip',
        vehicleId: target.vehicleId,
      }));
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'cascade',
    title: 'Compounding failure',
    mechanism:
      'A slow bus runs into a crowded station on a day when running times are already unreliable. Each problem alone is survivable; together they feed each other.',
    whatItTests:
      'Whether a correction that works on an isolated fault still works when the corridor is already unstable. This is the scenario where a controller that only ever reacts arrives too late, and where the predictive tier has something to prove.',
    inputScale: { travelTimeVariation: 1.6 },
    build: (context) => {
      const { corridor, dispatches, targetHeadwaySeconds, freeFlowSecondsTo } = context;
      const targets = spreadTargets(dispatches, targetCount(dispatches, 0.12));
      const third = Math.max(1, Math.floor(corridor.stops.length / 3));
      const surgeIndex = Math.min(corridor.stops.length - 2, third * 2);
      const surgeStop = corridor.stops[surgeIndex];
      const runningSeconds = freeFlowSecondsTo(surgeIndex);

      const disturbances: Disturbance[] = [];
      for (const target of targets) {
        disturbances.push({
          type: 'slow_vehicle',
          vehicleId: target.vehicleId,
          multiplier: 1.4,
          fromStopIndex: third,
          toStopIndex: surgeIndex,
        });
        if (!surgeStop) continue;
        const centre = target.scheduledDispatchSeconds + runningSeconds;
        disturbances.push({
          type: 'demand_burst',
          stopId: surgeStop.stopId,
          startSeconds: Math.max(0, centre - targetHeadwaySeconds * 0.5),
          endSeconds: centre + targetHeadwaySeconds,
          multiplier: 7,
        });
      }
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'peak_load',
    title: 'Peak loading',
    mechanism:
      'Demand across every station is high enough that buses run close to their seat capacity, and dwell time is dominated by boarding rather than by the door cycle.',
    whatItTests:
      'Bunching driven by load rather than by any incident, and the regime where holding a full bus is most expensive. Watch the denied-boarding count next to the wait-time gain: a controller that improves spacing by stranding people has not improved anything.',
    // Enough to push the corridor towards its seats without going through
    // them. Past the saturation line waiting time is bounded by how many seats
    // exist rather than by how they are spaced, and a working controller
    // correctly reports "no effect" - `SpacingKpis.saturated` flags any arm
    // that crossed it anyway.
    inputScale: { boardingRatePerMinute: 1.3 },
    build: ({ dispatches }) => ({ dispatches: [...dispatches], disturbances: [] }),
  },

  {
    id: 'gps_dropout',
    title: 'Vehicles off the map',
    mechanism:
      'Buses stop reporting their position - a dead unit, a coverage hole, a modem that never came back after a depot power cycle.',
    whatItTests:
      'That the system refuses to act rather than guessing. A dropped feed does not delete the last known position; it makes its AGE the reason not to issue a command, and the correct number of holds issued to an unobserved bus is zero.',
    inputScale: {},
    build: ({ dispatches }) => {
      const targets = spreadTargets(dispatches, targetCount(dispatches, 0.1));
      const disturbances: Disturbance[] = targets.map((target) => ({
        type: 'gps_dropout',
        vehicleId: target.vehicleId,
        // The whole trip: a unit that fails at sign-on is the common case, and
        // a partial dropout would mix "refused correctly" with "acted on a
        // recovered feed" inside one number.
        startSeconds: 0,
        endSeconds: Number.MAX_SAFE_INTEGER,
      }));
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'driver_non_compliance',
    title: 'Instructions not followed',
    mechanism:
      'Drivers receive hold instructions and do not take them - running late already, a passenger dispute, or simply not trusting the screen.',
    whatItTests:
      'Whether the benefit survives partial compliance. A gain set that only wins when every instruction is obeyed is not a recommendation: the reference deployment this controller is modelled on achieved its results at between a third and a half compliance.',
    inputScale: {},
    build: ({ dispatches }) => {
      // FLEET-WIDE, not one bad actor. The question is whether a service where
      // nobody much follows instructions still improves, which is a different
      // question from whether one refusing driver breaks the corridor.
      const disturbances: Disturbance[] = reportedDispatches(dispatches).map((dispatch) => ({
        type: 'non_compliance',
        vehicleId: dispatch.vehicleId,
        complianceProbability: 0.45,
      }));
      return { dispatches: [...dispatches], disturbances };
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  //
  //   THE ADVERSARIAL SET
  //
  //   Everything above describes a corridor. Everything below describes an
  //   ATTACK on a specific thing the control laws take for granted, and each
  //   one says which. They were written because the library as it stood was
  //   being passed: nine of ten urban scenarios and seven of ten inter-city
  //   ones came out positive, which measures the corridor rather than the
  //   controller's limits.
  //
  //   The rule for reading them is the same as for the ten above, and it
  //   cuts both ways: a scenario the uncontrolled arm sails through is not
  //   hard, it is only new, so each is reported with its own UNCONTROLLED
  //   bunching rate and excess wait next to the originals. And a scenario
  //   the controller loses is a finding about the controller, never a reason
  //   to soften the scenario.
  //
  //   ONE EXCEPTION to the first half, and it is structural rather than an
  //   excuse: an ESTIMATOR attack cannot raise the uncontrolled arm's
  //   bunching, because that arm never reads the estimator. Its baseline is
  //   an ordinary day by construction. `phantom_position`, `frozen_feed` and
  //   the GPS half of `blind_slowdown` are read on the controlled arm's gain
  //   COLLAPSING instead - measured, inter-city excess-wait gain falls from
  //   22% on an ordinary day to 13% under `blind_slowdown` on the same
  //   number of hold seconds.
  //
  // ─────────────────────────────────────────────────────────────────────────

  // ─── A SCENARIO THAT WAS TRIED AND IS NOT HERE: `hold_ambush` ─────────
  //
  // A crowd arriving at a station in exactly the window a bus is being held
  // there - the disturbance timed to land ON the correction. It was built,
  // measured over six seeds on all three presets in two forms (one station,
  // then every third station across the middle half of the route), and
  // REMOVED, because it made the controller look BETTER rather than worse:
  // urban net passenger time +4.6% over 6/6 seeds against a library mean
  // near +2.6%, and an excess-wait gain of 61%, the second highest of any
  // scenario.
  //
  // The reason is in `simulation/engine.ts`, and it is deliberate there:
  // passengers who walk on during a hold cost NO extra dwell, because the
  // door cycle they board through is already in the dwell figure and charging
  // a second one would charge twice for it. So an ambush cannot compound - it
  // moves load onto the held bus and never turns into more delay, and the
  // extra demand it puts on the corridor is simply more bunching for the
  // controller to fix. Expressing "a disturbance conditional on a hold" needs
  // an engine that can react to a decision, which this one deliberately
  // cannot: disturbances are planned before the run and are identical in both
  // arms, which is what makes the two arms comparable at all.
  //
  // `oscillating_shock` below is the adversarial-TIMING scenario this engine
  // can express, and it does bite.

  {
    id: 'phantom_position',
    title: 'Positions drifting off the road',
    mechanism:
      'A share of the fleet reports positions that are steadily and increasingly wrong - a receiver with no satellite fix, dead-reckoning on wheel ticks, its error growing all trip. Half the affected buses report themselves ahead of where they are and half behind.',
    whatItTests:
      'The gap between "no data" and "wrong data", which the deployed guards do not have. A dropped feed goes stale and `mpc/safety.ts` refuses to command it by name. A drifting feed is fresh, well-formed and consistent, so nothing refuses it: the gap in metres is measured against a fiction, the pace median is taken over fictions, and the chain can be ranked with a bus on the wrong side of its neighbour. Every hold this scenario produces is issued with full confidence and the wrong number of seconds.',
    inputScale: {},
    build: (context) => {
      const { corridor, dispatches } = context;
      const targets = spreadTargets(dispatches, targetCount(dispatches, 0.2));
      const tripSeconds = modelledArrivalSecondsTo(context, corridor.stops.length - 1);
      if (tripSeconds <= 0) return { dispatches: [...dispatches], disturbances: [] };
      // The error reaches ONE HEADWAY'S DISTANCE by the end of a trip. Less
      // and the lie is inside the noise the laws already tolerate; more and
      // it is so large that a plausibility check nobody has written would
      // catch it. One headway is the scale at which the lie is exactly the
      // quantity being controlled.
      const driftMetersPerSecond = headwayDistanceMeters(context) / tripSeconds;

      const disturbances: Disturbance[] = targets.map((target, i) => ({
        type: 'gps_bias',
        vehicleId: target.vehicleId,
        // From dispatch, because a unit that cannot get a fix cannot get one
        // in the depot either. Open-ended: it does not come back.
        startSeconds: target.scheduledDispatchSeconds,
        endSeconds: Number.MAX_SAFE_INTEGER,
        // Alternating sign, so the corridor gets both failures at once: a bus
        // reported ahead of itself invites a hold on the bus behind that
        // nothing justifies, and one reported behind itself hides a gap that
        // is really closing. A single sign would let a reader mistake the
        // result for a constant offset the laws could in principle learn.
        driftMetersPerSecond: i % 2 === 0 ? driftMetersPerSecond : -driftMetersPerSecond,
      }));
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'frozen_feed',
    title: 'Last known position, fresh timestamp',
    mechanism:
      'A modem hangs partway through the trip and keeps publishing the last fix it obtained, with the current time on it. The bus is still running; its feed says it has not moved since.',
    whatItTests:
      'The staleness guard, which keys on the AGE of a report and not on whether the report is true. This data is old and nothing about it says so, so `isStateStale` is false, the safety filter passes it, and the controller commands a bus it believes is parked mid-route. It is also the hardest case for the neighbours: a phantom sitting still in the middle of the corridor is the nearest leader for every bus behind it, so their gaps are measured to a bus that is no longer there.',
    inputScale: {},
    build: (context) => {
      const { corridor, dispatches } = context;
      const targets = spreadTargets(dispatches, targetCount(dispatches, 0.15));
      // A third of the way in, so each affected bus has a stretch of honest
      // reporting first. A feed that was frozen from second zero would freeze
      // at the origin, where every bus starts and where the phantom would sit
      // harmlessly behind the whole fleet.
      const freezeAfterSeconds = modelledArrivalSecondsTo(context, corridor.stops.length - 1) / 3;
      const disturbances: Disturbance[] = targets.map((target) => ({
        type: 'gps_bias',
        vehicleId: target.vehicleId,
        startSeconds: target.scheduledDispatchSeconds + freezeAfterSeconds,
        endSeconds: Number.MAX_SAFE_INTEGER,
        freeze: true,
      }));
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'blind_slowdown',
    title: 'Congestion the map gets wrong',
    mechanism:
      'A stretch of the route runs slow for every bus in it, and the buses in it are the ones whose position has snapped a block off the line - map-matched onto the opposite carriageway of a divided road, or onto the return leg of a loop.',
    whatItTests:
      'Two failures at once, which is how the difficult days actually arrive. `traffic_shock` is already the hardest case for a holding law because the platoon it compresses has no single culprit; here the estimator additionally names the wrong one. The question is not whether the controller helps - it is whether a controller that cannot see the corridor does LESS harm than one that can see it wrongly and acts with conviction.',
    inputScale: { travelTimeVariation: 1.2 },
    build: (context) => {
      const { corridor, dispatches, targetHeadwaySeconds } = context;
      const lastIndex = corridor.stops.length - 1;
      const fromStopIndex = Math.max(1, Math.floor(corridor.stops.length * 0.3));
      const toStopIndex = Math.min(lastIndex, Math.floor(corridor.stops.length * 0.6));
      const horizonSeconds = runHorizonSeconds(context);
      const windowSeconds = targetHeadwaySeconds * 5;

      const disturbances: Disturbance[] = [];
      for (let i = 1; i <= 3; i++) {
        const startSeconds = Math.max(0, (horizonSeconds * i) / 4 - windowSeconds / 2);
        disturbances.push({
          type: 'link_slowdown',
          startSeconds,
          endSeconds: startSeconds + windowSeconds,
          multiplier: 1.9,
          fromStopIndex,
          toStopIndex,
        });
      }

      // A CONSTANT offset rather than a drift, and that is the point of
      // having both scenarios: a snapped fix is wrong by the same amount for
      // as long as the vehicle is on that stretch of road, so it looks
      // perfectly stable to anything watching for a jump.
      const offsetMeters = headwayDistanceMeters(context) * 0.8;
      const targets = spreadTargets(dispatches, targetCount(dispatches, 0.2));
      const slowdownStart = modelledArrivalSecondsTo(context, fromStopIndex);
      const slowdownEnd = modelledArrivalSecondsTo(context, toStopIndex);
      for (const [i, target] of targets.entries()) {
        disturbances.push({
          type: 'gps_bias',
          vehicleId: target.vehicleId,
          // Only while the bus is on the affected stretch - the road is what
          // is mis-mapped, not the vehicle - so the lie arrives and clears
          // with the congestion rather than lasting the whole trip.
          startSeconds: target.scheduledDispatchSeconds + slowdownStart,
          endSeconds: target.scheduledDispatchSeconds + slowdownEnd,
          offsetMeters: i % 2 === 0 ? offsetMeters : -offsetMeters,
        });
      }
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'hotspot_demand',
    title: 'Five stops carry the route',
    mechanism:
      'Almost nobody boards along most of the corridor, and then five stations carry nearly all of it - an interchange, a hospital, a college, two shopping streets. People ride between those five and get off quickly. Total demand is ordinary; its distribution is not.',
    whatItTests:
      "The objective's arrival rate, which is `1 / H*` at every stop on the corridor (`mpc/objective.ts#arrivalRatePaxPerSecond`) and therefore cannot tell these stops apart. A hold at an empty stop is priced exactly like a hold at the stop where two hundred people are waiting, so the benefit term is overstated at four stops in five and understated at the one where two hundred people are waiting. It also puts the holding points and the hotspots in different places, which the placement study assumes away.",
    // Thinned out everywhere, and the bursts below put back exactly what was
    // taken away - see the multiplier's derivation in `build`. The scenario
    // is about WHERE the passengers are; a version that was also busier would
    // confound that with `peak_load`, and a version busy enough to fill the
    // seats would confound it with `oversaturated`. MEASURED at a flat
    // multiplier of 14: the three hotspots denied 30% of offered passengers
    // on the suburban preset and 47% on the inter-city one, both well past
    // the saturation line, so what the row actually reported was saturation
    // under another name.
    // Faster turnover as well as an uneven distribution, because that is what
    // a hotspot route physically IS: people board at the interchange and get
    // off at the hospital rather than riding the length of the line. It is
    // also what makes the concentration expressible at all - a bus that keeps
    // its load has no room to take five stops' worth of passengers at one
    // kerb, and every version of this scenario without it crossed the
    // saturation line at the hotspots on at least one preset.
    inputScale: { boardingRatePerMinute: 0.25, alightingFraction: 1.4 },
    build: (context) => {
      const { corridor, dispatches } = context;
      const horizonSeconds = runHorizonSeconds(context);
      const count = corridor.stops.length;
      // Spread through the route rather than adjacent: a single busy district
      // is one disturbance, and three separated ones make the corridor's load
      // profile genuinely uneven along its length.
      // FIVE, not three. Three is the shape an operator would describe, and
      // measured it cannot be run: concentrating a whole route's demand into
      // three kerbs asks one bus to absorb eight stops' worth of passengers in
      // one door cycle, which overflows the seats on every preset however the
      // total is set. Five is the fewest that fits inside the fleet's capacity
      // while still leaving four fifths of the route nearly empty.
      const hotspotIndexes = [0.12, 0.3, 0.5, 0.68, 0.86]
        .map((f) => Math.floor(count * f))
        .filter((i, at, all) => i > 0 && i < count - 1 && all.indexOf(i) === at);
      if (hotspotIndexes.length === 0) return { dispatches: [...dispatches], disturbances: [] };

      // Solved rather than guessed, on two constraints.
      //
      // WHERE: the hotspots carry whatever the thinned stops gave up, so the
      // shape of the route is the scenario. A FIXED multiplier cannot do that
      // on three corridor shapes at once - the same number is a mild
      // concentration across twenty-five stops and a crush across ten, and
      // measured at a flat 14 it denied 30% of offered passengers on the
      // suburban preset and 47% on the inter-city one.
      //
      // HOW MUCH: a little BELOW the corridor's ordinary total, not equal to
      // it. Concentration costs capacity - a hotspot hands one bus several
      // stops' worth of passengers at one kerb - and a run that crosses the
      // saturation line is one where nothing can be read (`oversaturated` is
      // where that question is asked on purpose). With five hotspots, a
      // faster alighting fraction and 0.8 of the usual total, every preset
      // lands its busiest stop inside the seat count with room to spare.
      const THINNED = 0.25;
      const TOTAL_SHARE_OF_NORMAL = 0.8;
      const multiplier =
        (TOTAL_SHARE_OF_NORMAL * count - THINNED * (count - hotspotIndexes.length)) /
        (THINNED * hotspotIndexes.length);

      const disturbances: Disturbance[] = [];
      for (const index of hotspotIndexes) {
        const stop = corridor.stops[index];
        if (!stop) continue;
        disturbances.push({
          type: 'demand_burst',
          stopId: stop.stopId,
          // All day, not a window. This is what the route IS, not something
          // that happens to it.
          startSeconds: 0,
          endSeconds: horizonSeconds,
          multiplier,
        });
      }
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'partial_compliance',
    title: 'Instructions half-followed',
    mechanism:
      'Compliance is a spectrum rather than a coin. Some drivers ignore the screen; some accept the instruction and pull away after twenty seconds of a ninety-second hold; some start serving it a minute late; a few do exactly as asked.',
    whatItTests:
      'Whether a partly-served hold is worth anything, and whether the compliance rate can tell. A driver who serves a quarter of a hold has paid the whole onboard cost of stopping and bought almost none of the spacing - the worst of both - and `SimulatedStopVisit.compliant` records them as having complied, because they did. Compare the reported compliance rate against the hold SECONDS actually served: `driver_non_compliance` makes those two numbers equal by construction, and this scenario is the one that pulls them apart.',
    inputScale: {},
    build: ({ dispatches }) => {
      // Four fixed tiers, assigned round-robin by dispatch order. Deliberately
      // not drawn from the scenario's RNG: the MIX is the scenario, so it must
      // be the same mix on every seed, or a seed that happened to draw few
      // refusers would be reported as the same experiment.
      //
      // The tiers are chosen so the headline numbers disagree. Instructions
      // are ACCEPTED at (0.15 + 0.85 + 0.6 + 1) / 4 = 65%, and the hold
      // seconds actually served are (0.15 + 0.85 x 0.25 + 0.6 x 0.55 + 1) / 4
      // = 42% - about the 45% the binary `driver_non_compliance` uses, from a
      // fleet that looks half again as obedient.
      const tiers: { complianceProbability: number; compliedHoldFraction: number }[] = [
        // Barely engages with the screen at all.
        { complianceProbability: 0.15, compliedHoldFraction: 1 },
        // Takes every instruction and serves a quarter of it. The expensive one.
        { complianceProbability: 0.85, compliedHoldFraction: 0.25 },
        // Takes most of them and serves about half - a driver running behind.
        { complianceProbability: 0.6, compliedHoldFraction: 0.55 },
        // Does exactly as asked, every time.
        { complianceProbability: 1, compliedHoldFraction: 1 },
      ];
      const disturbances: Disturbance[] = reportedDispatches(dispatches).map((dispatch, i) => ({
        type: 'non_compliance',
        vehicleId: dispatch.vehicleId,
        ...tiers[i % tiers.length]!,
      }));
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'oversaturated',
    title: 'More passengers than seats',
    mechanism:
      'Demand well past what the fleet can carry. Buses leave the busy stops full, people are refused, and the ones refused are still there for the next bus, which is also full.',
    whatItTests:
      'The saturation line itself, and whether this harness reports it honestly. Past roughly a fifth of offered passengers denied, waiting time is bounded by how many seats exist rather than by how they are spaced, so spacing control CANNOT move the headline metric and a working controller correctly reports no effect (`SpacingKpis.saturated`, and the same trap in `evaluation/spec.ts`). The failure mode this guards against is the opposite of the usual one: a trial that reported a gain here would be reporting an artefact. Read `saturated` and the denied-boarding count FIRST; any excess-wait number on this row means nothing until you have.',
    // `peak_load` uses 1.3 and stops deliberately short of the line. This goes
    // through it: steady-state load is `rate x H* / 60 / alightingFraction`,
    // so 2.6x puts every preset well past its seat count - about 75 of 60
    // urban, 94 of 55 suburban, 114 of 55 inter-city.
    inputScale: { boardingRatePerMinute: 2.6 },
    build: ({ dispatches }) => ({ dispatches: [...dispatches], disturbances: [] }),
  },

  {
    id: 'oscillating_shock',
    title: 'A stretch that keeps changing its mind',
    mechanism:
      'One stretch of the route alternates between crawling and running clear, roughly once a headway - signal timing fighting a tidal flow, a lane closure that opens and shuts, a level crossing on a freight cycle.',
    whatItTests:
      'That the mid-route laws are PROPORTIONAL controllers with no derivative term and a real transport lag: they measure a gap, propose seconds against it, and those seconds are served at the next stop, by which time the disturbance that opened the gap has reversed. A correction issued against a closing gap does not merely fail to help, it adds to the gap it was meant to close. Read the controlled hold seconds against the excess-wait gain: this is the scenario where the two should come apart, with the controller working hard and buying nothing. The uncontrolled arm gets the same disturbance and has no loop to be out of phase with, which is exactly the comparison being asked for.',
    inputScale: {},
    build: (context) => {
      const { corridor, targetHeadwaySeconds, dispatches } = context;
      const lastIndex = corridor.stops.length - 1;
      const fromStopIndex = Math.max(1, Math.floor(corridor.stops.length * 0.25));
      const toStopIndex = Math.min(lastIndex, Math.floor(corridor.stops.length * 0.75));
      const horizonSeconds = runHorizonSeconds(context);

      // One headway per half-cycle. Faster than the corridor's own stop
      // interval and the phase is nothing a proportional law can track;
      // slower, and it is just `traffic_shock` with more windows. A control
      // loop that sweeps every 60 s and executes at the next stop is being
      // asked to correct a corridor whose sign changes between the two.
      const halfCycleSeconds = targetHeadwaySeconds;
      const disturbances: Disturbance[] = [];
      for (
        let start = 0, i = 0;
        start < horizonSeconds;
        start += halfCycleSeconds, i++
      ) {
        disturbances.push({
          type: 'link_slowdown',
          startSeconds: start,
          endSeconds: start + halfCycleSeconds,
          // Below 1 is a stretch running HOT, which the primitive supports and
          // which no other scenario in this library uses. It is the half that
          // makes this an oscillation rather than intermittent congestion:
          // without it every correction is at worst too large, and with it a
          // correction can have the wrong sign.
          multiplier: i % 2 === 0 ? 2.0 : 0.55,
          fromStopIndex,
          toStopIndex,
        });
      }
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'building_peak',
    title: 'A day that gets steadily worse',
    mechanism:
      'The corridor does not break, it degrades. Running times creep up as traffic builds - a little slower each hour, until a leg takes four or five times what it took when the roads were clear - and then it clears and starts again. Each bus lives through a different part of that cycle.',
    whatItTests:
      'A corridor with no steady state, and the two things that need one. `mpc/safety.ts` refuses any hold that would push a bus past `max_lateness_seconds`, measured against a booked timetable, and this trial books one from the uncontrolled arm\'s own MEAN arrivals - the right thing for a corridor whose pace is steady, and a description of nobody in particular on one whose pace drifts through every trip. The control laws need one too: they regulate towards a target headway that assumes the fleet ahead is running at the same pace this bus will. Read three things beside this row rather than the headline: `scheduleFit`, the `max_lateness_breach` count under `guardrails`, and the hold seconds per bus. They separate a controller that has been silently switched off by the timetable from one that is working and cannot keep up, and they are different problems with different fixes.',
    inputScale: {},
    build: (context) => {
      const { corridor, dispatches } = context;
      const lastIndex = corridor.stops.length - 1;
      const horizonSeconds = runHorizonSeconds(context);
      // A staircase rather than a curve, because the primitive is a window.
      // Starting BELOW 1 matters as much as ending above it: a day that only
      // ever gets slower can be booked against its own end, while one that
      // runs clear in the morning and crawls in the evening cannot be booked
      // against anything - which is the condition being tested.
      const steps = [0.6, 0.8, 1.0, 1.4, 2.0, 2.8];
      // ONE TRIP per ramp, repeated for the length of the run - not one ramp
      // spread over the whole run. A trial dispatches hundreds of buses at H*
      // intervals, so a run is far longer than a trip: a single slow ramp
      // across it changes the pace by almost nothing within any one bus's
      // journey, and every bus then has a schedule that fits it. Cycling at
      // trip length gives each bus a whole morning-to-evening's worth of
      // drift inside its own trip, and gives consecutive buses DIFFERENT
      // phases of it, which is the condition no single booked offset fits.
      const cycleSeconds = modelledArrivalSecondsTo(context, lastIndex);
      const stepSeconds = cycleSeconds / steps.length;
      const disturbances: Disturbance[] = [];
      for (let cycle = 0; cycle * cycleSeconds < horizonSeconds; cycle++) {
        for (const [i, multiplier] of steps.entries()) {
          disturbances.push({
            type: 'link_slowdown',
            startSeconds: cycle * cycleSeconds + i * stepSeconds,
            endSeconds: cycle * cycleSeconds + (i + 1) * stepSeconds,
            multiplier,
            // The whole corridor, not a stretch. A local closure is
            // `traffic_shock`; this is the pace of the entire route changing,
            // so no bus can make the time up anywhere.
            fromStopIndex: 1,
            toStopIndex: lastIndex,
          });
        }
      }
      return { dispatches: [...dispatches], disturbances };
    },
  },

  {
    id: 'shock_and_recovery',
    title: 'One bad hour, then nothing',
    mechanism:
      'A severe closure hits most of the corridor early in the run and then clears completely. Nothing else goes wrong for the rest of the day.',
    whatItTests:
      'Whether the corridor comes back, how long it takes, and whether control shortens or lengthens it. Every other scenario disturbs the corridor throughout, so all of them measure steady-state behaviour under load and none of them measures RECOVERY. A proportional holding law is a lag: it keeps issuing holds against a gap that is already closing on its own, and after the shock has passed those holds are pure added delay on a corridor that was re-settling without them. Read the controlled arm\'s hold seconds in the second half of the run against the uncontrolled arm\'s spacing over the same window.',
    inputScale: {},
    build: (context) => {
      const { corridor, targetHeadwaySeconds, dispatches } = context;
      const lastIndex = corridor.stops.length - 1;
      const horizonSeconds = runHorizonSeconds(context);
      // Harsher and shorter than `traffic_shock`'s three windows, and there is
      // exactly ONE of it. Three windows spread through the run is the right
      // shape for measuring an average response and the wrong shape for
      // measuring a recovery, which needs a long clean stretch afterwards to
      // recover INTO.
      const startSeconds = horizonSeconds * 0.15;
      return {
        dispatches: [...dispatches],
        disturbances: [
          {
            type: 'link_slowdown',
            startSeconds,
            endSeconds: startSeconds + targetHeadwaySeconds * 4,
            multiplier: 2.8,
            fromStopIndex: 1,
            toStopIndex: Math.max(1, Math.floor(lastIndex * 0.8)),
          },
        ],
      };
    },
  },
];

export function scenarioById(id: BunchingScenarioId): BunchingScenario {
  const found = BUNCHING_SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`unknown bunching scenario: ${id}`);
  return found;
}

/** A scenario's own PRNG, derived from the run seed so two scenarios in one trial do not draw the same numbers. */
export function scenarioRng(seed: number, id: BunchingScenarioId): Rng {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  return new Rng((seed ^ hash) >>> 0);
}
