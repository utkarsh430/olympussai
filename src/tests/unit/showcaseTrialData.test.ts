// @vitest-environment node
//
// The showcase extractor, driven over a report small enough to read.
//
// The fixture mirrors simulatorConsole.test.tsx's builder and is PARSED with
// the wire schema rather than cast, so it cannot drift out of the contract
// the real script reads. Every assertion is about a rule the page depends on:
// the committed file must parse, the curves must still end where the run
// ended, the replay trajectories must be kept exactly where the picker looks
// for them and nowhere else, the other phase must carry no curves nobody
// reads, and the headline percent must be the one number the console already
// publishes.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXTRACT_OPTIONS,
  decimate,
  extractTrialData,
  type ExtractOptions,
} from '../../../scripts/lib/showcaseTrialData';
import { headlineNetPassengerTime } from '@/lib/ops/fleetTrialView';
import { trialDataSchema } from '@/lib/showcase/trialData';
import {
  fleetTrialReportSchema,
  type BunchingScenarioId,
  type FleetTrialReport,
} from '@/models/fleetTrial';

// ─── Fixture ──────────────────────────────────────────────────────────────

type Spacing = FleetTrialReport['phases'][number]['controlled']['spacing'];

const spacing = (over: Partial<Spacing> = {}): Spacing => ({
  headwaySampleCount: 100,
  meanHeadwaySeconds: 600,
  ewtSeconds: 60,
  headwayCv: 0.4,
  bunchingRate: 0.1,
  deniedBoardings: 40,
  firstTimeDeniedBoardings: 10,
  totalBoardings: 990,
  deniedShare: 10 / 1000,
  saturated: false,
  ...over,
});

const punctuality = () => ({
  vehiclesCompleted: 30,
  meanJourneySeconds: 3600,
  p95JourneySeconds: 3900,
  maxJourneySeconds: 4000,
  totalHoldSeconds: 600,
  meanHoldSecondsPerVehicle: 20,
  maxHoldSecondsOnAnyVehicle: 90,
  refusedHoldSeconds: 0,
  meanScheduleDeviationSeconds: 30,
  p95ScheduleDeviationSeconds: 200,
  onTimeRate: 0.9,
  shareBeyondLatenessBound: 0.05,
  alightingOnlyActions: 0,
  alightingOnlyPassengersPassed: 0,
});

const passengers = (totalPassengerSeconds: number) => ({
  boardings: 1000,
  deniedBoardings: 40,
  waitPassengerSeconds: totalPassengerSeconds * 0.3,
  onboardDelayPassengerSeconds: 500,
  dwellPassengerSeconds: totalPassengerSeconds * 0.2,
  ridePassengerSeconds: totalPassengerSeconds * 0.5,
  inVehiclePassengerSeconds: totalPassengerSeconds * 0.7,
  totalPassengerSeconds,
});

const incidents = () => ({
  detected: 20,
  byOpeningSeverity: { bunched: 10 },
  byPeakSeverity: { bunched: 10 },
  escalatedFromPrediction: 2,
  resolved: 15,
  closedPairGone: 3,
  unresolvedAtEnd: 2,
  medianResolutionSeconds: 300,
  meanResolutionSeconds: 320,
  worstRatio: 0.2,
  withIntervention: 8,
  totalHoldSecondsServed: 600,
});

const arm = (totalPassengerSeconds: number, spacingOver: Partial<Spacing> = {}) => ({
  spacing: spacing(spacingOver),
  punctuality: punctuality(),
  passengers: passengers(totalPassengerSeconds),
  incidents: incidents(),
});

const contrast = (saved: number, total: number) => ({
  ewtImprovementSeconds: 20,
  ewtImprovementPercent: 25,
  cvImprovementPercent: 20,
  bunchingRateImprovementPercent: 30,
  incidentsAvoided: 5,
  addedJourneySecondsPerVehicle: 30,
  additionalDeniedBoardings: 0,
  passengerSecondsSaved: saved,
  passengerSecondsSavedPercent: (saved / total) * 100,
  passengerSecondsPerBoardingSavedPercent: (saved / total) * 100,
  waitSecondsSaved: saved,
  onboardDelayImposed: 500,
  inVehicleSecondsSaved: 0,
});

const sweepSamples = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    atSeconds: i * 60,
    liveVehicles: 10 + (i % 5),
    pairCount: 9,
    minRatio: 0.3,
    meanRatio: 0.8,
    bunchedPairs: i % 3,
    warningPairs: 1,
    openIncidents: i % 2,
  }));

const trajectory = (vehicleId: string) => ({
  vehicleId,
  points: [
    { t: 0, d: 0, hold: 0 },
    { t: 600, d: 2000, hold: 30 },
    { t: 1200, d: 4000, hold: 0 },
  ],
});

interface ScenarioShape {
  id: BunchingScenarioId;
  title: string;
  saturated: 'none' | 'controlled' | 'uncontrolled';
  sweepCount: number;
  trajectoryCount: number;
}

const scenario = ({ id, title, saturated, sweepCount, trajectoryCount }: ScenarioShape) => ({
  id,
  title,
  mechanism: `${title} mechanism`,
  whatItTests: `${title} tests`,
  vehicleCount: 30,
  seed: 1,
  horizonSeconds: 7200,
  controlled: arm(9_000, saturated === 'controlled' ? { saturated: true, deniedShare: 0.5 } : {}),
  uncontrolled: arm(
    10_000,
    saturated === 'uncontrolled' ? { saturated: true, deniedShare: 0.52 } : {},
  ),
  contrast: saturated === 'none' ? contrast(250, 10_000) : contrast(-500, 10_000),
  sweeps: { controlled: sweepSamples(sweepCount), uncontrolled: sweepSamples(sweepCount) },
  trajectories: {
    controlled: Array.from({ length: trajectoryCount }, (_, i) => trajectory(`C${i}`)),
    uncontrolled: Array.from({ length: trajectoryCount }, (_, i) => trajectory(`U${i}`)),
  },
  worstIncidents: [],
  worstIncidentsUncontrolled: [],
});

function phase(id: 'occupancy_blind' | 'occupancy_aware', title: string) {
  return {
    id,
    title,
    weighOccupancy: id === 'occupancy_aware',
    vehicleCount: 60,
    scenarios: [
      scenario({
        id: 'steady_variability',
        title: 'Steady variability',
        saturated: 'none',
        sweepCount: 12,
        trajectoryCount: 1,
      }),
      scenario({
        id: 'slow_bus',
        title: 'Slow bus',
        saturated: 'none',
        sweepCount: 130,
        trajectoryCount: 2,
      }),
      // Saturated on ONE arm only, so the derivation from either arm is what is tested.
      scenario({
        id: 'oversaturated',
        title: 'More passengers than seats',
        saturated: 'uncontrolled',
        sweepCount: 12,
        trajectoryCount: 1,
      }),
    ],
    controlled: arm(9_750),
    uncontrolled: arm(10_000),
    contrast: contrast(250, 10_000),
    allScenarios: {
      controlled: arm(20_250),
      uncontrolled: arm(20_000),
      contrast: contrast(-250, 20_000),
    },
    scenarioAgreement: {
      positive: 2,
      count: 3,
      worstPercent: -5,
      worstScenarioId: 'oversaturated',
      bestPercent: 2.5,
      bestScenarioId: 'steady_variability',
    },
    lawCoverage: [
      {
        law: 'two_way',
        decisionsGenerating: 10,
        decisionsTotal: 40,
        commonestDecline: null,
        commonestDeclineShare: null,
      },
    ],
    holdSecondsByStation: [
      { stopId: 'S1', name: 'One', sequence: 0, holdSeconds: 100, holdCount: 5 },
    ],
    holdCountByActionType: [{ actionType: 'two_way_hold', count: 5, holdSeconds: 100 }],
    safetyRejections: [{ reason: 'max_lateness_breach', count: 3 }],
  };
}

function buildReport(presetId: string, generatedAt = '2026-09-06T09:00:00.000Z'): FleetTrialReport {
  const raw = {
    generatedAt,
    durationMs: 2000,
    corridorPreset: { id: presetId, title: `${presetId} trunk`, description: 'A corridor.' },
    alightingOnlySelectable: false,
    headlineScope: {
      includedScenarioIds: ['steady_variability', 'slow_bus'],
      excludedScenarios: [
        { id: 'oversaturated', title: 'More passengers than seats', deniedShare: 0.52 },
      ],
      fellBackToAllScenarios: false,
      note: 'Averaged over 2 of 3 scenarios.',
    },
    corridor: {
      routeDirectionId: 'RD-1',
      routeName: `${presetId} route`,
      totalDistanceMeters: 24_000,
      stationCount: 3,
      holdingPointCount: 3,
      targetHeadwaySeconds: 600,
      bunchedThresholdRatio: 0.25,
      warningThresholdRatio: 0.5,
      maxHoldSeconds: 120,
      kf: 0.4,
      kb: 0.4,
      selfEqualizingK: 0.4,
      stations: [
        {
          stopId: 'S3',
          name: 'Three',
          sequence: 2,
          cumulativeDistanceMeters: 24_000,
          latitude: 1,
          longitude: 1,
        },
        {
          stopId: 'S1',
          name: 'One',
          sequence: 0,
          cumulativeDistanceMeters: 0,
          latitude: 1,
          longitude: 1,
        },
        {
          stopId: 'S2',
          name: 'Two',
          sequence: 1,
          cumulativeDistanceMeters: 12_000,
          latitude: 1,
          longitude: 1,
        },
      ],
    },
    controllability: {
      legTimeSigmaSeconds: 60,
      disturbanceRatio: 0.1,
      band: 'controllable',
      note: 'In the band.',
    },
    scheduleFit: {
      band: 'achievable',
      shareBeyondLatenessBound: 0.05,
      meanUncontrolledDeviationSeconds: 30,
      deviationRatio: 0.05,
      note: 'The timetable fits.',
    },
    vehiclesSimulated: 120,
    sweepIntervalSeconds: 60,
    requiredSamples: 2,
    phases: [phase('occupancy_blind', 'Load ignored'), phase('occupancy_aware', 'Load weighed')],
    policyStudies: [],
    occupancyContrast: {
      decisionsCompared: 100,
      decisionsChanged: 0,
      meanObjectiveCostBlind: 10,
      meanObjectiveCostAware: 20,
      rankingComparable: false,
      verdict: 'It changed no decision.',
    },
    provenance: [
      { field: 'demand', value: 'invented', source: 'modelled', note: 'No ticketing feed exists.' },
    ],
    notExercised: ['the command lifecycle'],
  };
  return fleetTrialReportSchema.parse(raw);
}

const OPTIONS: ExtractOptions = { ...DEFAULT_EXTRACT_OPTIONS, builtAt: '2026-09-23T00:00:00.000Z' };

function scenarioIn(
  data: ReturnType<typeof extractTrialData>,
  presetId: string,
  phaseId: string,
  scenarioId: BunchingScenarioId,
) {
  const corridor = data.corridors.find((c) => c.presetId === presetId);
  const phaseData = corridor?.phases.find((p) => p.id === phaseId);
  const found = phaseData?.scenarios.find((s) => s.id === scenarioId);
  if (!found) throw new Error(`${presetId}/${phaseId}/${scenarioId} missing from the extract`);
  return found;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('decimate', () => {
  it('returns every sample when there are no more than the cap', () => {
    expect(decimate([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(decimate([], 5)).toEqual([]);
  });

  it('keeps the first and last sample and never exceeds the cap', () => {
    const samples = Array.from({ length: 130 }, (_, i) => i);
    const kept = decimate(samples, 60);
    expect(kept).toHaveLength(60);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(129);
    for (let i = 1; i < kept.length; i += 1) {
      expect(kept[i]).toBeGreaterThan(kept[i - 1] ?? -1);
    }
  });

  it('refuses a cap that could not keep both ends', () => {
    expect(() => decimate([1, 2, 3], 1)).toThrow(/at least 2/);
  });
});

describe('extractTrialData', () => {
  const report = buildReport('urban');

  it('produces data the showcase schema accepts', () => {
    const data = extractTrialData([report], OPTIONS);
    expect(() => trialDataSchema.parse(data)).not.toThrow();
    expect(data.builtAt).toBe(OPTIONS.builtAt);
    expect(data.headlinePhaseId).toBe('occupancy_blind');
    expect(data.replayScenarioIds).toEqual(['steady_variability', 'slow_bus', 'traffic_shock']);
  });

  it('defaults to replaying every corridor and to curves for the headline phase alone', () => {
    expect(DEFAULT_EXTRACT_OPTIONS.replayPresetIds).toEqual(['urban', 'suburban', 'intercity']);
    expect(DEFAULT_EXTRACT_OPTIONS.sweepsForNonHeadlinePhase).toBe(false);
  });

  it('caps sweeps at the requested points and keeps the first and last sample', () => {
    const data = extractTrialData([report], { ...OPTIONS, sweepPoints: 40 });
    const slowBus = scenarioIn(data, 'urban', 'occupancy_blind', 'slow_bus');
    for (const armSweeps of [slowBus.sweeps.controlled, slowBus.sweeps.uncontrolled]) {
      expect(armSweeps.length).toBeLessThanOrEqual(40);
      expect(armSweeps[0]?.atSeconds).toBe(0);
      expect(armSweeps[armSweeps.length - 1]?.atSeconds).toBe(129 * 60);
    }
    // A short series is passed through whole.
    const steady = scenarioIn(data, 'urban', 'occupancy_blind', 'steady_variability');
    expect(steady.sweeps.controlled).toHaveLength(12);
    expect(steady.sweeps.controlled[0]).toEqual({
      atSeconds: 0,
      openIncidents: 0,
      bunchedPairs: 0,
      liveVehicles: 10,
    });
  });

  it('keeps trajectories for replay scenarios on every listed corridor, in the headline phase only', () => {
    const data = extractTrialData(
      [report, buildReport('suburban'), buildReport('intercity')],
      OPTIONS,
    );

    for (const presetId of ['urban', 'suburban', 'intercity']) {
      const replay = scenarioIn(data, presetId, 'occupancy_blind', 'slow_bus');
      expect(replay.trajectories).not.toBeNull();
      expect(replay.trajectories?.controlled).toHaveLength(2);
      expect(replay.trajectories?.uncontrolled).toHaveLength(2);
      expect(replay.trajectories?.controlled[0]?.points).toHaveLength(3);
      expect(
        scenarioIn(data, presetId, 'occupancy_blind', 'steady_variability').trajectories,
      ).not.toBeNull();

      // Not a replay scenario.
      expect(
        scenarioIn(data, presetId, 'occupancy_blind', 'oversaturated').trajectories,
      ).toBeNull();
      // Right scenario, wrong phase.
      expect(scenarioIn(data, presetId, 'occupancy_aware', 'slow_bus').trajectories).toBeNull();
    }
  });

  it('narrows the replay to the corridors named, leaving the rest without trajectories', () => {
    const data = extractTrialData([report, buildReport('suburban'), buildReport('intercity')], {
      ...OPTIONS,
      replayPresetIds: ['suburban'],
    });

    expect(scenarioIn(data, 'suburban', 'occupancy_blind', 'slow_bus').trajectories).not.toBeNull();
    expect(scenarioIn(data, 'urban', 'occupancy_blind', 'slow_bus').trajectories).toBeNull();
    expect(scenarioIn(data, 'intercity', 'occupancy_blind', 'slow_bus').trajectories).toBeNull();

    // An empty list is a legal way to keep no trajectories at all.
    const none = extractTrialData([report], { ...OPTIONS, replayPresetIds: [] });
    for (const phaseData of none.corridors[0]?.phases ?? []) {
      for (const scenarioData of phaseData.scenarios) {
        expect(scenarioData.trajectories).toBeNull();
      }
    }
  });

  it('carries sweep curves for the headline phase alone unless asked for every phase', () => {
    const data = extractTrialData([report], OPTIONS);
    expect(scenarioIn(data, 'urban', 'occupancy_blind', 'slow_bus').sweeps.controlled).not.toEqual(
      [],
    );
    const other = scenarioIn(data, 'urban', 'occupancy_aware', 'slow_bus');
    expect(other.sweeps).toEqual({ controlled: [], uncontrolled: [] });
    // The other phase's figures still travel; only its curves are dropped.
    expect(other.contrast.passengerSecondsSaved).toBe(250);
    expect(other.controlled.totalPassengerSeconds).toBe(9_000);
    expect(() => trialDataSchema.parse(data)).not.toThrow();

    const all = extractTrialData([report], { ...OPTIONS, sweepsForNonHeadlinePhase: true });
    const aware = scenarioIn(all, 'urban', 'occupancy_aware', 'slow_bus');
    expect(aware.sweeps.controlled.length).toBeGreaterThan(0);
    expect(aware.sweeps.controlled.length).toBeLessThanOrEqual(OPTIONS.sweepPoints);
    expect(aware.sweeps.uncontrolled[aware.sweeps.uncontrolled.length - 1]?.atSeconds).toBe(
      129 * 60,
    );
    // Widening the other phase changes nothing in the headline phase.
    expect(scenarioIn(all, 'urban', 'occupancy_blind', 'slow_bus').sweeps).toEqual(
      scenarioIn(data, 'urban', 'occupancy_blind', 'slow_bus').sweeps,
    );
  });

  it('derives saturated from either arm', () => {
    const data = extractTrialData([report], OPTIONS);
    // The fixture saturates the uncontrolled arm alone.
    expect(scenarioIn(data, 'urban', 'occupancy_blind', 'oversaturated').saturated).toBe(true);
    expect(scenarioIn(data, 'urban', 'occupancy_blind', 'slow_bus').saturated).toBe(false);
  });

  it('publishes the same headline percent the console does', () => {
    const data = extractTrialData([report], OPTIONS);
    const expected = headlineNetPassengerTime(report);
    const urban = data.corridors[0];
    expect(urban?.headlineNetPercent).toBe(expected.headlinePercent);
    expect(urban?.allScenariosNetPercent).toBe(expected.allScenariosPercent);
    // And the two differ on this fixture, so the assertion is not vacuous.
    expect(urban?.headlineNetPercent).not.toBe(urban?.allScenariosNetPercent);
  });

  it('orders corridors urban, suburban, intercity whatever order the reports arrive in', () => {
    const data = extractTrialData(
      [buildReport('intercity'), buildReport('urban'), buildReport('suburban')],
      OPTIONS,
    );
    expect(data.corridors.map((c) => c.presetId)).toEqual(['urban', 'suburban', 'intercity']);
    // And each corridor's replay went to its own corridor, not to whichever
    // report happened to sit at that index.
    for (const corridor of data.corridors) {
      expect(corridor.title).toBe(`${corridor.presetId} trunk`);
      expect(
        scenarioIn(data, corridor.presetId, 'occupancy_blind', 'slow_bus').trajectories,
      ).not.toBeNull();
    }
  });

  it('carries the corridor, scope and station facts the scenes read', () => {
    const data = extractTrialData([report], OPTIONS);
    const urban = data.corridors[0];
    expect(urban?.title).toBe('urban trunk');
    expect(urban?.routeName).toBe('urban route');
    expect(urban?.targetHeadwaySeconds).toBe(600);
    expect(urban?.headlineScope).toEqual({
      includedScenarioIds: ['steady_variability', 'slow_bus'],
      excludedScenarioIds: ['oversaturated'],
    });
    expect(urban?.controllability).toEqual({
      disturbanceRatio: 0.1,
      legTimeSigmaSeconds: 60,
      band: 'controllable',
    });
    // Stations come out in sequence order even when the report lists them otherwise.
    expect(urban?.stations.map((s) => s.sequence)).toEqual([0, 1, 2]);
    const blind = urban?.phases[0];
    expect(blind?.lawCoverage).toEqual([
      { law: 'two_way', decisionsGenerating: 10, decisionsTotal: 40 },
    ]);
    expect(blind?.holdSecondsByStation).toEqual([
      { sequence: 0, name: 'One', holdSeconds: 100, holdCount: 5 },
    ]);
    expect(blind?.controlled.incidentsDetected).toBe(20);
    expect(blind?.controlled.incidentsResolved).toBe(15);
    expect(blind?.uncontrolled.totalPassengerSeconds).toBe(10_000);
  });

  it('refuses an unknown preset and two reports for one preset', () => {
    expect(() => extractTrialData([buildReport('moon')], OPTIONS)).toThrow(/moon/);
    expect(() => extractTrialData([report, buildReport('urban')], OPTIONS)).toThrow(/urban/);
    expect(() => extractTrialData([], OPTIONS)).toThrow(/At least one/);
  });
});
