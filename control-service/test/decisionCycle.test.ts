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
  paceSignature,
  RECOMMENDATION_HOLD_EPSILON_SECONDS,
  type RecommendationFingerprint,
} from '../src/db/recommendations.js';
import { runDecisionCycle, _resetDecisionCursorForTests } from '../src/scheduler/decisionCycle.js';
import type { Env } from '../src/config/env.js';
import type { MpcSolveResult } from '../src/mpc/solver.js';
import {
  DEFAULT_MAX_REFUSALS_PER_WINDOW,
  DEFAULT_REFUSAL_WINDOW_SECONDS,
} from '../src/mpc/boardingLimit.js';
import type { CandidateAction } from '../src/mpc/types.js';

const NOW = new Date('2026-08-19T10:00:00.000Z');

function env(overrides: Partial<Env> = {}): Env {
  return {
    HEADWAY_VEHICLE_FRESHNESS_SECONDS: 300,
    DECISION_CYCLE_BATCH_SIZE: 60,
    DECISION_CYCLE_CONCURRENCY: 3,
    DECISION_CYCLE_REPEAT_AFTER_SECONDS: 900,
    PACE_GUIDANCE_ON_DECISION_CYCLE_ENABLED: false,
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
    selectedActions: [selected],
    boardingLimitCandidates: [],
    // The shipped state of every corridor: alighting-only is switched off, so
    // nothing is offered and the refusal meter is never read.
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
          paceSignature: '',
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
    paceSignature: '',
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

// ─── PACE GUIDANCE ON THE AUTOMATIC PATH ────────────────────────────────
//
// Pace guidance is the only lever here that improves spacing at negative
// time cost: it asks a bus already running EARLY to ease off, spending slack
// it holds rather than adding delay. Every hold does the opposite.
//
// It reached an operator only when one opened the control room and asked
// about a specific corridor. This sweep is the automatic half, and it was
// blind to pace advice in the worst possible way - it returned before
// looking whenever no hold had been selected, which is precisely the state a
// bus running early and closing on its leader produces.
//
// Two properties are load-bearing and are asserted separately below:
// default-off writes exactly what it wrote before, and an advisory NEVER
// becomes a candidate or a selected action however it is carried.
describe('pace guidance on the decision cycle', () => {
  const advisory = {
    vehicleId: 'UP25FT1001',
    routeDirectionId: 'rd-1',
    action: 'reduce_pace' as const,
    currentSpeedKmph: 42,
    targetSpeedKmph: 33,
    scheduleSlackSeconds: -240,
    rationale: 'Running ahead and closing on the bus in front.',
  };

  /** A corridor whose only useful answer is "ease off": no hold was selected. */
  function paceOnlySolve() {
    return solveResult({
      candidateActions: [],
      safeCandidates: [],
      selectedAction: null,
      selectedActions: [],
      selectedActionType: null,
      objectiveCost: null,
      expectedRecoverySeconds: null,
      paceAdvisories: [advisory],
    });
  }

  describe('with the flag off, which is the default', () => {
    it('writes nothing at all for a corridor whose only answer is pace advice', async () => {
      const d = deps({ solveRouteDirection: vi.fn(() => Promise.resolve(paceOnlySolve())) });
      const result = await runDecisionCycle(env(), d);

      expect(d.insert).not.toHaveBeenCalled();
      expect(result.proposed).toBe(0);
      expect(result.withAction).toBe(0);
      expect(result.withPaceAdvisory).toBe(0);
    });

    it('leaves the pace advice off a row it was going to write anyway', async () => {
      const d = deps({
        solveRouteDirection: vi.fn(() =>
          Promise.resolve(solveResult({ paceAdvisories: [advisory] })),
        ),
      });
      const result = await runDecisionCycle(env(), d);

      expect(d.insert).toHaveBeenCalledTimes(1);
      // Empty, not absent-and-defaulted: the caller decides, and with the
      // flag off it decided nothing is carried.
      expect(vi.mocked(d.insert).mock.calls[0]![0].paceAdvisories).toEqual([]);
      expect(result.withPaceAdvisory).toBe(0);
    });
  });

  describe('with the flag on', () => {
    const on = () => env({ PACE_GUIDANCE_ON_DECISION_CYCLE_ENABLED: true });

    it('proposes for a corridor that has no hold worth making but a bus worth easing', async () => {
      const d = deps({ solveRouteDirection: vi.fn(() => Promise.resolve(paceOnlySolve())) });
      const result = await runDecisionCycle(on(), d);

      expect(d.insert).toHaveBeenCalledTimes(1);
      expect(vi.mocked(d.insert).mock.calls[0]![0].paceAdvisories).toEqual([advisory]);
      expect(result.proposed).toBe(1);
      expect(result.withPaceAdvisory).toBe(1);
      // Not a selectable action, so it must not be counted as one.
      expect(result.withAction).toBe(0);
    });

    it('never disguises the advisory as a hold', async () => {
      const d = deps({ solveRouteDirection: vi.fn(() => Promise.resolve(paceOnlySolve())) });
      await runDecisionCycle(on(), d);

      const written = vi.mocked(d.insert).mock.calls[0]![0];
      // The two ways an advisory could contaminate the ranking, both shut.
      // candidate_actions -> 0 is read back as THE SELECTED ACTION by
      // findLatestRecommendation, so an advisory landing there would be
      // reported as the hold the controller chose.
      expect(written.candidateActions).toEqual([]);
      expect(written.selectedActionType).toBeNull();
      expect(JSON.stringify(written.candidateActions)).not.toContain('reduce_pace');
    });

    it('carries pace advice alongside a hold without either displacing the other', async () => {
      const d = deps({
        solveRouteDirection: vi.fn(() =>
          Promise.resolve(solveResult({ paceAdvisories: [advisory] })),
        ),
      });
      const result = await runDecisionCycle(on(), d);

      const written = vi.mocked(d.insert).mock.calls[0]![0];
      expect(written.selectedActionType).toBe('two_way_hold');
      expect(written.paceAdvisories).toEqual([advisory]);
      expect(result.withAction).toBe(1);
      expect(result.withPaceAdvisory).toBe(1);
    });

    it('attaches a pace-only proposal to the incident about that same bus', async () => {
      const d = deps({
        solveRouteDirection: vi.fn(() => Promise.resolve(paceOnlySolve())),
        listOpenIncidentPairs: vi.fn(() =>
          Promise.resolve([
            { id: 'inc-other', followerVehicleId: 'UP25FT9999' },
            { id: 'inc-right', followerVehicleId: 'UP25FT1001' },
          ] as never),
        ),
      });
      await runDecisionCycle(on(), d);

      expect(vi.mocked(d.insert).mock.calls[0]![0].incidentId).toBe('inc-right');
    });

    // Silence has to stay meaningful for pace advice too, or a corridor
    // drifting slowly buries the moment the advice changed under a row every
    // 90 seconds.
    it('does not repeat identical pace advice', async () => {
      const d = deps({
        solveRouteDirection: vi.fn(() => Promise.resolve(paceOnlySolve())),
        findLatest: vi.fn(() =>
          Promise.resolve({
            selectedActionType: null,
            vehicleId: null,
            holdSeconds: null,
            paceSignature: 'UP25FT1001@33',
            createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
          }),
        ),
      });
      await runDecisionCycle(on(), d);

      expect(d.insert).not.toHaveBeenCalled();
    });

    // The bug this pins: without a pace term in the fingerprint, advice about
    // a DIFFERENT bus fingerprints identically to the standing advice - every
    // field the old fingerprint looked at is null on a pace-only row - and
    // the new advice is silently discarded.
    it('does write when the advice moves to a different bus', async () => {
      const d = deps({
        solveRouteDirection: vi.fn(() => Promise.resolve(paceOnlySolve())),
        findLatest: vi.fn(() =>
          Promise.resolve({
            selectedActionType: null,
            vehicleId: null,
            holdSeconds: null,
            paceSignature: 'UP25FT4823@28',
            createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
          }),
        ),
      });
      await runDecisionCycle(on(), d);

      expect(d.insert).toHaveBeenCalledTimes(1);
    });
  });

  // Structural, like the no-issuing guard above it: whatever else changes,
  // this sweep must not become a way to send a speed instruction to a bus.
  // There is no in-cab display in this system, and inventing a delivery path
  // is not this module's decision to make.
  it('still reaches no command or webhook path', () => {
    const source = readFileSync(
      new URL('../src/scheduler/decisionCycle.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/createCommand|deliverCommand|dispatchWebhook/);
  });
});

describe('paceSignature', () => {
  const a = {
    vehicleId: 'veh-1',
    routeDirectionId: 'rd-1',
    action: 'reduce_pace' as const,
    currentSpeedKmph: 40,
    targetSpeedKmph: 30,
    scheduleSlackSeconds: -200,
    rationale: 'one',
  };

  it('is empty for no advice, so absent and empty read the same', () => {
    expect(paceSignature([])).toBe('');
    expect(paceSignature(null)).toBe('');
    expect(paceSignature(undefined)).toBe('');
  });

  it('changes when the bus changes and when the target changes', () => {
    expect(paceSignature([a])).not.toBe(paceSignature([{ ...a, vehicleId: 'veh-2' }]));
    expect(paceSignature([a])).not.toBe(paceSignature([{ ...a, targetSpeedKmph: 25 }]));
  });

  // The rationale restates the same facts in prose. Including it would make
  // every row look new the moment a rounded number inside it moved.
  it('ignores the prose and the order the solver happened to emit in', () => {
    expect(paceSignature([a])).toBe(paceSignature([{ ...a, rationale: 'different words' }]));
    const b = { ...a, vehicleId: 'veh-2', targetSpeedKmph: 25 };
    expect(paceSignature([a, b])).toBe(paceSignature([b, a]));
  });
});
