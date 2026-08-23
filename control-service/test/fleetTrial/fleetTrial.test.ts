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
      boardings: 0,
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

  it('accounts for every incident exactly once across the four ways one can end', () => {
    for (const phase of report.phases) {
      for (const arm of [phase.controlled, phase.uncontrolled]) {
        const { detected, resolved, closedPairGone, unresolvedAtEnd } = arm.incidents;
        expect(resolved + closedPairGone + unresolvedAtEnd).toBe(detected);
      }
    }
  });
});
