// The eligibility gate: where the controller is allowed to run.
//
// It is DEFAULT OFF, and the first test in this file is the one that matters
// most - with the flag unset the cycle must not merely behave the same, it
// must not ask the question at all. A gate that quietly costs a query per
// sweep while claiming to be off is not off.
//
// When it IS on, it filters BEFORE the batch is cut. That ordering is the
// whole point: `DECISION_CYCLE_BATCH_SIZE` is 60 and the eligible set is
// larger than that on this network, so filtering after the cut would still
// spend the batch on corridors holding cannot help, and the corridors it CAN
// help would keep waiting extra cycles.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDecisionCycle, _resetDecisionCursorForTests } from '../src/scheduler/decisionCycle.js';
import type { Env } from '../src/config/env.js';
import type { MpcSolveResult } from '../src/mpc/solver.js';
import type { CandidateAction } from '../src/mpc/types.js';
import {
  DEFAULT_MAX_REFUSALS_PER_WINDOW,
  DEFAULT_REFUSAL_WINDOW_SECONDS,
} from '../src/mpc/boardingLimit.js';

const NOW = new Date('2026-09-06T10:00:00.000Z');

function env(overrides: Partial<Env> = {}): Env {
  return {
    HEADWAY_VEHICLE_FRESHNESS_SECONDS: 300,
    DECISION_CYCLE_BATCH_SIZE: 60,
    DECISION_CYCLE_CONCURRENCY: 3,
    DECISION_CYCLE_REPEAT_AFTER_SECONDS: 900,
    DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED: false,
    ...overrides,
  } as Env;
}

function solveResult(routeDirectionId: string): MpcSolveResult {
  const selected: CandidateAction = {
    actionType: 'two_way_hold',
    vehicleId: `${routeDirectionId}-bus`,
    involvedVehicleIds: [`${routeDirectionId}-bus`, `${routeDirectionId}-lead`],
    holdSeconds: 60,
    objectiveCost: -100,
    clampResidualSeconds: 0,
    passengerCost: {
      waitPassengerSeconds: -100,
      onboardPassengerSeconds: 0,
      operatorPassengerSeconds: 0,
      latenessPassengerSeconds: 0,
      netPassengerSeconds: -100,
      loadEstimated: true,
      backwardEstimated: false,
      scheduleUnknown: true,
    },
    rationale: 'fixture',
    scheduleDeviationSeconds: null,
    routeDirectionId,
    stateAsOf: NOW.toISOString(),
    headwayDeviationSeconds: -200,
    targetHeadwaySeconds: 600,
  };
  return {
    routeDirectionId,
    candidateActions: [selected],
    safeCandidates: [selected],
    selectedAction: selected,
    selectedActions: [selected],
    boardingLimitCandidates: [],
    // What `boardingLimitAvailability` returns for a corridor with
    // `alighting_only_enabled` unset - i.e. every corridor today, and the state
    // the empty `boardingLimitCandidates` above already describes. The bound
    // and the window come from the module's own defaults rather than being
    // written out here, so a fixture cannot drift from them.
    boardingLimitAvailability: {
      offered: false,
      withheldReason: 'disabled_for_corridor',
      refusalsInWindow: null,
      maxRefusals: DEFAULT_MAX_REFUSALS_PER_WINDOW,
      windowSeconds: DEFAULT_REFUSAL_WINDOW_SECONDS,
      remainingRefusals: null,
      withheldCandidateCount: 0,
    },
    selectedActionType: 'two_way_hold',
    objectiveCost: -100,
    expectedRecoverySeconds: 60,
    constraints: { maxHoldSeconds: 600 },
    controllerVersion: 'test-controller',
    rejectedCandidates: [],
    predictiveAdvisory: {
      label: 'PREDICTIVE',
      horizonControlPoints: 3,
      candidates: [],
      controllerVersion: 'test-advisory',
    },
    paceAdvisories: [],
  };
}

function deps(
  eligible: readonly string[],
  inBand: readonly string[],
  overrides: Parameters<typeof runDecisionCycle>[1] = {},
) {
  return {
    listEligible: vi.fn(() => Promise.resolve([...eligible])),
    listInBand: vi.fn(() => Promise.resolve(new Set(inBand))),
    solveRouteDirection: vi.fn((id: string) => Promise.resolve(solveResult(id))),
    listOpenIncidentPairs: vi.fn(() => Promise.resolve([])),
    findLatest: vi.fn(() => Promise.resolve(null)),
    insert: vi.fn(() => Promise.resolve('rec-1')),
    now: () => NOW.getTime(),
    ...overrides,
  };
}

beforeEach(() => {
  _resetDecisionCursorForTests();
});

describe('decision cycle eligibility gate', () => {
  // The no-op proof. Off is the shipped default and must cost nothing.
  it('does not ask the band question at all when the gate is off', async () => {
    const d = deps(['rd-a', 'rd-b', 'rd-c'], ['rd-a']);
    const result = await runDecisionCycle(env(), d);

    expect(d.listInBand).not.toHaveBeenCalled();
    expect(d.solveRouteDirection).toHaveBeenCalledTimes(3);
    expect(result.eligible).toBe(3);
    expect(result.attempted).toBe(3);
    expect(result.gateExcluded).toBe(0);
  });

  it('skips corridors outside the band when the gate is on', async () => {
    const d = deps(['rd-a', 'rd-b', 'rd-c'], ['rd-b']);
    const result = await runDecisionCycle(
      env({ DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED: true }),
      d,
    );

    expect(d.listInBand).toHaveBeenCalledWith(['rd-a', 'rd-b', 'rd-c']);
    expect(d.solveRouteDirection).toHaveBeenCalledTimes(1);
    expect(d.solveRouteDirection).toHaveBeenCalledWith('rd-b');
    expect(result.eligible).toBe(1);
    expect(result.gateExcluded).toBe(2);
  });

  // The throughput argument. With 90 in band and a batch of 60, an unfiltered
  // sweep spends part of its batch on corridors holding cannot help while the
  // ones it can help wait for a later cycle.
  it('filters before the batch is cut, so the whole batch goes to corridors that can benefit', async () => {
    const eligible = Array.from({ length: 200 }, (_, i) => `rd-${String(i).padStart(3, '0')}`);
    const inBand = eligible.filter((_, i) => i >= 100);
    const d = deps(eligible, inBand);

    const result = await runDecisionCycle(
      env({ DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED: true, DECISION_CYCLE_BATCH_SIZE: 60 }),
      d,
    );

    expect(result.attempted).toBe(60);
    const attempted = vi.mocked(d.solveRouteDirection).mock.calls.map((call) => call[0]);
    expect(attempted).toHaveLength(60);
    expect(attempted.every((id) => inBand.includes(id))).toBe(true);
  });

  // A gate that fails closed would silence the controller network-wide on a
  // database hiccup. It must fail OPEN - back to today's behaviour - and say so.
  it('runs on every eligible corridor when the band lookup fails', async () => {
    const d = deps(['rd-a', 'rd-b'], [], {
      listInBand: vi.fn(() => Promise.reject(new Error('pool exhausted'))),
    });

    const result = await runDecisionCycle(
      env({ DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED: true }),
      d,
    );

    expect(d.solveRouteDirection).toHaveBeenCalledTimes(2);
    expect(result.gateExcluded).toBe(0);
  });

  // Nothing in band is a real answer and not an error, but it must not read as
  // "the controller is healthy and had nothing to say".
  it('reports an empty in-band set as every corridor excluded', async () => {
    const d = deps(['rd-a', 'rd-b'], []);
    const result = await runDecisionCycle(
      env({ DECISION_CYCLE_ELIGIBILITY_GATE_ENABLED: true }),
      d,
    );

    expect(d.solveRouteDirection).not.toHaveBeenCalled();
    expect(result.eligible).toBe(0);
    expect(result.gateExcluded).toBe(2);
  });
});
