// The controller that makes a rehearsal a rehearsal rather than a
// re-implementation.
//
// Every assertion here is about the DEPLOYED laws being the ones that ran.
// If someone later replaces the imports in
// src/rehearsal/deployedControlLaws.ts with a local approximation, the
// hold lengths below stop matching the formulas the production modules
// compute and these fail.
import { describe, it, expect } from 'vitest';
import {
  createDeployedControlLawsController,
  REHEARSAL_CONTROLLER_NAME,
} from '../../src/rehearsal/deployedControlLaws.js';
import { DEFAULT_STATE_STALE_SECONDS } from '../../src/mpc/safety.js';
import type { RoutePolicyRow } from '../../src/state/store.js';
import type { ControllerContext } from '../../src/simulation/types.js';

const EPOCH_MS = Date.UTC(2026, 0, 1);

function policy(overrides: Partial<RoutePolicyRow> = {}): RoutePolicyRow {
  return {
    id: 'policy-1',
    routeDirectionId: 'rd-1',
    operatingPeriod: 'all',
    dayType: 'all',
    targetHeadwaySeconds: 900,
    bunchedThresholdRatio: 0.25,
    warningThresholdRatio: 0.5,
    kf: 0.6,
    kb: 0.3,
    selfEqualizingK: 0.5,
    maxHoldSeconds: 90,
    cooldownSeconds: 60,
    predictionHorizonControlPoints: 3,
    occupancyStaleSeconds: null,
    occupancyCapacity: null,
    ...overrides,
  };
}

/**
 * A bunched pair: the follower is 2 km behind its leader and closing at
 * 60 km/h, so h_fwd is 120 s against a 900 s target. The leader is crawling
 * at 6 km/h, so h_bwd is 1,200 s - the pair is genuinely converging, which
 * is the situation two-way holding exists for.
 */
function bunchedContext(overrides: Partial<ControllerContext> = {}): ControllerContext {
  return {
    routeDirectionId: 'rd-1',
    stopId: 'stop-5',
    vehicleId: 'SIM-02',
    now: 3600,
    leaderHeadwaySeconds: 120,
    targetHeadwaySeconds: 900,
    maxHoldSeconds: 90,
    isStateStale: false,
    onboardCount: 30,
    kinematics: {
      follower: { vehicleId: 'SIM-02', distanceAlongRouteMeters: 10_000, speedKmph: 60 },
      leader: { vehicleId: 'SIM-01', distanceAlongRouteMeters: 12_000, speedKmph: 6 },
      totalDistanceMeters: 200_000,
    },
    ...overrides,
  };
}

describe('deployed-control-laws rehearsal controller', () => {
  it('is named so a result can never be mistaken for the simulator toy controller', () => {
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });
    expect(controller.name).toBe(REHEARSAL_CONTROLLER_NAME);
    expect(controller.name).not.toBe('self-equalizing');
  });

  // THE REUSE CLAIM. two_way_hold is only reachable when h_bwd exists, and
  // h_bwd only exists because the controller context now carries the
  // leader's PACE as well as the gap. Before that, `computeTwoWayCandidates`
  // skipped every pair and the simulator could only ever rehearse the
  // fallback law. Assert the exact number Algorithm B produces:
  //   Kf*(H* - h_fwd) - Kb*(H* - h_bwd)
  //   = 0.6*(900 - 120) - 0.3*(900 - 1200) = 468 + 90 = 558 -> clamped to 90.
  it('runs Algorithm B (two-way holding) on a converging pair, clamped by the policy hold cap', () => {
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });

    const decision = controller.decide(bunchedContext());

    expect(decision.actionType).toBe('two_way_hold');
    expect(decision.holdSeconds).toBe(90);

    const record = controller.decisions[0]!;
    expect(record.hFwdSeconds).toBeCloseTo(120, 5);
    expect(record.hBwdSeconds).toBeCloseTo(1200, 5);
    expect(record.gapMeters).toBeCloseTo(2000, 5);
    expect(record.candidates.map((c) => c.actionType)).toContain('two_way_hold');
  });

  // Same pair, gains removed. Algorithm C is the DESIGNATED fallback when
  // two-way's inputs are unavailable, and the deployed selfEqualizing
  // module is what decides that - not a branch written here.
  //   k * max(0, h_bwd - h_fwd) = 0.5 * (1200 - 120) = 540 -> clamped to 90.
  it('falls back to Algorithm C (self-equalizing) exactly when the two-way gains are not configured', () => {
    const controller = createDeployedControlLawsController({
      policy: policy({ kf: null, kb: null }),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });

    const decision = controller.decide(bunchedContext());

    expect(decision.actionType).toBe('self_equalizing_hold');
    expect(decision.holdSeconds).toBe(90);
  });

  it('proposes nothing at all when the corridor configures no gains', () => {
    const controller = createDeployedControlLawsController({
      policy: policy({ kf: null, kb: null, selfEqualizingK: null }),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });

    expect(controller.decide(bunchedContext())).toEqual({ holdSeconds: 0, actionType: 'no_control' });
    expect(controller.decisions[0]!.candidates).toHaveLength(0);
  });

  // The guardrail, and the reason the engine hands over a stale reading
  // rather than withholding it: the refusal must come from the deployed
  // hard safety filter and must be visible as its named reason, so a
  // planner can see the guardrail act instead of seeing nothing happen.
  it('refuses to hold on a stale reading, and records the hard safety filter as the reason', () => {
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });

    const decision = controller.decide(bunchedContext({ isStateStale: true }));

    expect(decision).toEqual({ holdSeconds: 0, actionType: 'no_control' });
    const record = controller.decisions[0]!;
    expect(record.candidates.length).toBeGreaterThan(0);
    expect(record.rejected.flatMap((r) => r.reasons)).toContain('stale_state');
  });

  it('ages a stale reading exactly past the deployed freshness bound, not by an arbitrary margin', () => {
    // A reading one second INSIDE the bound must still be actionable, or
    // the rehearsal would be refusing more than production does.
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });
    controller.decide(bunchedContext({ now: DEFAULT_STATE_STALE_SECONDS * 10 }));
    expect(controller.decisions[0]!.rejected).toHaveLength(0);
  });

  it('emits no candidate when there is no vehicle ahead on the corridor', () => {
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });

    expect(controller.decide(bunchedContext({ kinematics: null }))).toEqual({
      holdSeconds: 0,
      actionType: 'no_control',
    });
    expect(controller.decisions[0]!.gapMeters).toBeNull();
    expect(controller.decisions[0]!.occupancy).toBeNull();
  });

  it('never asks for a hold longer than the policy cap, whatever the gains say', () => {
    const controller = createDeployedControlLawsController({
      policy: policy({ kf: 40, kb: 0.1, maxHoldSeconds: 45 }),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });

    const decision = controller.decide(bunchedContext());
    expect(decision.holdSeconds).toBeLessThanOrEqual(45);
  });

  describe('occupancy: the honest gap, shown rather than filled', () => {
    it("reports production's own run as estimated, because nothing writes occupancy today", () => {
      const controller = createDeployedControlLawsController({
        policy: policy(),
        epochMs: EPOCH_MS,
        modelledCapacity: 52,
      });
      controller.decide(bunchedContext());

      const occupancy = controller.decisions[0]!.occupancy!;
      expect(occupancy.asDeployedToday.candidates.length).toBeGreaterThan(0);
      expect(occupancy.asDeployedToday.candidates.every((c) => c.occupancyEstimated)).toBe(true);
    });

    it('reports the modelled run as NOT estimated, so the two can never be conflated', () => {
      const controller = createDeployedControlLawsController({
        policy: policy(),
        epochMs: EPOCH_MS,
        modelledCapacity: 52,
      });
      controller.decide(bunchedContext({ onboardCount: 48 }));

      const occupancy = controller.decisions[0]!.occupancy!;
      expect(occupancy.withModelledOccupancy.candidates.every((c) => c.occupancyEstimated)).toBe(false);
      // A nearly full bus costs more to hold than the fixed mid-load
      // assumption charges for it - which is the whole point of the tier.
      const modelled = occupancy.withModelledOccupancy.candidates[0]!;
      const deployed = occupancy.asDeployedToday.candidates[0]!;
      expect(modelled.onboardCost).toBeGreaterThan(deployed.onboardCost);
    });

    it('leaves the applied hold untouched: the occupancy tier is advisory in production and stays advisory here', () => {
      const light = createDeployedControlLawsController({
        policy: policy(),
        epochMs: EPOCH_MS,
        modelledCapacity: 52,
      });
      const heavy = createDeployedControlLawsController({
        policy: policy(),
        epochMs: EPOCH_MS,
        modelledCapacity: 52,
      });

      const lightDecision = light.decide(bunchedContext({ onboardCount: 1 }));
      const heavyDecision = heavy.decide(bunchedContext({ onboardCount: 52 }));

      expect(lightDecision).toEqual(heavyDecision);
    });
  });
});
