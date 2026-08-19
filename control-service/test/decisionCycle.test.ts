// The decision cycle: the job that makes the controller answer on its own.
//
// Two properties matter more than any individual assertion here.
//
// FIRST, it must never issue anything. The whole safety argument of this
// system is that a bus moves only on a dispatcher-approved command, and this
// job's job is to put a proposal in front of that dispatcher sooner - not to
// remove them. The last test in this file is a structural guard on that.
//
// SECOND, silence must stay meaningful. A corridor that is fine produces no
// row, and a corridor whose situation has not changed produces no new row.
// Without that, an operator's history fills with a near-identical
// recommendation every 90 seconds and the moment the advice actually changed
// becomes unfindable - which is exactly the moment an incident review is
// looking for.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isMateriallyNewRecommendation,
  RECOMMENDATION_HOLD_EPSILON_SECONDS,
  type RecommendationFingerprint,
} from '../src/db/recommendations.js';
import { runDecisionCycle, _resetDecisionCursorForTests } from '../src/scheduler/decisionCycle.js';
import type { Env } from '../src/config/env.js';
import type { MpcSolveResult } from '../src/mpc/solver.js';
import type { CandidateAction } from '../src/mpc/types.js';

const NOW = new Date('2026-08-19T10:00:00.000Z');

function env(overrides: Partial<Env> = {}): Env {
  return {
    HEADWAY_VEHICLE_FRESHNESS_SECONDS: 300,
    DECISION_CYCLE_BATCH_SIZE: 60,
    DECISION_CYCLE_CONCURRENCY: 3,
    DECISION_CYCLE_REPEAT_AFTER_SECONDS: 900,
    ...overrides,
  } as Env;
}

function candidate(overrides: Partial<CandidateAction> = {}): CandidateAction {
  return {
    actionType: 'two_way_hold',
    vehicleId: 'UP25FT4823',
    involvedVehicleIds: ['UP25FT4823', 'UP25FT7777'],
    holdSeconds: 120,
    objectiveCost: -140,
    clampResidualSeconds: 0,
    passengerCost: {
      waitPassengerSeconds: -140,
      onboardPassengerSeconds: 0,
      operatorPassengerSeconds: 0,
      latenessPassengerSeconds: 0,
      netPassengerSeconds: -140,
      loadEstimated: true,
      backwardEstimated: false,
      scheduleUnknown: true,
    },
    rationale: 'fixture',
    scheduleDeviationSeconds: null,
    routeDirectionId: 'rd-1',
    stateAsOf: NOW.toISOString(),
    headwayDeviationSeconds: -400,
    targetHeadwaySeconds: 600,
    ...overrides,
  };
}

function solveResult(overrides: Partial<MpcSolveResult> = {}): MpcSolveResult {
  const selected = candidate();
  return {
    routeDirectionId: 'rd-1',
    candidateActions: [selected],
    safeCandidates: [selected],
    selectedAction: selected,
    selectedActionType: 'two_way_hold',
    objectiveCost: -140,
    expectedRecoverySeconds: 120,
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
    ...overrides,
  };
}

function deps(overrides: Parameters<typeof runDecisionCycle>[1] = {}) {
  return {
    listEligible: vi.fn(() => Promise.resolve(['rd-1'])),
    solveRouteDirection: vi.fn(() => Promise.resolve(solveResult())),
    listOpenIncidentPairs: vi.fn(() => Promise.resolve([])),
    findLatest: vi.fn((): Promise<RecommendationFingerprint | null> => Promise.resolve(null)),
    insert: vi.fn(() => Promise.resolve('rec-1')),
    now: () => NOW.getTime(),
    ...overrides,
  };
}

beforeEach(() => {
  _resetDecisionCursorForTests();
});

describe('runDecisionCycle', () => {
  it('asks the controller for every eligible corridor without waiting to be asked', async () => {
    const d = deps({ listEligible: vi.fn(() => Promise.resolve(['rd-1', 'rd-2', 'rd-3'])) });
    const result = await runDecisionCycle(env(), d);

    expect(d.solveRouteDirection).toHaveBeenCalledTimes(3);
    expect(result.eligible).toBe(3);
    expect(result.proposed).toBe(3);
  });

  it('writes the proposal with the solver\'s own selection and safe candidate set', async () => {
    const d = deps();
    await runDecisionCycle(env(), d);

    expect(d.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        routeDirectionId: 'rd-1',
        selectedActionType: 'two_way_hold',
        objectiveCost: -140,
        expectedRecoverySeconds: 120,
        controllerVersion: 'test-controller',
      }),
    );
  });

  // The ordinary, healthy answer on a corridor running evenly. A row saying
  // "nothing to do" every 90 seconds would bury the rows that matter.
  it('writes nothing when the controller has no safe action to propose', async () => {
    const d = deps({
      solveRouteDirection: vi.fn(() =>
        Promise.resolve(solveResult({ selectedAction: null, selectedActionType: null, safeCandidates: [] })),
      ),
    });
    const result = await runDecisionCycle(env(), d);

    expect(d.insert).not.toHaveBeenCalled();
    expect(result.withAction).toBe(0);
    expect(result.proposed).toBe(0);
  });

  it('does not repeat advice that has not materially changed', async () => {
    const d = deps({
      findLatest: vi.fn(() =>
        Promise.resolve({
          selectedActionType: 'two_way_hold',
          vehicleId: 'UP25FT4823',
          holdSeconds: 120,
          createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
        }),
      ),
    });
    const result = await runDecisionCycle(env(), d);

    expect(d.insert).not.toHaveBeenCalled();
    // Counted as an action the controller had, but not as a proposal written.
    expect(result.withAction).toBe(1);
    expect(result.proposed).toBe(0);
  });

  it('attaches the proposal to the open incident about that same vehicle', async () => {
    const d = deps({
      listOpenIncidentPairs: vi.fn(() =>
        Promise.resolve([
          {
            id: 'incident-other',
            severity: 'warning' as const,
            leaderVehicleId: 'X',
            followerVehicleId: 'SOMEONE-ELSE',
          },
          {
            id: 'incident-mine',
            severity: 'bunched' as const,
            leaderVehicleId: 'UP25FT7777',
            followerVehicleId: 'UP25FT4823',
          },
        ]),
      ),
    });
    await runDecisionCycle(env(), d);

    expect(d.insert).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: 'incident-mine' }),
    );
  });

  // The EARLY case this sweep exists for: drift a small hold still fixes
  // cheaply, before it crosses a detection threshold and becomes an incident.
  it('proposes on drift that has not yet opened an incident', async () => {
    const d = deps({ listOpenIncidentPairs: vi.fn(() => Promise.resolve([])) });
    await runDecisionCycle(env(), d);

    expect(d.insert).toHaveBeenCalledWith(expect.objectContaining({ incidentId: null }));
  });

  it('keeps sweeping when one corridor fails, so one bad route cannot silence the rest', async () => {
    const d = deps({
      listEligible: vi.fn(() => Promise.resolve(['rd-bad', 'rd-good'])),
      solveRouteDirection: vi.fn((id: string) => {
        if (id === 'rd-bad') return Promise.reject(new Error('no active policy'));
        return Promise.resolve(solveResult());
      }),
    });
    const result = await runDecisionCycle(env(), d);

    expect(result.failed).toBe(1);
    expect(result.proposed).toBe(1);
  });

  // Structural, not behavioural: the safety argument is that a bus moves
  // only on an approved command, and this job must remain incapable of
  // issuing one. An import of the command or webhook path here would be the
  // change that quietly ends human-in-the-loop control.
  it('is structurally incapable of issuing a command', () => {
    const source = readFileSync(new URL('../src/scheduler/decisionCycle.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\.\/commands\//);
    expect(source).not.toMatch(/from '\.\.\/webhooks\//);
    expect(source).not.toMatch(/createCommand|deliverCommand|dispatchWebhook/);
  });
});

describe('isMateriallyNewRecommendation', () => {
  const standing: RecommendationFingerprint = {
    selectedActionType: 'two_way_hold',
    vehicleId: 'veh-1',
    holdSeconds: 120,
    createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
  };
  const same = { selectedActionType: 'two_way_hold', vehicleId: 'veh-1', holdSeconds: 120 };

  it('is new when nothing is standing', () => {
    expect(isMateriallyNewRecommendation(null, same, NOW, 900)).toBe(true);
  });

  it('is not new when the advice is unchanged and recent', () => {
    expect(isMateriallyNewRecommendation(standing, same, NOW, 900)).toBe(false);
  });

  it('is new when the action type changes', () => {
    expect(
      isMateriallyNewRecommendation(standing, { ...same, selectedActionType: 'terminal_dispatch_hold' }, NOW, 900),
    ).toBe(true);
  });

  it('is new when a different bus is named', () => {
    expect(isMateriallyNewRecommendation(standing, { ...same, vehicleId: 'veh-2' }, NOW, 900)).toBe(true);
  });

  // A change smaller than the granularity a hold is given in is not a
  // different instruction.
  it('ignores a hold change within the epsilon', () => {
    const withinEpsilon = { ...same, holdSeconds: 120 + RECOMMENDATION_HOLD_EPSILON_SECONDS };
    expect(isMateriallyNewRecommendation(standing, withinEpsilon, NOW, 900)).toBe(false);
  });

  it('is new when the hold changes by more than the epsilon', () => {
    const beyond = { ...same, holdSeconds: 120 + RECOMMENDATION_HOLD_EPSILON_SECONDS + 1 };
    expect(isMateriallyNewRecommendation(standing, beyond, NOW, 900)).toBe(true);
  });

  // So a long-running situation still leaves a periodic trace that the
  // controller is watching it, rather than one row and then silence.
  it('re-states unchanged advice once the standing proposal is old enough', () => {
    const old = { ...standing, createdAt: new Date(NOW.getTime() - 1_000_000).toISOString() };
    expect(isMateriallyNewRecommendation(old, same, NOW, 900)).toBe(true);
  });
});
