// Reading a rehearsal result.
//
// The property worth holding here is that the surface can report a FAILURE.
// Four of the six measures improve by going DOWN, so a table of raw deltas
// is how a strategy that made things worse gets presented as a win; and a
// simulator that can only report success is a demonstration, not a tool.
import { describe, expect, it } from 'vitest';
import {
  compareArms,
  summariseDecisions,
  verdict,
  VERDICT_SENTENCE,
} from '@/lib/rehearsal/comparison';
import type { RehearsalKpis, RehearsalResult } from '@/models/rehearsal';

function kpis(overrides: Partial<RehearsalKpis> = {}): RehearsalKpis {
  return {
    meanHeadwaySeconds: 900,
    headwayCv: 0.5,
    bunchingIncidents: 4,
    excessWaitSeconds: 1800,
    deniedBoardings: 200,
    strandedPassengers: 200,
    onTimeDispatchRate: 0.8,
    complianceRate: 1,
    totalBoardings: 5000,
    ...overrides,
  };
}

function result(
  uncontrolled: RehearsalKpis,
  controlled: RehearsalKpis,
  decisions: RehearsalResult['decisions'] = [],
): RehearsalResult {
  return {
    corridor: {
      routeDirectionId: 'rd-1',
      routeId: '1348',
      routeName: 'Lucknow - Kanpur',
      directionCode: 'OUT',
      isLoop: false,
      totalDistanceMeters: 90_000,
      calibrationSource: 'timetable',
      stops: [],
      shape: [],
      controlPointCount: 5,
    },
    policy: {
      targetHeadwaySeconds: 900,
      bunchedThresholdRatio: 0.25,
      warningThresholdRatio: 0.5,
      kf: 0.6,
      kb: 0.3,
      selfEqualizingK: 0.5,
      maxHoldSeconds: 90,
      cooldownSeconds: 60,
      predictionHorizonControlPoints: 3,
      occupancyCapacity: null,
      occupancyStaleSeconds: null,
    },
    inputs: {
      cruiseSpeedKmph: 35,
      travelTimeVariation: 0.12,
      boardingRatePerMinute: 1.5,
      alightingFraction: 0.18,
      baseDwellSeconds: 20,
      secondsPerBoarding: 2.5,
      secondsPerAlighting: 1.5,
      vehicleCapacity: 52,
      vehicleCount: 6,
      seed: 1,
      disturbance: 'none',
    },
    provenance: [],
    arms: {
      uncontrolled: {
        name: 'no-control',
        kpis: uncontrolled,
        frames: [],
        appliedHoldSeconds: 0,
        refusedHoldSeconds: 0,
      },
      controlled: {
        name: 'deployed-control-laws',
        kpis: controlled,
        frames: [],
        appliedHoldSeconds: 90,
        refusedHoldSeconds: 0,
      },
    },
    decisions,
    occupancyContrast: {
      decisionsScored: 0,
      decisionsUsingFallbackToday: 0,
      meanOnboardCostAsDeployedToday: null,
      meanOnboardCostWithModelledOccupancy: null,
      rankingComparable: false,
    },
    disturbedVehicleId: null,
    notRehearsed: [],
    horizonSeconds: 10_000,
  };
}

describe('compareArms', () => {
  // The direction is the whole point. Fewer bunching incidents is better;
  // fewer passengers carried is not.
  it('knows which measures improve by going down and which by going up', () => {
    const metrics = compareArms(result(kpis(), kpis()));
    const byKey = new Map(metrics.map((m) => [m.key, m]));
    expect(byKey.get('bunchingIncidents')!.direction).toBe('lower-is-better');
    expect(byKey.get('headwayCv')!.direction).toBe('lower-is-better');
    expect(byKey.get('excessWaitSeconds')!.direction).toBe('lower-is-better');
    expect(byKey.get('totalBoardings')!.direction).toBe('higher-is-better');
  });

  it('calls a reduction in bunching an improvement', () => {
    const metrics = compareArms(
      result(kpis({ bunchingIncidents: 8 }), kpis({ bunchingIncidents: 3 })),
    );
    const metric = metrics.find((m) => m.key === 'bunchingIncidents')!;
    expect(metric.delta).toBe(-5);
    expect(metric.improved).toBe(true);
  });

  it('calls a reduction in passengers carried a worsening, not an improvement', () => {
    const metrics = compareArms(
      result(kpis({ totalBoardings: 5000 }), kpis({ totalBoardings: 4200 })),
    );
    const metric = metrics.find((m) => m.key === 'totalBoardings')!;
    expect(metric.delta).toBe(-800);
    expect(metric.improved).toBe(false);
  });

  it('reports no judgement at all when a measure did not move', () => {
    const metrics = compareArms(result(kpis(), kpis()));
    expect(metrics.every((m) => m.improved === null)).toBe(true);
  });

  it('reports no judgement when an arm could not produce the measure', () => {
    const metrics = compareArms(result(kpis({ headwayCv: null }), kpis({ headwayCv: 0.3 })));
    const metric = metrics.find((m) => m.key === 'headwayCv')!;
    expect(metric.delta).toBeNull();
    expect(metric.improved).toBeNull();
  });

  it("quotes the corridor's own measured threshold rather than a constant", () => {
    const withOwnRatio = result(kpis(), kpis());
    withOwnRatio.policy.bunchedThresholdRatio = 0.4;
    const metric = compareArms(withOwnRatio).find((m) => m.key === 'bunchingIncidents')!;
    expect(metric.meaning).toContain('0.4');
  });
});

describe('verdict', () => {
  it('says so plainly when control made everything worse', () => {
    const metrics = compareArms(
      result(
        kpis({
          bunchingIncidents: 2,
          headwayCv: 0.2,
          excessWaitSeconds: 100,
          deniedBoardings: 10,
          meanHeadwaySeconds: 900,
          totalBoardings: 5000,
        }),
        kpis({
          bunchingIncidents: 9,
          headwayCv: 0.7,
          excessWaitSeconds: 900,
          deniedBoardings: 90,
          meanHeadwaySeconds: 1400,
          totalBoardings: 4000,
        }),
      ),
    );
    expect(verdict(metrics)).toBe('worse');
    expect(VERDICT_SENTENCE.worse).toMatch(/worse/i);
  });

  it('says so plainly when control changed nothing', () => {
    expect(verdict(compareArms(result(kpis(), kpis())))).toBe('no-change');
  });

  it('reports a mixed result as mixed rather than picking the flattering half', () => {
    const metrics = compareArms(
      result(
        kpis({ bunchingIncidents: 8, totalBoardings: 5000 }),
        kpis({ bunchingIncidents: 3, totalBoardings: 4000 }),
      ),
    );
    expect(verdict(metrics)).toBe('mixed');
  });

  it('reports an unqualified improvement only when nothing got worse', () => {
    const metrics = compareArms(
      result(
        kpis({
          bunchingIncidents: 8,
          headwayCv: 0.7,
          excessWaitSeconds: 900,
          deniedBoardings: 90,
          meanHeadwaySeconds: 1400,
          totalBoardings: 4000,
        }),
        kpis({
          bunchingIncidents: 3,
          headwayCv: 0.4,
          excessWaitSeconds: 400,
          deniedBoardings: 20,
          meanHeadwaySeconds: 950,
          totalBoardings: 5000,
        }),
      ),
    );
    expect(verdict(metrics)).toBe('improved');
  });

  // Every sentence has to be readable as a claim about a MODEL.
  //
  // The qualifier moved from "modelled conditions" to "made-up conditions"
  // during the plain-language pass — same claim, a word an operations reader
  // actually uses. What is under test is the QUALIFIER, not the wording, so
  // this now checks both halves of it: the conditions are declared invented,
  // and the claim is scoped to this one corridor rather than to the service.
  it('never promises anything about the real service', () => {
    for (const sentence of Object.values(VERDICT_SENTENCE)) {
      expect(sentence).toMatch(/made-up conditions/);
      expect(sentence).toMatch(/^On this corridor/);
    }
  });
});

describe('summariseDecisions', () => {
  it('counts what the automatic spacing rules actually chose, commonest first', () => {
    const decisions = [
      { selectedActionType: 'two_way_hold' },
      { selectedActionType: 'no_control' },
      { selectedActionType: 'two_way_hold' },
      { selectedActionType: 'two_way_hold' },
    ] as unknown as RehearsalResult['decisions'];
    expect(summariseDecisions(result(kpis(), kpis(), decisions))).toEqual([
      { actionType: 'two_way_hold', count: 3 },
      { actionType: 'no_control', count: 1 },
    ]);
  });

  it('returns nothing for a run in which no control point was reached', () => {
    expect(summariseDecisions(result(kpis(), kpis(), []))).toEqual([]);
  });
});
