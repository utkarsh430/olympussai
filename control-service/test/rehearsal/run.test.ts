// A whole rehearsal, end to end, over a corridor shaped like the seeded
// ones (19 stops, ~215 km, 15-minute target headway - the averages measured
// on this database).
//
// The assertions divide into two kinds, and both matter:
//   1. the run is deterministic and its control arm actually differs from
//      its no-control arm, so the comparison a planner reads is real;
//   2. every invented input is DECLARED as invented, because the whole
//      claim of this surface is that it never passes a model off as a
//      measurement.
import { describe, it, expect } from 'vitest';
import { DEFAULT_MODELLED_INPUTS, runRehearsal, REHEARSAL_FRAME_COUNT } from '../../src/rehearsal/run.js';
import type { CorridorInputs, CorridorStop } from '../../src/rehearsal/corridor.js';

const STOP_COUNT = 19;
const TOTAL_METERS = 215_000;

function corridor(overrides: Partial<CorridorInputs> = {}): CorridorInputs {
  const stops: CorridorStop[] = Array.from({ length: STOP_COUNT }, (_, index) => {
    const fraction = index / (STOP_COUNT - 1);
    return {
      stopId: `stop-${index}`,
      name: `Stop ${index}`,
      sequence: index,
      cumulativeDistanceMeters: Math.round(TOTAL_METERS * fraction),
      // Every fourth stop, roughly matching the measured 5 control points
      // per calibrated corridor.
      isControlPoint: index > 0 && index % 4 === 0,
      maxHoldSeconds: null,
      latitude: 26.8 - fraction * 0.4,
      longitude: 80.9 - fraction * 0.6,
    };
  });

  return {
    routeDirectionId: 'rd-test',
    routeId: '1348',
    routeName: 'Lucknow - Kanpur',
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: TOTAL_METERS,
    calibrationSource: 'od_timetable',
    policy: {
      id: 'policy-1',
      routeDirectionId: 'rd-test',
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
    },
    stops,
    shape: stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    ...overrides,
  };
}

describe('runRehearsal', () => {
  it('is deterministic: same corridor, same inputs, same seed, same answer', () => {
    const a = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
    const b = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
    expect(b.arms.controlled.kpis).toEqual(a.arms.controlled.kpis);
    expect(b.arms.uncontrolled.kpis).toEqual(a.arms.uncontrolled.kpis);
  });

  it('runs both arms over the same scenario, so the comparison is like for like', () => {
    const result = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
    expect(result.arms.uncontrolled.name).toBe('no-control');
    expect(result.arms.controlled.name).toBe('deployed-control-laws');
    expect(result.arms.uncontrolled.appliedHoldSeconds).toBe(0);
  });

  // If the control arm never acts, the surface is showing a planner two
  // identical runs and calling one of them a strategy.
  it('actually intervenes on a disturbed corridor', () => {
    const result = runRehearsal(corridor(), { ...DEFAULT_MODELLED_INPUTS, disturbance: 'demand_burst' });
    expect(result.arms.controlled.appliedHoldSeconds).toBeGreaterThan(0);
    expect(result.decisions.some((d) => d.holdSeconds > 0)).toBe(true);
  });

  it('never exceeds the corridor\'s own maximum hold on any single decision', () => {
    const result = runRehearsal(corridor(), { ...DEFAULT_MODELLED_INPUTS, disturbance: 'demand_burst' });
    for (const decision of result.decisions) {
      expect(decision.holdSeconds).toBeLessThanOrEqual(result.policy.maxHoldSeconds);
    }
  });

  it('refuses to hold a vehicle whose feed has dropped out, and shows the guardrail that refused', () => {
    const result = runRehearsal(corridor(), { ...DEFAULT_MODELLED_INPUTS, disturbance: 'gps_dropout' });
    const droppedVehicle = result.disturbedVehicleId;
    expect(droppedVehicle).not.toBeNull();
    const itsDecisions = result.decisions.filter((d) => d.vehicleId === droppedVehicle);
    expect(itsDecisions.length).toBeGreaterThan(0);
    expect(itsDecisions.every((d) => d.holdSeconds === 0)).toBe(true);
    expect(itsDecisions.some((d) => d.rejected.some((r) => r.reasons.includes('stale_state')))).toBe(true);
  });

  it('records a driver refusing a hold as a refusal, not as a hold that happened', () => {
    const result = runRehearsal(corridor(), { ...DEFAULT_MODELLED_INPUTS, disturbance: 'non_compliance' });
    expect(result.arms.controlled.refusedHoldSeconds).toBeGreaterThan(0);
  });

  describe('the map track', () => {
    it('returns a bounded number of frames however long the corridor is', () => {
      const result = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
      expect(result.arms.controlled.frames).toHaveLength(REHEARSAL_FRAME_COUNT);
      expect(result.arms.uncontrolled.frames).toHaveLength(REHEARSAL_FRAME_COUNT);
    });

    it('draws every vehicle on the corridor, never off the end of it', () => {
      const result = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
      const latitudes = result.arms.controlled.frames.flatMap((f) => f.vehicles.map((v) => v.latitude));
      expect(latitudes.length).toBeGreaterThan(0);
      for (const latitude of latitudes) {
        expect(latitude).toBeGreaterThanOrEqual(26.4 - 1e-6);
        expect(latitude).toBeLessThanOrEqual(26.8 + 1e-6);
      }
      for (const frame of result.arms.controlled.frames) {
        for (const vehicle of frame.vehicles) {
          expect(vehicle.distanceAlongRouteMeters).toBeLessThanOrEqual(TOTAL_METERS + 1e-6);
        }
      }
    });

    it('marks a held vehicle as held, so a hold is visible on the map and not just in a table', () => {
      const result = runRehearsal(corridor(), { ...DEFAULT_MODELLED_INPUTS, disturbance: 'demand_burst' });
      const statuses = new Set(result.arms.controlled.frames.flatMap((f) => f.vehicles.map((v) => v.status)));
      expect(statuses.has('held')).toBe(true);
    });

    it('draws nothing at all when the corridor has no usable polyline', () => {
      const result = runRehearsal(corridor({ shape: [] }), DEFAULT_MODELLED_INPUTS);
      expect(result.arms.controlled.frames).toEqual([]);
    });
  });

  describe('honesty', () => {
    it('declares running time, demand, occupancy and the service pattern as modelled', () => {
      const result = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
      const modelled = result.provenance.filter((p) => p.source === 'modelled').map((p) => p.field);
      expect(modelled).toContain('Running time between stops');
      expect(modelled).toContain('Passenger demand');
      expect(modelled).toContain('Occupancy');
      expect(modelled).toContain('Service pattern');
      expect(modelled).toContain('Disturbance');
    });

    it('declares the corridor, the target headway and the gains as measured', () => {
      const result = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
      const measured = result.provenance.filter((p) => p.source === 'measured').map((p) => p.field);
      expect(measured).toContain('Corridor geometry');
      expect(measured).toContain('Target headway H*');
      expect(measured).toContain('Controller gains');
      expect(measured).toContain('Maximum hold');
    });

    it('names every part of the deployed decision cycle it does not rehearse', () => {
      const result = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
      const text = result.notRehearsed.join(' ');
      expect(text).toMatch(/terminal dispatch/i);
      expect(text).toMatch(/state estimator/i);
      expect(text).toMatch(/command lifecycle/i);
    });

    it("reports that production's occupancy tier fell back on every decision it scored", () => {
      const result = runRehearsal(corridor(), { ...DEFAULT_MODELLED_INPUTS, disturbance: 'demand_burst' });
      expect(result.occupancyContrast.decisionsScored).toBeGreaterThan(0);
      expect(result.occupancyContrast.decisionsUsingFallbackToday).toBe(
        result.occupancyContrast.decisionsScored,
      );
    });

    // The contrast has to be reported on the term occupancy actually
    // drives. A "decisions re-ranked" count would be structurally zero
    // here - one leader/follower pair means at most one candidate, and a
    // one-item list cannot be re-ordered - and would read as evidence
    // that occupancy does not matter, which is the opposite of true.
    it('contrasts the onboard-delay cost, and says plainly that ranking is not comparable', () => {
      const result = runRehearsal(corridor(), { ...DEFAULT_MODELLED_INPUTS, disturbance: 'demand_burst' });
      expect(result.occupancyContrast.rankingComparable).toBe(false);
      expect(result.occupancyContrast.meanOnboardCostAsDeployedToday).toBeGreaterThan(0);
      expect(result.occupancyContrast.meanOnboardCostWithModelledOccupancy).toBeGreaterThan(0);
    });

    // MEASURED before the warm-up run existed: on a 164 km corridor the
    // first bus arrived at a mid-route stop 8,000 s in and collected 8,000
    // seconds of standing queue, reporting 5,174 denied boardings for a
    // six-bus run. Nothing about that number described the service.
    it('excludes the warm-up run, so no reported bus is credited with clearing a queue standing since midnight', () => {
      const result = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
      const drawn = new Set(result.arms.controlled.frames.flatMap((f) => f.vehicles.map((v) => v.vehicleId)));
      expect(drawn.has('WARMUP')).toBe(false);
      expect(drawn.size).toBe(DEFAULT_MODELLED_INPUTS.vehicleCount);
      expect(result.decisions.every((d) => d.vehicleId !== 'WARMUP')).toBe(true);
      // A steady-state six-bus run over a 215 km corridor should strand
      // hundreds, not thousands: the warm-up artefact was an order of
      // magnitude larger than the effect being measured.
      expect(result.arms.uncontrolled.kpis.deniedBoardings).toBeLessThan(2000);
    });

    // MEASURED before the burst window was scaled to the corridor: a fixed
    // [H*, 4H*] window closed roughly two hours before the first bus
    // reached the target stop, and the "disturbed" run returned results
    // identical to the undisturbed one.
    it('places a demand burst where the buses actually are, so it changes the run', () => {
      const quiet = runRehearsal(corridor(), DEFAULT_MODELLED_INPUTS);
      const burst = runRehearsal(corridor(), { ...DEFAULT_MODELLED_INPUTS, disturbance: 'demand_burst' });
      expect(burst.arms.uncontrolled.kpis.totalBoardings).not.toBe(
        quiet.arms.uncontrolled.kpis.totalBoardings,
      );
    });

    it('refuses a corridor whose target headway is not a measurement', () => {
      const uncalibrated = corridor();
      uncalibrated.policy.targetHeadwaySeconds = 0;
      expect(() => runRehearsal(uncalibrated, DEFAULT_MODELLED_INPUTS)).toThrow(/target headway/i);
    });
  });
});
