// What a fleet trial must never get wrong.
//
// The trial exists to produce numbers somebody will act on, so the rules
// pinned here are the ones whose violation would be INVISIBLE - a report that
// still renders, still looks confident, and is wrong.
import { describe, it, expect } from 'vitest';
import { buildFleetCorridor, DEFAULT_FLEET_CORRIDOR } from '../../src/fleetTrial/corridor.js';
import { BUNCHING_SCENARIOS, scenarioById } from '../../src/fleetTrial/scenarios.js';
import { detectIncidents } from '../../src/fleetTrial/detection.js';
import { runFleetTrial, DEFAULT_FLEET_TRIAL_SPEC } from '../../src/fleetTrial/run.js';
import { FLEET_TRIAL_INPUTS } from '../../src/fleetTrial/presets.js';
import { scenarioRng } from '../../src/fleetTrial/scenarios.js';
import { CORRIDOR_PRESETS } from '../../src/fleetTrial/presets.js';
import { simulate } from '../../src/simulation/index.js';
import { createDeployedControlLawsController } from '../../src/rehearsal/deployedControlLaws.js';
import { buildRehearsalScenario, DEFAULT_MODELLED_INPUTS, REHEARSAL_EPOCH_MS, isReported } from '../../src/rehearsal/run.js';
import type { ModelledInputs } from '../../src/rehearsal/run.js';
import type { StopVisitRecord, TerminalDispatchPlan } from '../../src/simulation/types.js';

const CORRIDOR = buildFleetCorridor(DEFAULT_FLEET_CORRIDOR);

/** A small but real trial: every scenario, few enough buses to run in a test. */
const SMALL = { ...DEFAULT_FLEET_TRIAL_SPEC, vehiclesPerPhase: 40 };

describe('the trial corridor', () => {
  it('makes every station a holding point, including the origin', () => {
    // Terminal dispatch is suppressed for any stop that is not the origin
    // terminal, so a corridor that did not mark stop 0 a control point would
    // report Algorithm A at 0% coverage for a reason belonging to the fixture.
    expect(CORRIDOR.stops.every((stop) => stop.isControlPoint)).toBe(true);
    expect(CORRIDOR.stops[0]?.sequence).toBe(0);
  });

  it('never claims a measured calibration', () => {
    // 'timetable' and 'od_timetable' both mean a real published schedule was
    // measured. An invented corridor claiming one would be indistinguishable
    // from a calibrated corridor in every downstream provenance check.
    expect(CORRIDOR.calibrationSource).toBe('synthetic');
  });

  it('carries no occupancy capacity, because no real corridor does', () => {
    expect(CORRIDOR.policy.occupancyCapacity).toBeNull();
  });

  it('places stations by real spherical arithmetic, evenly spaced', () => {
    const gaps = CORRIDOR.stops
      .slice(1)
      .map((stop, i) => stop.cumulativeDistanceMeters - CORRIDOR.stops[i]!.cumulativeDistanceMeters);
    for (const gap of gaps) expect(Math.abs(gap - gaps[0]!)).toBeLessThanOrEqual(1);
    const last = CORRIDOR.stops[CORRIDOR.stops.length - 1]!;
    expect(last.cumulativeDistanceMeters).toBe(DEFAULT_FLEET_CORRIDOR.totalDistanceMeters);
  });
});

describe('the scenario library', () => {
  it('never disturbs the warm-up run', () => {
    // The warm-up bus exists to clear the standing passenger queue a model
    // starting at midnight would otherwise hand to the first real bus.
    // Disturbing it would disturb the one thing it is there to normalise.
    const dispatches: TerminalDispatchPlan[] = [
      { vehicleId: 'WARMUP', scheduledDispatchSeconds: 0 },
      ...Array.from({ length: 10 }, (_, i) => ({
        vehicleId: `BUS-${i}`,
        scheduledDispatchSeconds: (i + 1) * 1800,
      })),
    ];
    for (const scenario of BUNCHING_SCENARIOS) {
      const plan = scenario.build({
        corridor: CORRIDOR,
        inputs: { ...DEFAULT_FLEET_TRIAL_SPEC.inputs, cruiseSpeedKmph: 60 } as never,
        dispatches,
        targetHeadwaySeconds: 1800,
        freeFlowSecondsTo: (i) => (CORRIDOR.stops[i]?.cumulativeDistanceMeters ?? 0) / 16.67,
        rng: { next: () => 0.5 } as never,
      });
      for (const disturbance of plan.disturbances) {
        if ('vehicleId' in disturbance) {
          expect(disturbance.vehicleId, `${scenario.id} disturbed the warm-up run`).not.toBe('WARMUP');
        }
      }
      const warmup = plan.dispatches.find((d) => d.vehicleId === 'WARMUP');
      expect(warmup?.scheduledDispatchSeconds, `${scenario.id} moved the warm-up run`).toBe(0);
    }
  });

  it('keeps dispatch order monotonic, because the engine reads it as corridor order', () => {
    // The no-overtake bookkeeping assumes dispatch order IS corridor order.
    // Terminal jitter is the only scenario that touches dispatch times, and a
    // jitter that reordered two buses would silently break that assumption.
    const scenario = scenarioById('terminal_jitter');
    const dispatches: TerminalDispatchPlan[] = [
      { vehicleId: 'WARMUP', scheduledDispatchSeconds: 0 },
      ...Array.from({ length: 20 }, (_, i) => ({
        vehicleId: `BUS-${i}`,
        scheduledDispatchSeconds: (i + 1) * 1800,
      })),
    ];
    let seed = 7;
    const rng = { next: () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) };
    const plan = scenario.build({
      corridor: CORRIDOR,
      inputs: {} as never,
      dispatches,
      targetHeadwaySeconds: 1800,
      freeFlowSecondsTo: () => 0,
      rng: rng as never,
    });
    const times = plan.dispatches.map((d) => d.scheduledDispatchSeconds);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
  });
});

describe('incident detection', () => {
  const stopId = (index: number) => CORRIDOR.stops[index]!.stopId;

  /** A visit at `stopIndex`, arriving at `arrivalSeconds`. Only the fields detection reads. */
  function visit(
    vehicleId: string,
    stopIndex: number,
    arrivalSeconds: number,
    overrides: Partial<StopVisitRecord> = {},
  ): StopVisitRecord {
    return {
      vehicleId,
      stopId: stopId(stopIndex),
      stopIndex,
      arrivalSeconds,
      waitWindowSeconds: 0,
      boardings: 0,
      boardingLimitedPassengers: 0,
      boardingWaitPassengerSeconds: 0,
      alightings: 0,
      deniedBoardings: 0,
      onboardAfter: 0,
      dwellSeconds: 60,
      intendedHoldSeconds: 0,
      appliedHoldSeconds: 0,
      compliant: true,
      departureSeconds: arrivalSeconds + 60,
      leaderHeadwaySeconds: null,
      isStateStale: false,
      ...overrides,
    };
  }

  /** Two buses running the whole corridor `gapSeconds` apart at a steady pace. */
  function twoBuses(gapSeconds: number) {
    const paceSecondsPerStop = 2600;
    const visits: StopVisitRecord[] = [];
    const dispatches: TerminalDispatchPlan[] = [
      { vehicleId: 'LEAD', scheduledDispatchSeconds: 0 },
      { vehicleId: 'FOLLOW', scheduledDispatchSeconds: gapSeconds },
    ];
    for (let i = 0; i < CORRIDOR.stops.length; i++) {
      visits.push(visit('LEAD', i, i * paceSecondsPerStop));
      visits.push(visit('FOLLOW', i, i * paceSecondsPerStop + gapSeconds));
    }
    return { visits, dispatches };
  }

  it('opens an incident when two buses run far closer than the target headway', () => {
    // 200s apart on a corridor whose target is 1,800s: well under the 0.25
    // bunched ratio, sustained for the whole run.
    const { visits, dispatches } = twoBuses(200);
    const result = detectIncidents({
      corridor: CORRIDOR,
      visits,
      dispatches,
      disturbances: [],
      requiredSamples: 3,
    });
    expect(result.incidents.length).toBeGreaterThan(0);
    expect(result.incidents.some((i) => i.peakSeverity === 'bunched')).toBe(true);
  });

  it('opens nothing when the two buses are exactly one target headway apart', () => {
    const { visits, dispatches } = twoBuses(CORRIDOR.policy.targetHeadwaySeconds);
    const result = detectIncidents({
      corridor: CORRIDOR,
      visits,
      dispatches,
      disturbances: [],
      requiredSamples: 3,
    });
    const reactive = result.incidents.filter((i) => i.openedSeverity !== 'predicted');
    expect(reactive).toHaveLength(0);
  });

  it('never resolves an incident that was still open when the day ended', () => {
    // `run_ended` is not a resolution and must never be counted as one: a run
    // that stops is not a bunch that cleared.
    const { visits, dispatches } = twoBuses(200);
    const result = detectIncidents({
      corridor: CORRIDOR,
      visits,
      dispatches,
      disturbances: [],
      requiredSamples: 3,
    });
    for (const incident of result.incidents) {
      if (incident.closeReason === 'run_ended') {
        expect(incident.closedAtSeconds).toBeNull();
        expect(incident.durationSeconds).toBeNull();
      }
    }
  });

  it('closes a predicted incident only on a cleared forecast, never on "recovered"', () => {
    // A predicted incident's gap never collapsed, so the reactive rule's
    // `recovered` is true from the sweep that opened it. Wiring it that way
    // shuts every prediction on the sweep that created it - and the failure is
    // invisible, because rows get written, logged, and vanish.
    const { visits, dispatches } = twoBuses(1500);
    const result = detectIncidents({
      corridor: CORRIDOR,
      visits,
      dispatches,
      disturbances: [],
      requiredSamples: 3,
    });
    for (const incident of result.incidents) {
      if (incident.openedSeverity === 'predicted' && incident.peakSeverity === 'predicted') {
        expect(incident.closeReason).not.toBe('recovered');
      }
    }
  });

  it('excludes the warm-up run from every incident it reports', () => {
    const { visits, dispatches } = twoBuses(200);
    const withWarmup = [
      ...visits,
      ...CORRIDOR.stops.map((_, i) => visit('WARMUP', i, i * 2600 - 4000)),
    ];
    const result = detectIncidents({
      corridor: CORRIDOR,
      visits: withWarmup,
      dispatches: [...dispatches, { vehicleId: 'WARMUP', scheduledDispatchSeconds: -4000 }],
      disturbances: [],
      requiredSamples: 3,
      excludeVehicleIds: new Set(['WARMUP']),
    });
    for (const incident of result.incidents) {
      expect(incident.leaderVehicleId).not.toBe('WARMUP');
      expect(incident.followerVehicleId).not.toBe('WARMUP');
    }
  });
});

describe('a whole trial', () => {
  const report = runFleetTrial(SMALL);

  it('simulates exactly the fleet it claims to', () => {
    // The headline count is something a reader should be able to check rather
    // than trust: two phases of `vehiclesPerPhase`, and no bus counted twice.
    expect(report.vehiclesSimulated).toBe(SMALL.vehiclesPerPhase * 2);
    for (const phase of report.phases) expect(phase.vehicleCount).toBe(SMALL.vehiclesPerPhase);
  });

  it('is deterministic: the same spec produces the same numbers', () => {
    const again = runFleetTrial(SMALL);
    expect(again.phases[0]?.controlled.spacing).toEqual(report.phases[0]?.controlled.spacing);
    expect(again.phases[0]?.uncontrolled.spacing).toEqual(report.phases[0]?.uncontrolled.spacing);
    expect(again.occupancyContrast.decisionsChanged).toBe(report.occupancyContrast.decisionsChanged);
  });

  it('never reports a controlled arm without the arm it is compared against', () => {
    // The counterfactual is not an option a caller may skip. A KPI from the
    // controlled arm alone cannot distinguish a controller that worked from a
    // day that was quiet.
    for (const phase of report.phases) {
      expect(phase.uncontrolled.spacing.headwaySampleCount).toBeGreaterThan(0);
      for (const scenario of phase.scenarios) {
        expect(scenario.uncontrolled.spacing.headwaySampleCount).toBeGreaterThan(0);
        expect(scenario.trajectories.uncontrolled.length).toBe(scenario.trajectories.controlled.length);
      }
    }
  });

  it('never lets the uncontrolled arm apply a hold', () => {
    for (const phase of report.phases) {
      expect(phase.uncontrolled.punctuality.totalHoldSeconds).toBe(0);
      expect(phase.uncontrolled.passengers.onboardDelayPassengerSeconds).toBe(0);
    }
  });

  it('runs the two phases with different fleets, so no bus is in both', () => {
    const ids = new Set<string>();
    for (const phase of report.phases) {
      for (const scenario of phase.scenarios) {
        for (const trajectory of scenario.trajectories.controlled) {
          expect(ids.has(trajectory.vehicleId), `${trajectory.vehicleId} appeared twice`).toBe(false);
          ids.add(trajectory.vehicleId);
        }
      }
    }
  });

  it('states the occupancy verdict from a measurement, not an assumption', () => {
    // The two phases run different buses on different seeds, so a difference
    // between them is confounded with the day. The verdict must come from the
    // paired re-run, which compares matched decisions.
    expect(report.occupancyContrast.decisionsCompared).toBeGreaterThan(0);
    expect(report.occupancyContrast.decisionsChanged).toBeLessThanOrEqual(
      report.occupancyContrast.decisionsCompared,
    );
    expect(report.occupancyContrast.verdict.length).toBeGreaterThan(0);
  });

  it('labels every invented input as invented', () => {
    const modelled = report.provenance.filter((entry) => entry.source === 'modelled');
    // The demand, the running times and the geometry are all invented, and a
    // report that stopped saying so would be a demo.
    expect(modelled.length).toBeGreaterThanOrEqual(3);
    expect(report.provenance.some((entry) => entry.source === 'deployed')).toBe(true);
    expect(report.notExercised.length).toBeGreaterThan(0);
  });

  it('flags a saturated arm rather than reporting its wait figures as usable', () => {
    for (const phase of report.phases) {
      for (const arm of [phase.controlled, phase.uncontrolled]) {
        const offered = arm.passengers.boardings + arm.passengers.deniedBoardings;
        const expected = offered > 0 && arm.passengers.deniedBoardings / offered > 0.2;
        expect(arm.spacing.saturated).toBe(expected);
      }
    }
  });

  it('books an achievable timetable, so lateness measures the controller and not the schedule', () => {
    // A timetable no bus can keep reports every vehicle late from the first
    // stop, which turns the lateness term into a constant and the max-lateness
    // bound into a blanket refusal. The UNCONTROLLED arm is the check: with no
    // holds at all, its buses should be close to their booked times.
    const phase = report.phases[0];
    expect(phase?.uncontrolled.punctuality.onTimeRate).not.toBeNull();
    expect(phase?.uncontrolled.punctuality.meanScheduleDeviationSeconds).not.toBeNull();
    expect(Math.abs(phase?.uncontrolled.punctuality.meanScheduleDeviationSeconds ?? 1e9)).toBeLessThan(
      2 * 3600,
    );
  });

  it('accounts for every incident exactly once across the four ways one can end', () => {
    for (const phase of report.phases) {
      for (const arm of [phase.controlled, phase.uncontrolled]) {
        const { detected, resolved, closedPairGone, unresolvedAtEnd } = arm.incidents;
        expect(resolved + closedPairGone + unresolvedAtEnd).toBe(detected);
      }
    }
  });
});

// ─── THE GUARANTEE THAT MATTERS MOST ─────────────────────────────────────
//
// A dropped position feed does not delete the last known position; it makes its
// AGE the reason not to act. Everything else in this system degrades; this one
// must not. The gps_dropout scenario exists to prove the rejection fires end to
// end rather than being a branch nobody reaches.
describe('a bus nobody can see', () => {
  const scenario = scenarioById('gps_dropout');

  function runDropout(seed: number) {
    const inputs: ModelledInputs = {
      ...DEFAULT_MODELLED_INPUTS,
      ...FLEET_TRIAL_INPUTS,
      // The scenario's perturbation is multiplicative now - see
      // `BunchingScenario.inputScale`. These fixtures only need the corridor's
      // own demand, so the scale is not applied here.
      vehicleCount: 30,
      seed,
      disturbance: 'none',
    };
    const built = buildRehearsalScenario(CORRIDOR, inputs);
    const plan = scenario.build({
      corridor: CORRIDOR,
      inputs,
      dispatches: built.scenario.dispatches,
      targetHeadwaySeconds: CORRIDOR.policy.targetHeadwaySeconds,
      freeFlowSecondsTo: (index) =>
        (CORRIDOR.stops[index]?.cumulativeDistanceMeters ?? 0) / (inputs.cruiseSpeedKmph / 3.6),
      rng: scenarioRng(seed, scenario.id),
    });
    const config = { ...built.scenario, dispatches: plan.dispatches, disturbances: plan.disturbances };
    const dark = new Set(
      plan.disturbances
        .filter((d): d is Extract<typeof d, { type: 'gps_dropout' }> => d.type === 'gps_dropout')
        .map((d) => d.vehicleId),
    );
    const controller = createDeployedControlLawsController({
      policy: CORRIDOR.policy,
      epochMs: REHEARSAL_EPOCH_MS,
      modelledCapacity: inputs.vehicleCapacity,
      weighOccupancy: false,
      followerSpeedSource: 'vehicle_state',
      corridorStops: CORRIDOR.stops,
    });
    const result = simulate(config, controller);
    return { dark, visits: result.visits, decisions: controller.decisions, dispatches: config.dispatches };
  }

  it('is never held, and the guardrail that refused is named', () => {
    let darkDecisions = 0;
    let staleRejections = 0;
    for (const seed of [3001, 3002, 3003]) {
      const { dark, visits, decisions } = runDropout(seed);
      expect(dark.size).toBeGreaterThan(0);

      for (const visit of visits) {
        if (!dark.has(visit.vehicleId)) continue;
        expect(visit.appliedHoldSeconds, `${visit.vehicleId} was held at ${visit.stopId}`).toBe(0);
        expect(visit.intendedHoldSeconds).toBe(0);
      }
      for (const decision of decisions) {
        if (!dark.has(decision.vehicleId)) continue;
        darkDecisions++;
        expect(decision.holdSeconds).toBe(0);
        staleRejections += decision.rejected.filter((r) => r.reasons.includes('stale_state')).length;
      }
    }
    // The decisions have to actually have been ASKED, or the assertions above
    // are vacuous - and the refusal has to be the deployed staleness filter
    // rather than the engine quietly never offering the bus a candidate.
    expect(darkDecisions).toBeGreaterThan(0);
    expect(staleRejections).toBeGreaterThan(0);
  });

  it('leaves a hole in the measurement, and the incident says so', () => {
    // A dark bus is excluded from the leader/follower chain, so the buses
    // either side of it are linked to EACH OTHER and their pair spans two
    // headways - reading as comfortably spaced while whatever is happening
    // around the invisible bus is invisible too.
    let spanning = 0;
    for (const seed of [3001, 3002, 3003]) {
      const { dark, visits, dispatches } = runDropout(seed);
      const detected = detectIncidents({
        corridor: CORRIDOR,
        visits,
        dispatches,
        disturbances: [...dark].map((vehicleId) => ({
          type: 'gps_dropout' as const,
          vehicleId,
          startSeconds: 0,
          endSeconds: Number.MAX_SAFE_INTEGER,
        })),
        requiredSamples: 3,
      });
      for (const incident of detected.incidents) {
        expect(dark.has(incident.leaderVehicleId)).toBe(false);
        expect(dark.has(incident.followerVehicleId)).toBe(false);
        if (incident.observationLost) spanning++;
      }
    }
    expect(spanning).toBeGreaterThan(0);
  });
});

// ─── ALIGHTING-ONLY: THE LEVER THAT LOOKS FREE AND IS NOT ────────────────
//
// `mpc/boardingLimit.ts` is the only law here that improves spacing by
// REMOVING delay, and the trial exists partly to price it. Two things below,
// and the second is the reason the deployed solver never auto-selects it.
describe('alighting-only', () => {
  const scenario = scenarioById('slow_bus');
  const urban = buildFleetCorridor(CORRIDOR_PRESETS.urban.corridor);

  function run(seed: number, selectable: boolean) {
    const inputs: ModelledInputs = {
      ...DEFAULT_MODELLED_INPUTS,
      ...CORRIDOR_PRESETS.urban.inputs,
      // The scenario's perturbation is multiplicative now - see
      // `BunchingScenario.inputScale`. These fixtures only need the corridor's
      // own demand, so the scale is not applied here.
      vehicleCount: 30,
      seed,
      disturbance: 'none',
    };
    const built = buildRehearsalScenario(urban, inputs);
    const plan = scenario.build({
      corridor: urban,
      inputs,
      dispatches: built.scenario.dispatches,
      targetHeadwaySeconds: urban.policy.targetHeadwaySeconds,
      freeFlowSecondsTo: (index) =>
        (urban.stops[index]?.cumulativeDistanceMeters ?? 0) / (inputs.cruiseSpeedKmph / 3.6),
      rng: scenarioRng(seed, scenario.id),
    });
    const config = { ...built.scenario, dispatches: plan.dispatches, disturbances: plan.disturbances };
    const controller = createDeployedControlLawsController({
      policy: urban.policy,
      epochMs: REHEARSAL_EPOCH_MS,
      modelledCapacity: inputs.vehicleCapacity,
      weighOccupancy: false,
      followerSpeedSource: 'vehicle_state',
      corridorStops: urban.stops,
      alightingOnlySelectable: selectable,
    });
    return simulate(config, controller).visits.filter((v) => isReported(v.vehicleId));
  }

  it('is reachable at all — the law must be given a pair it can act on', () => {
    // It was structurally unreachable for two separate reasons, and both were
    // in the harness rather than the law: the adapter built only the row where
    // the deciding bus is the FOLLOWER (so the law was always asked about a bus
    // mid-link), and it gave the trailer no observation timestamp (so every
    // candidate that did survive was rejected `stale_state`). A zero here means
    // one of those has come back and Algorithm E is silently untested again.
    const visits = run(9001, true);
    const actions = visits.filter((v) => v.boardingLimitedPassengers > 0);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('leaves the queue standing, so the cost of passing people is actually modelled', () => {
    // The whole trade is that the passengers left behind wait for the next bus.
    // If the engine swept the queue anyway they would vanish, the action would
    // measure as free, and the trial would recommend it. That is exactly what
    // happened before the departure sweep was made conditional.
    const visits = run(9001, true).sort((a, b) => a.arrivalSeconds - b.arrivalSeconds);
    const limited = visits.find((v) => v.boardingLimitedPassengers > 0);
    expect(limited).toBeDefined();
    const next = visits.find(
      (v) => v.stopId === limited!.stopId && v.arrivalSeconds > limited!.arrivalSeconds,
    );
    expect(next).toBeDefined();
    // The next bus at that stop inherits a queue reaching back past the bus
    // that refused, rather than one starting from it.
    expect(next!.waitWindowSeconds).toBeGreaterThan(
      next!.arrivalSeconds - limited!.arrivalSeconds,
    );
  });

  it('costs more passenger time than it saves, which is why it is not auto-selected', () => {
    // MEASURED across seeds on the corridor where the law is most applicable.
    // The people left behind wait about ten times the law's own estimate: the
    // follower arrives with its own load, cannot fit a double queue, and the
    // overflow rolls forward. If this ever flips, re-read docs/FLEET_TRIAL.md
    // before celebrating - the last time it looked like a win, it was a bug.
    const totalWait = (visits: readonly StopVisitRecord[]) =>
      visits.reduce((acc, v) => acc + v.boardings * (v.waitWindowSeconds / 2), 0);

    let worseCount = 0;
    for (const seed of [9001, 9002, 9003]) {
      const off = totalWait(run(seed, false));
      const on = totalWait(run(seed, true));
      if (on > off) worseCount++;
    }
    expect(worseCount).toBeGreaterThanOrEqual(2);
  });
});

// A dark bus must not appear as anybody's neighbour either. Production's state
// estimator drops a low-confidence vehicle from the chain before any headway is
// computed, so the buses either side of it are linked to each other; an engine
// that handed one over as a leader would be giving the control laws an exact
// position with a fresh timestamp for a bus nobody can see.
describe('a dark bus is nobody\'s leader', () => {
  it('is never named as the leader or the trailer of a decision', () => {
    const scenario = scenarioById('gps_dropout');
    const inputs: ModelledInputs = {
      ...DEFAULT_MODELLED_INPUTS,
      ...CORRIDOR_PRESETS.urban.inputs,
      vehicleCount: 30,
      seed: 4242,
      disturbance: 'none',
    };
    const urban = buildFleetCorridor(CORRIDOR_PRESETS.urban.corridor);
    const built = buildRehearsalScenario(urban, inputs);
    const plan = scenario.build({
      corridor: urban,
      inputs,
      dispatches: built.scenario.dispatches,
      targetHeadwaySeconds: urban.policy.targetHeadwaySeconds,
      freeFlowSecondsTo: (index) =>
        (urban.stops[index]?.cumulativeDistanceMeters ?? 0) / (inputs.cruiseSpeedKmph / 3.6),
      rng: scenarioRng(4242, scenario.id),
    });
    const dark = new Set(
      plan.disturbances
        .filter((d): d is Extract<typeof d, { type: 'gps_dropout' }> => d.type === 'gps_dropout')
        .map((d) => d.vehicleId),
    );
    expect(dark.size).toBeGreaterThan(0);

    const controller = createDeployedControlLawsController({
      policy: urban.policy,
      epochMs: REHEARSAL_EPOCH_MS,
      modelledCapacity: inputs.vehicleCapacity,
      weighOccupancy: false,
      followerSpeedSource: 'vehicle_state',
      corridorStops: urban.stops,
    });
    simulate({ ...built.scenario, dispatches: plan.dispatches, disturbances: plan.disturbances }, controller);

    let decisionsWithLeader = 0;
    for (const decision of controller.decisions) {
      if (decision.leaderVehicleId === null) continue;
      decisionsWithLeader++;
      expect(dark.has(decision.leaderVehicleId), `${decision.leaderVehicleId} was dark`).toBe(false);
    }
    expect(decisionsWithLeader).toBeGreaterThan(0);
  });
});

// A timetable is what was PROMISED. Booking it from the departures a scenario
// actually produced makes it self-fulfilling: `terminal_jitter` moves buses off
// their slots by up to a third of a headway, and a timetable derived from those
// moved departures would declare every one of them exactly on time - so the one
// scenario whose whole subject is buses leaving wrong would report no lateness,
// and both deployed punctuality guards would have nothing to act on.
describe('the timetable', () => {
  it('is booked against the planned departures, not the ones the scenario produced', () => {
    const jittered = runFleetTrial({
      ...DEFAULT_FLEET_TRIAL_SPEC,
      vehiclesPerPhase: 60,
      scenarios: ['terminal_jitter'],
    });
    const arm = jittered.phases[0]?.scenarios[0]?.uncontrolled.punctuality;
    expect(arm).toBeDefined();
    expect(arm!.onTimeRate).not.toBeNull();
    // Buses deliberately leave up to ~0.35 x H* off their slot, so a meaningful
    // share of them must miss the five-minute window. A rate at or near 1 means
    // the timetable has absorbed the disturbance it was supposed to measure.
    expect(arm!.onTimeRate!).toBeLessThan(0.95);
    expect(arm!.p95ScheduleDeviationSeconds).not.toBeNull();
    expect(Math.abs(arm!.p95ScheduleDeviationSeconds!)).toBeGreaterThan(60);
  });
});
