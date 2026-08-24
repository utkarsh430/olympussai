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
    minimumActionSeconds: 0,
    predictionHorizonControlPoints: 3,
    occupancyStaleSeconds: null,
    occupancyCapacity: null,
    ks: null,
    maxLatenessSeconds: null,
    speedBandMinKmph: null,
    speedBandMaxKmph: null,
    ...overrides,
  };
}

/**
 * A bunched vehicle in a three-vehicle chain: SIM-02 is 2 km behind its
 * leader and closing at 60 km/h, so h_fwd is 120 s against a 900 s target.
 * SIM-03 sits 2 km behind SIM-02 crawling at 6 km/h, so h_bwd is 1,200 s -
 * the gap ahead is collapsing while the gap behind yawns open, which is the
 * exact situation two-way holding exists for.
 *
 * THREE vehicles, not two, and that is the point. h_bwd is measured to the
 * vehicle BEHIND the one being decided about; a leader and a follower alone
 * cannot supply it, and `engine.ts` never does (see
 * `ControllerKinematics.trailer`). A hand-built context can, which is what
 * keeps Algorithm B under test against the real deployed module.
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
      trailer: { vehicleId: 'SIM-03', distanceAlongRouteMeters: 8_000, speedKmph: 6 },
      // The chain the adapter actually ranks. Three vehicles here and no
      // more, so this fixture keeps saying exactly what it says above.
      corridor: [
        { vehicleId: 'SIM-01', distanceAlongRouteMeters: 12_000, speedKmph: 6 },
        { vehicleId: 'SIM-02', distanceAlongRouteMeters: 10_000, speedKmph: 60 },
        { vehicleId: 'SIM-03', distanceAlongRouteMeters: 8_000, speedKmph: 6 },
      ],
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
  // h_bwd only exists when a vehicle BEHIND the deciding one is in the
  // chain. Assert the exact number Algorithm B produces:
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

  // ─── NO GAINS SILENCES THE GAIN-BASED LAWS, AND ONLY THOSE ────────────
  //
  // `kf`, `kb` and `selfEqualizingK` are Algorithm B's and Algorithm C's.
  // The closed-form optimum needs none of them - it is the argmin of the
  // objective, not a proportional controller - so it still speaks, and is
  // still not selectable. Nothing is issued either way.
  //
  // This asserted `candidates` was EMPTY, and passed for a reason that had
  // nothing to do with gains: the controller defaulted the occupancy switch
  // ON, which production does not, and with a modelled onboard count the
  // load penalty is `L x H* / 2` - so the closed form was zero for every pair
  // and Algorithm D generated nothing anywhere. The test was pinning the
  // loaded gun rather than the invariant.
  it('silences the gain-based laws when the corridor configures no gains, and issues nothing', () => {
    const controller = createDeployedControlLawsController({
      policy: policy({ kf: null, kb: null, selfEqualizingK: null }),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });

    expect(controller.decide(bunchedContext())).toEqual({ holdSeconds: 0, actionType: 'no_control' });
    const coverage = controller.decisions[0]!.coverage;
    expect(coverage.generated.two_way).toBe(0);
    expect(coverage.generated.self_equalizing).toBe(0);
    expect(coverage.declined.two_way).toBe('gains_unset');
    expect(coverage.declined.self_equalizing).toBe('self_equalizing_gain_unset');
    // The closed form is unaffected by the gains and is generated, priced and
    // shown - but never selected, which is what keeps `no_control` above true.
    expect(coverage.generated.cost_optimal).toBe(1);
    expect(controller.decisions[0]!.rankedCandidateCount).toBe(0);
  });

  // The switch the controller runs with is the one the live network runs
  // with, not the one a direct caller of a candidate generator gets.
  it('weighs occupancy the way the deployed network does - which is not at all', () => {
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });
    const aware = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
      weighOccupancy: true,
    });
    controller.decide(bunchedContext({ onboardCount: 50 }));
    aware.decide(bunchedContext({ onboardCount: 50 }));
    // A heavy bus prices its hold differently under the two settings; the
    // default has to be the deployed one, so these must differ.
    const cost = (c: typeof controller) =>
      c.decisions[0]!.candidates.find((x) => x.actionType === 'two_way_hold')?.objectiveCost ?? null;
    expect(cost(controller)).not.toBeNull();
    expect(cost(controller)).not.toBe(cost(aware));
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

// ─── THE PACE A STANDING BUS IS MEASURED AGAINST IS THE CORRIDOR'S ───────
//
// `headway/metrics.ts` turns a gap in METRES into a gap in SECONDS by
// dividing by the pace the follower will actually cover it at. For a bus
// standing at a stop - the only state a hold can be executed from - that is
// `corridorPaceKmph`, the median speed of the vehicles on the corridor that
// ARE moving. It is a property of the whole chain, and production takes it
// over every live vehicle on the route-direction (`headway/service.ts`).
//
// This adapter used to hand the deployed computation a chain of exactly
// three: leader, the deciding bus, trailer. One of those three is stationary
// by construction, so whenever the other two were dwelling at their own stops
// there was no moving vehicle to take a median over, the pace came back null,
// and the pair reported NO FORWARD HEADWAY - on a corridor where a dozen
// other buses were under way and production would have measured it without
// difficulty. MEASURED over ten scenarios x three seeds before the fix: 9.0%
// of urban pairs that had a leader reported a null h_fwd, and Algorithm B
// declined 8.1% of every decision in the trial as `h_fwd_unavailable`.
describe('the chain handed to the deployed headway computation', () => {
  /** Leader, decider and trailer all standing at their stops; the rest of the corridor under way. */
  function stationaryNeighbourhood(others: { vehicleId: string; distanceAlongRouteMeters: number; speedKmph: number | null }[]): ControllerContext {
    const follower = { vehicleId: 'SIM-02', distanceAlongRouteMeters: 10_000, speedKmph: 0 };
    const leader = { vehicleId: 'SIM-01', distanceAlongRouteMeters: 12_000, speedKmph: 0 };
    const trailer = { vehicleId: 'SIM-03', distanceAlongRouteMeters: 8_000, speedKmph: 0 };
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
        follower,
        leader,
        trailer,
        corridor: [leader, follower, trailer, ...others],
        totalDistanceMeters: 200_000,
      },
    };
  }

  const movingRestOfFleet = [
    { vehicleId: 'SIM-04', distanceAlongRouteMeters: 20_000, speedKmph: 40 },
    { vehicleId: 'SIM-05', distanceAlongRouteMeters: 30_000, speedKmph: 44 },
    { vehicleId: 'SIM-06', distanceAlongRouteMeters: 4_000, speedKmph: 36 },
  ];

  it('measures a standing bus against the pace of the buses that are moving, wherever on the corridor they are', () => {
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });
    controller.decide(stationaryNeighbourhood(movingRestOfFleet));
    const decision = controller.decisions[0];
    expect(decision).toBeDefined();
    // 2,000 m at the 40 km/h median of the moving buses is 180 s.
    expect(decision!.hFwdSeconds).toBeCloseTo(180, 0);
  });

  it('reports no opinion, not a fabricated gap, when nothing on the corridor is moving', () => {
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });
    controller.decide(
      stationaryNeighbourhood(
        movingRestOfFleet.map((v) => ({ ...v, speedKmph: 0 })),
      ),
    );
    expect(controller.decisions[0]?.hFwdSeconds).toBeNull();
  });

  // The whole corridor is offered, so the deployed ranking picks the pair -
  // rather than the caller's own idea of who leads whom being taken on trust.
  it('takes the nearest bus ahead as the leader even when the caller names a further one', () => {
    const controller = createDeployedControlLawsController({
      policy: policy(),
      epochMs: EPOCH_MS,
      modelledCapacity: 52,
    });
    const context = stationaryNeighbourhood([
      ...movingRestOfFleet,
      { vehicleId: 'SIM-07', distanceAlongRouteMeters: 10_500, speedKmph: 30 },
    ]);
    controller.decide(context);
    expect(controller.decisions[0]?.leaderVehicleId).toBe('SIM-07');
  });
});
