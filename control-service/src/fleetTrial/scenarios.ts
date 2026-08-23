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
  | 'driver_non_compliance';

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
  /** Modelled inputs this scenario changes from the trial's shared defaults. */
  inputs: Partial<ModelledInputs>;
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

export const BUNCHING_SCENARIOS: readonly BunchingScenario[] = [
  {
    id: 'steady_variability',
    title: 'Ordinary day',
    mechanism:
      'Nothing goes wrong. Running times between stations simply vary, as they always do, and gaps drift apart and back together on their own.',
    whatItTests:
      'Whether the controller earns its keep when there is no incident to point at. This is the regime the corridor is in for most of every day, so a control law that only helps during a crisis helps almost never.',
    // Higher than the trial default: over ten 44 km links, ordinary variation
    // alone is enough to pull a chain of buses apart, and this is the scenario
    // whose entire content is that variation.
    inputs: { travelTimeVariation: 0.16 },
    build: ({ dispatches }) => ({ dispatches: [...dispatches], disturbances: [] }),
  },

  {
    id: 'terminal_jitter',
    title: 'Ragged departures',
    mechanism:
      'Buses leave the origin at irregular intervals rather than one every headway - a driver signing on late, a vehicle swap, a platform conflict.',
    whatItTests:
      'Terminal dispatch regulation, which is the one lever that costs no passenger their seat. A gap that leaves the terminal wrong is a gap that stays wrong for 400 km unless something corrects it there.',
    inputs: {},
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
    inputs: {},
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
    inputs: {},
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
    inputs: {},
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
    inputs: {},
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
    inputs: { travelTimeVariation: 0.22 },
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
    // Well below the saturation line `evaluation/spec.ts` documents. Past it,
    // waiting time is bounded by seats rather than spacing and a working
    // controller correctly reports "no effect" - which reads as a failure.
    inputs: { boardingRatePerMinute: 0.48, alightingFraction: 0.26 },
    build: ({ dispatches }) => ({ dispatches: [...dispatches], disturbances: [] }),
  },

  {
    id: 'gps_dropout',
    title: 'Vehicles off the map',
    mechanism:
      'Buses stop reporting their position - a dead unit, a coverage hole, a modem that never came back after a depot power cycle.',
    whatItTests:
      'That the system refuses to act rather than guessing. A dropped feed does not delete the last known position; it makes its AGE the reason not to issue a command, and the correct number of holds issued to an unobserved bus is zero.',
    inputs: {},
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
    inputs: {},
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
