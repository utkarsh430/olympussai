// Per-corridor demand, and the saturation it exists to stop.
//
// The harness ran every corridor at ONE invented boarding rate. A stop boards
// `lambda x H` passengers and sheds `alightingFraction` of the load, so the
// modelled load a corridor carries is proportional to its own target headway -
// and this network's median measured H* is 1,800 s against the 900 s the
// default was picked on. The result was 74-96% denied boardings on real
// corridors, which is the one regime in which the headline metric cannot
// respond to control at all.
//
// These tests pin the arithmetic that replaces it and the end-to-end effect:
// the same corridor saturates under the global rate and does not under the
// derived one.
import { describe, it, expect } from 'vitest';
import {
  DERIVED_PEAK_LOAD_SHARE,
  derivedBoardingRatePerMinute,
  modelledPeakLoad,
  peakLoadPerHeadwayOfBoardings,
  resolveCorridorDemand,
  describeDemand,
} from '../../src/evaluation/demand.js';
import { selectCorridors } from '../../src/evaluation/corridors.js';
import { parseExperimentSpec } from '../../src/evaluation/spec.js';
import { runExperiment } from '../../src/evaluation/runner.js';
import { buildReport, SATURATION_WARN_SHARE } from '../../src/evaluation/report.js';
import { CORRIDOR_PRESETS } from '../../src/fleetTrial/presets.js';
import { DEFAULT_MODELLED_INPUTS } from '../../src/rehearsal/run.js';
import type { CorridorInputs, CorridorStop } from '../../src/rehearsal/corridor.js';
import type { ModelledInputs } from '../../src/rehearsal/run.js';

/** A corridor of a given headway and stop count, with everything else held fixed. */
function corridorWith(targetHeadwaySeconds: number, stopCount = 20): CorridorInputs {
  const totalMeters = 120_000;
  const stops: CorridorStop[] = Array.from({ length: stopCount }, (_, i) => ({
    stopId: `s-${i}`,
    name: `Stop ${i}`,
    sequence: i,
    cumulativeDistanceMeters: Math.round((totalMeters * i) / (stopCount - 1)),
    isControlPoint: i % 4 === 0,
    maxHoldSeconds: null,
    latitude: 26.8 - (i / (stopCount - 1)) * 0.4,
    longitude: 80.9 - (i / (stopCount - 1)) * 0.6,
  }));
  return {
    routeDirectionId: `rd-${targetHeadwaySeconds}`,
    routeId: 'r-1',
    routeName: 'Fixture',
    directionCode: 'OUT',
    isLoop: false,
    totalDistanceMeters: totalMeters,
    calibrationSource: 'timetable',
    policy: {
      id: 'p-1',
      routeDirectionId: `rd-${targetHeadwaySeconds}`,
      operatingPeriod: 'all',
      dayType: 'all',
      targetHeadwaySeconds,
      bunchedThresholdRatio: 0.25,
      warningThresholdRatio: 0.5,
      kf: 0.4,
      kb: 0.2,
      selfEqualizingK: 0.35,
      maxHoldSeconds: 600,
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
  };
}

const INPUTS: ModelledInputs = {
  ...DEFAULT_MODELLED_INPUTS,
  boardingRatePerMinute: 0.8,
  alightingFraction: 0.25,
  vehicleCapacity: 52,
};

describe('per-corridor demand arithmetic', () => {
  it('derives a rate whose modelled peak load is exactly the requested share of the seats', () => {
    for (const headway of [300, 900, 1800, 3582, 12497]) {
      for (const stopCount of [4, 12, 48]) {
        const rate = derivedBoardingRatePerMinute({
          targetHeadwaySeconds: headway,
          stopCount,
          alightingFraction: 0.25,
          vehicleCapacity: 52,
          peakLoadShare: 0.65,
        });
        expect(rate).not.toBeNull();
        expect(modelledPeakLoad(rate!, headway, 0.25, stopCount)).toBeCloseTo(0.65 * 52, 6);
      }
    }
  });

  it('halves the rate when the headway doubles, because the load is proportional to it', () => {
    const shared = { stopCount: 20, alightingFraction: 0.25, vehicleCapacity: 52, peakLoadShare: 0.65 };
    const at900 = derivedBoardingRatePerMinute({ ...shared, targetHeadwaySeconds: 900 })!;
    const at1800 = derivedBoardingRatePerMinute({ ...shared, targetHeadwaySeconds: 1800 })!;
    expect(at1800).toBeCloseTo(at900 / 2, 6);
  });

  it('gives a SHORT corridor more demand than the asymptotic formula, because its load never reaches steady state', () => {
    // Load ramps geometrically toward `lambda x H / alighting`, so a 4-stop
    // corridor peaks well below it. Sizing demand on the asymptote would run
    // that corridor far emptier than the one it is being compared with.
    const asymptotic = 1 / 0.25;
    expect(peakLoadPerHeadwayOfBoardings(4, 0.25)).toBeLessThan(asymptotic);
    expect(peakLoadPerHeadwayOfBoardings(48, 0.25)).toBeCloseTo(asymptotic, 3);

    const shared = { targetHeadwaySeconds: 1800, alightingFraction: 0.25, vehicleCapacity: 52, peakLoadShare: 0.65 };
    expect(derivedBoardingRatePerMinute({ ...shared, stopCount: 4 })!).toBeGreaterThan(
      derivedBoardingRatePerMinute({ ...shared, stopCount: 48 })!,
    );
  });

  it('is the whole saturation story: the global rate overloads this network\'s median corridor and the derived one does not', () => {
    // The seeded network's median MEASURED target headway is 1,800 s.
    const globalPeak = modelledPeakLoad(0.8, 1800, 0.25, 20);
    expect(globalPeak).toBeGreaterThan(52);

    const derived = derivedBoardingRatePerMinute({
      targetHeadwaySeconds: 1800,
      stopCount: 20,
      alightingFraction: 0.25,
      vehicleCapacity: 52,
      peakLoadShare: DERIVED_PEAK_LOAD_SHARE,
    })!;
    expect(modelledPeakLoad(derived, 1800, 0.25, 20)).toBeLessThan(52);
  });

  it('refuses rather than fabricates when there is no headway or no stop to board at', () => {
    const shared = { alightingFraction: 0.25, vehicleCapacity: 52, peakLoadShare: 0.65 };
    expect(derivedBoardingRatePerMinute({ ...shared, targetHeadwaySeconds: 0, stopCount: 20 })).toBeNull();
    expect(derivedBoardingRatePerMinute({ ...shared, targetHeadwaySeconds: 900, stopCount: 1 })).toBeNull();
  });

  it('sits inside the load range the three presets were themselves run at', () => {
    // The presets are the entire evidence base this harness is compared with,
    // and each of them already picks its demand to hit a load fraction. The
    // derived share is not a new invention; it is the middle of theirs.
    const shares = Object.values(CORRIDOR_PRESETS).map((preset) => {
      const inputs = { ...DEFAULT_MODELLED_INPUTS, ...preset.inputs };
      return (
        modelledPeakLoad(
          inputs.boardingRatePerMinute,
          preset.corridor.targetHeadwaySeconds,
          inputs.alightingFraction,
          preset.corridor.stationCount,
        ) / inputs.vehicleCapacity
      );
    });
    expect(Math.min(...shares)).toBeLessThan(DERIVED_PEAK_LOAD_SHARE);
    expect(Math.max(...shares)).toBeGreaterThan(DERIVED_PEAK_LOAD_SHARE);
  });
});

describe('resolving one corridor\'s demand', () => {
  const corridor = corridorWith(1800);

  it('prefers a value the spec named for this corridor over anything derived', () => {
    const resolved = resolveCorridorDemand(corridor, INPUTS, {
      mode: 'derived',
      peakLoadShare: 0.65,
      boardingRatePerMinuteByRouteDirectionId: { [corridor.routeDirectionId]: 0.31 },
    });
    expect(resolved.provenance).toBe('specified');
    expect(resolved.boardingRatePerMinute).toBe(0.31);
  });

  it('derives from the corridor\'s own headway and geometry when nothing named it', () => {
    const resolved = resolveCorridorDemand(corridor, INPUTS, {
      mode: 'derived',
      peakLoadShare: 0.65,
      boardingRatePerMinuteByRouteDirectionId: {},
    });
    expect(resolved.provenance).toBe('derived');
    expect(resolved.peakLoadShare).toBeCloseTo(0.65, 6);
  });

  it('keeps the one global rate when asked for it, so an older run stays reproducible', () => {
    const resolved = resolveCorridorDemand(corridor, INPUTS, {
      mode: 'global',
      peakLoadShare: 0.65,
      boardingRatePerMinuteByRouteDirectionId: {},
    });
    expect(resolved.provenance).toBe('global');
    expect(resolved.boardingRatePerMinute).toBe(INPUTS.boardingRatePerMinute);
    // And it says the corridor is over the seats, which is the finding.
    expect(resolved.peakLoadShare).toBeGreaterThan(1);
    expect(describeDemand(resolved)).toMatch(/over/i);
  });
});

describe('the harness end to end', () => {
  const spec = (demand: Record<string, unknown>) =>
    parseExperimentSpec({
      name: 'demand-test',
      corridors: { source: 'synthetic', count: 1 },
      scenarios: ['none'],
      seeds: { count: 4, base: 4242 },
      arms: [{ name: 'as-deployed', policyOverrides: {} }],
      inputs: { boardingRatePerMinute: 0.8, alightingFraction: 0.25, vehicleCapacity: 52 },
      demand,
    });

  it('saturates a real-headway corridor under the global rate and clears it under the derived one', () => {
    const corridor = corridorWith(1800);

    const global = buildReport(
      runExperiment(spec({ mode: 'global' }), [corridor], 'measured'),
    );
    expect(global.saturated.length).toBeGreaterThan(0);
    expect(global.summaries[0]!.deniedShare).toBeGreaterThan(SATURATION_WARN_SHARE);

    const derived = buildReport(
      runExperiment(spec({ mode: 'derived' }), [corridor], 'measured'),
    );
    expect(derived.saturated).toHaveLength(0);
    expect(derived.summaries[0]!.deniedShare).toBeLessThanOrEqual(SATURATION_WARN_SHARE);
  });

  it('records what each corridor\'s demand was and where it came from', () => {
    const report = buildReport(runExperiment(spec({ mode: 'derived' }), [corridorWith(1800)], 'measured'));
    expect(report.demand).toHaveLength(1);
    expect(report.demand[0]!.demand.provenance).toBe('derived');
    expect(report.demand[0]!.routeDirectionId).toBe('rd-1800');
  });

  it('pools the network headline over the corridors control could affect, and names the ones it left out', () => {
    const run = runExperiment(spec({ mode: 'global' }), [corridorWith(1800), corridorWith(600)], 'measured');
    const report = buildReport(run);
    expect(report.headlineScope.scope).toBe('readable_only');
    expect(report.headlineScope.excludedCorridors).toContain('rd-1800');
    expect(report.headlineScope.pooledGroups).toBeGreaterThan(0);
  });
});

describe('the three presets, as corridors this harness can run', () => {
  it('builds them from CORRIDOR_PRESETS rather than re-declaring their numbers', async () => {
    const { corridors, provenance } = await selectCorridors({ source: 'preset' });
    expect(provenance).toBe('preset');
    expect(corridors).toHaveLength(3);
    for (const corridor of corridors) {
      const preset = Object.values(CORRIDOR_PRESETS).find(
        (p) => p.corridor.routeDirectionId === corridor.routeDirectionId,
      );
      expect(preset).toBeDefined();
      expect(corridor.policy.targetHeadwaySeconds).toBe(preset!.corridor.targetHeadwaySeconds);
      expect(corridor.stops).toHaveLength(preset!.corridor.stationCount);
      expect(corridor.totalDistanceMeters).toBe(preset!.corridor.totalDistanceMeters);
    }
  });

  it('carries each preset\'s own modelled inputs, because a preset is its whole package', async () => {
    const { presetInputs } = await selectCorridors({ source: 'preset' });
    expect(presetInputs?.get('fleet-trial-urban')?.boardingRatePerMinute).toBe(
      CORRIDOR_PRESETS.urban.inputs.boardingRatePerMinute,
    );
  });
});
