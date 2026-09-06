// Which corridors the controller should be deployed on at all.
//
// The verdict is three independent refusals, and the tests below pin each one
// separately because they fail for different reasons and an operator has a
// different remedy for each: an UNCALIBRATED corridor needs a measured target
// headway, a corridor with ONE BUS needs a second bus, and an OUT-OF-BAND
// corridor needs nothing - it is simply a corridor holding cannot help, and
// the honest answer is to spend the dispatcher's attention elsewhere.
//
// The band itself is NOT re-derived here. `lib/controllability.ts` owns
// `CONTROLLABLE_BAND` and one test below asserts that this module answers on
// its bounds rather than on a second copy of them, because a second copy is
// exactly how a band drifts apart from the evidence it was fitted on.
import { describe, it, expect } from 'vitest';
import {
  assessCorridorEligibility,
  summariseEligibility,
  measuredAssumptionsFromFittedLinks,
  MINIMUM_VEHICLES_FOR_A_DECISION,
  MIN_FITTED_LINK_SHARE,
  type ControllabilityAssumptions,
  type CorridorShape,
  type FittedLink,
} from '../../src/evaluation/eligibility.js';
import { CONTROLLABLE_BAND } from '../../src/lib/controllability.js';

/** Stops evenly spaced over `km`, which is what makes the mean leg predictable. */
function stops(count: number, km: number): number[] {
  return Array.from({ length: count }, (_, i) => (i * km * 1000) / (count - 1));
}

function shape(overrides: Partial<CorridorShape> = {}): CorridorShape {
  return {
    routeDirectionId: 'rd-urban',
    routeName: 'Urban 1',
    directionCode: 'OUT',
    targetHeadwaySeconds: 360,
    calibrationSource: 'timetable',
    cumulativeDistanceMeters: stops(25, 24),
    vehicleCount: 6,
    ...overrides,
  };
}

/** The urban trial corridor's own running-time assumptions. */
const URBAN: ControllabilityAssumptions = {
  cruiseSpeedKmph: 18,
  travelTimeVariation: 0.18,
  provenance: 'modelled',
};

describe('assessCorridorEligibility', () => {
  it('calls a calibrated, in-band corridor with a pair of buses eligible', () => {
    const verdict = assessCorridorEligibility(shape(), URBAN);

    expect(verdict.verdict).toBe('eligible');
    expect(verdict.eligible).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.controllability?.band).toBe('controllable');
  });

  // The regime finding this whole report exists for: a 30-minute headway on
  // long inter-city legs is outside the band any published headway-control
  // method applies to, and deploying there costs full operational effort for
  // nothing.
  it('refuses a corridor whose legs vary more than a hold at either end can remove', () => {
    const verdict = assessCorridorEligibility(
      shape({
        routeDirectionId: 'rd-intercity',
        targetHeadwaySeconds: 1800,
        cumulativeDistanceMeters: stops(10, 400),
      }),
      { cruiseSpeedKmph: 60, travelTimeVariation: 0.14, provenance: 'modelled' },
    );

    expect(verdict.controllability?.band).toBe('too_disturbed');
    expect(verdict.verdict).toBe('out_of_band');
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/too_disturbed/);
  });

  it('refuses a corridor that barely comes apart, for the opposite reason', () => {
    const verdict = assessCorridorEligibility(shape(), { ...URBAN, travelTimeVariation: 0.001 });

    expect(verdict.controllability?.band).toBe('too_regular');
    expect(verdict.verdict).toBe('out_of_band');
  });

  // The decision cycle reasons about a LEADER and a FOLLOWER. One bus is not
  // a pair, so there is no headway to regulate whatever the corridor's shape.
  it('refuses a corridor that cannot produce a leader/follower pair', () => {
    const verdict = assessCorridorEligibility(shape({ vehicleCount: 1 }), URBAN);

    expect(verdict.verdict).toBe('too_few_vehicles');
    expect(verdict.reasons.join(' ')).toMatch(/1 live vehicle/);
    expect(MINIMUM_VEHICLES_FOR_A_DECISION).toBe(2);
  });

  it('accepts exactly the minimum pair', () => {
    expect(
      assessCorridorEligibility(shape({ vehicleCount: MINIMUM_VEHICLES_FOR_A_DECISION }), URBAN)
        .verdict,
    ).toBe('eligible');
  });

  // Every threshold in the controller is a ratio of the target headway. With
  // no measured one there is no band to place the corridor in either, so the
  // controllability is reported as ABSENT rather than as a number computed
  // against a sentinel.
  it('refuses an uncalibrated corridor and reports no band rather than a fabricated one', () => {
    const verdict = assessCorridorEligibility(
      shape({ targetHeadwaySeconds: null, calibrationSource: 'none' }),
      URBAN,
    );

    expect(verdict.verdict).toBe('uncalibrated');
    expect(verdict.controllability).toBeNull();
    expect(verdict.reasons.join(' ')).toMatch(/none/);
  });

  it('treats a corridor with no active policy row at all as uncalibrated', () => {
    const verdict = assessCorridorEligibility(
      shape({ targetHeadwaySeconds: null, calibrationSource: null }),
      URBAN,
    );

    expect(verdict.verdict).toBe('uncalibrated');
  });

  // A corridor can fail for more than one reason, and an operator planning a
  // rollout needs all of them: fixing the calibration on a single-bus corridor
  // buys nothing.
  it('reports every reason it failed, not only the first', () => {
    const verdict = assessCorridorEligibility(
      shape({ targetHeadwaySeconds: null, calibrationSource: 'default', vehicleCount: 0 }),
      URBAN,
    );

    expect(verdict.verdict).toBe('uncalibrated');
    expect(verdict.reasons).toHaveLength(2);
    expect(verdict.reasons.join(' ')).toMatch(/0 live vehicles/);
  });

  // THE POINT OF THIS ASSERTION: the band must be the one `lib/controllability.ts`
  // fitted, not a second copy that can drift away from it. Both bounds are
  // INSIDE the band, exactly as `assessControllability` classifies them.
  it('answers on lib/controllability.ts own bounds rather than a second copy of them', () => {
    // Chosen so sigma_leg / H* lands exactly on each bound: mean leg 1000 m at
    // 3.6 km/h is 1000 s, so variation x 1000 / H* is the ratio.
    const onBound = (ratio: number) =>
      assessCorridorEligibility(
        shape({ cumulativeDistanceMeters: [0, 1000], targetHeadwaySeconds: 1000 }),
        { cruiseSpeedKmph: 3.6, travelTimeVariation: ratio * 2, provenance: 'modelled' },
      );

    // cumulativeDistanceMeters [0, 1000] over two stops is a mean leg of 500 m,
    // so the ratio is variation / 2.
    expect(onBound(CONTROLLABLE_BAND.low).controllability?.disturbanceRatio).toBeCloseTo(
      CONTROLLABLE_BAND.low,
      9,
    );
    expect(onBound(CONTROLLABLE_BAND.low).verdict).toBe('eligible');
    expect(onBound(CONTROLLABLE_BAND.high).verdict).toBe('eligible');
    expect(onBound(CONTROLLABLE_BAND.low * 0.99).verdict).toBe('out_of_band');
    expect(onBound(CONTROLLABLE_BAND.high * 1.01).verdict).toBe('out_of_band');
  });

  // The inputs are the weakest part of the verdict on this network, because
  // nothing has recorded a stop visit yet. A row that carries a modelled
  // running-time spread must say so, or a reader takes an assumption for a
  // measurement.
  it('carries the provenance of the running-time inputs the band was decided on', () => {
    expect(assessCorridorEligibility(shape(), URBAN).inputs.provenance).toBe('modelled');
    expect(
      assessCorridorEligibility(shape(), { ...URBAN, provenance: 'measured' }).inputs.provenance,
    ).toBe('measured');
  });
});

describe('summariseEligibility', () => {
  it('counts corridors and vehicles by verdict so a rollout can be sized', () => {
    const summary = summariseEligibility([
      assessCorridorEligibility(shape({ routeDirectionId: 'a' }), URBAN),
      assessCorridorEligibility(shape({ routeDirectionId: 'b', vehicleCount: 4 }), URBAN),
      assessCorridorEligibility(shape({ routeDirectionId: 'c', vehicleCount: 1 }), URBAN),
      assessCorridorEligibility(
        shape({ routeDirectionId: 'd', targetHeadwaySeconds: null, calibrationSource: 'none' }),
        URBAN,
      ),
    ]);

    expect(summary.total).toBe(4);
    expect(summary.eligible).toBe(2);
    expect(summary.byVerdict.eligible).toBe(2);
    expect(summary.byVerdict.too_few_vehicles).toBe(1);
    expect(summary.byVerdict.uncalibrated).toBe(1);
    expect(summary.byVerdict.out_of_band).toBe(0);
    // 6 + 4 on the eligible pair; the single-bus and uncalibrated corridors
    // carry 1 and 6 buses that the controller would no longer be run for.
    expect(summary.eligibleVehicles).toBe(10);
    expect(summary.excludedVehicles).toBe(7);
  });

  it('reports a band breakdown only over corridors that have a band', () => {
    const summary = summariseEligibility([
      assessCorridorEligibility(shape({ routeDirectionId: 'a' }), URBAN),
      assessCorridorEligibility(shape({ routeDirectionId: 'b' }), { ...URBAN, travelTimeVariation: 0.001 }),
      assessCorridorEligibility(
        shape({ routeDirectionId: 'c', targetHeadwaySeconds: null, calibrationSource: 'none' }),
        URBAN,
      ),
    ]);

    expect(summary.byBand.controllable).toBe(1);
    expect(summary.byBand.too_regular).toBe(1);
    expect(summary.byBand.too_disturbed).toBe(0);
    expect(summary.withoutBand).toBe(1);
  });
});

// The only way a verdict on this network stops being an assumption. sigma_leg
// is `meanLeg / cruiseSpeed x travelTimeVariation`, and until `stop_visits`
// has traversals in it both of those come from `DEFAULT_MODELLED_INPUTS`.
describe('measuredAssumptionsFromFittedLinks', () => {
  const fitted = (perLink: FittedLink, legs: number) =>
    new Map(Array.from({ length: legs }, (_, i) => [`stop-${i + 1}`, perLink]));

  function fiveStopCorridor(): CorridorShape {
    return shape({
      // 1 km legs, four of them.
      cumulativeDistanceMeters: [0, 1000, 2000, 3000, 4000],
      stopIds: ['stop-0', 'stop-1', 'stop-2', 'stop-3', 'stop-4'],
    });
  }

  it('derives cruise speed from fitted leg distance over fitted leg time', () => {
    // 1000 m in 100 s is 10 m/s is 36 km/h, on every leg.
    const measured = measuredAssumptionsFromFittedLinks(
      fiveStopCorridor(),
      fitted({ meanSeconds: 100, stddevSeconds: 15 }, 4),
    );

    expect(measured).not.toBeNull();
    expect(measured!.cruiseSpeedKmph).toBeCloseTo(36, 6);
    expect(measured!.provenance).toBe('measured');
  });

  it('derives the variation as the mean of each leg stddev over its mean', () => {
    const measured = measuredAssumptionsFromFittedLinks(
      fiveStopCorridor(),
      fitted({ meanSeconds: 200, stddevSeconds: 30 }, 4),
    );

    expect(measured!.travelTimeVariation).toBeCloseTo(0.15, 9);
  });

  // A half-fitted corridor is the normal case and the dangerous one: the row
  // would say "measured" while half its legs carried an invented number.
  it('declines when too little of the corridor fitted', () => {
    const oneLeg = new Map([['stop-1', { meanSeconds: 100, stddevSeconds: 10 }]]);

    expect(measuredAssumptionsFromFittedLinks(fiveStopCorridor(), oneLeg)).toBeNull();
    // Two of four legs is exactly the bar and is accepted.
    expect(
      measuredAssumptionsFromFittedLinks(
        fiveStopCorridor(),
        new Map([
          ['stop-1', { meanSeconds: 100, stddevSeconds: 10 }],
          ['stop-2', { meanSeconds: 100, stddevSeconds: 10 }],
        ]),
      ),
    ).not.toBeNull();
    expect(MIN_FITTED_LINK_SHARE).toBe(0.5);
  });

  // A zero-second leg would make the derived cruise speed infinite, which is
  // worse than declining to answer.
  it('drops a leg with a non-positive fitted mean rather than dividing by it', () => {
    const withZero = new Map([
      ['stop-1', { meanSeconds: 0, stddevSeconds: 0 }],
      ['stop-2', { meanSeconds: 100, stddevSeconds: 10 }],
      ['stop-3', { meanSeconds: 100, stddevSeconds: 10 }],
      ['stop-4', { meanSeconds: 100, stddevSeconds: 10 }],
    ]);
    const measured = measuredAssumptionsFromFittedLinks(fiveStopCorridor(), withZero);

    expect(Number.isFinite(measured!.cruiseSpeedKmph)).toBe(true);
    expect(measured!.cruiseSpeedKmph).toBeCloseTo(36, 6);
  });

  // Without the stop ids there is no way to line a fitted link up with a leg,
  // so the honest answer is "no measurement", never a mis-aligned one.
  it('declines when the corridor carries no stop ids to line the fits up with', () => {
    expect(
      measuredAssumptionsFromFittedLinks(
        shape({ cumulativeDistanceMeters: [0, 1000], stopIds: undefined }),
        new Map([['stop-1', { meanSeconds: 100, stddevSeconds: 10 }]]),
      ),
    ).toBeNull();
  });
});
