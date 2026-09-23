// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { showcaseFigures, type ShowcaseFigures } from '@/lib/showcase/figures';
import { LUCKNOW_CORRIDOR } from '@/lib/showcase/corridor';
import { resolveShowcase, scenarioFamily, scenarioOutcome } from '@/lib/showcase/resolve';
import {
  trialDataSchema,
  type TrialArmSummary,
  type TrialContrast,
  type TrialData,
  type TrialScenario,
} from '@/lib/showcase/trialData';

function contrast(over: Partial<TrialContrast> = {}): TrialContrast {
  return {
    ewtImprovementPercent: 40,
    passengerSecondsSavedPercent: 2.5,
    passengerSecondsSaved: 9000,
    incidentsAvoided: 12,
    waitSecondsSaved: 12000,
    onboardDelayImposed: 4000,
    inVehicleSecondsSaved: -3000,
    bunchingRateImprovementPercent: 30,
    cvImprovementPercent: 12,
    addedJourneySecondsPerVehicle: 474,
    additionalDeniedBoardings: -6,
    ...over,
  };
}

function arm(over: Partial<TrialArmSummary> = {}): TrialArmSummary {
  return {
    ewtSeconds: 90,
    meanHeadwaySeconds: 360,
    headwayCv: 0.4,
    bunchingRate: 0.1,
    incidentsDetected: 100,
    incidentsResolved: 10,
    onTimeRate: 0.6,
    meanHoldSecondsPerVehicle: 120,
    totalHoldSeconds: 6000,
    totalPassengerSeconds: 360000,
    waitPassengerSeconds: 90000,
    boardings: 4000,
    deniedBoardings: 10,
    deniedShare: 0.0025,
    firstTimeDeniedBoardings: 10,
    meanJourneySeconds: 26118,
    p95JourneySeconds: 27000,
    meanScheduleDeviationSeconds: 40,
    p95ScheduleDeviationSeconds: 200,
    maxHoldSecondsOnAnyVehicle: 120,
    alightingOnlyActions: 0,
    alightingOnlyPassengersPassed: 0,
    ...over,
  };
}

function scenario(id: TrialScenario['id'], over: Partial<TrialScenario> = {}): TrialScenario {
  return {
    id,
    title: id,
    mechanism: `${id} mechanism`,
    whatItTests: `${id} tests`,
    vehicleCount: 50,
    horizonSeconds: 24000,
    saturated: false,
    contrast: contrast(),
    controlled: arm({ incidentsDetected: 60 }),
    uncontrolled: arm(),
    sweeps: {
      controlled: [
        { atSeconds: 0, openIncidents: 0, bunchedPairs: 0, liveVehicles: 5 },
        { atSeconds: 12000, openIncidents: 2, bunchedPairs: 1, liveVehicles: 9 },
      ],
      uncontrolled: [
        { atSeconds: 0, openIncidents: 0, bunchedPairs: 0, liveVehicles: 5 },
        { atSeconds: 12000, openIncidents: 5, bunchedPairs: 3, liveVehicles: 9 },
      ],
    },
    trajectories: null,
    ...over,
  };
}

function trialData(over: Partial<TrialData> = {}): TrialData {
  const data: TrialData = {
    builtAt: '2026-09-23T00:00:00.000Z',
    headlinePhaseId: 'occupancy_blind',
    replayScenarioIds: ['steady_variability', 'slow_bus'],
    corridors: [
      {
        presetId: 'urban',
        title: '24 km city trunk',
        routeName: 'Trial corridor: 24 km city trunk',
        totalDistanceMeters: 24000,
        stationCount: 25,
        targetHeadwaySeconds: 360,
        bunchedThresholdRatio: 0.25,
        warningThresholdRatio: 0.5,
        maxHoldSeconds: 120,
        generatedAt: '2026-09-23T00:00:00.000Z',
        durationMs: 1000,
        vehiclesSimulated: 2000,
        headlineScope: {
          includedScenarioIds: ['steady_variability', 'slow_bus'],
          excludedScenarioIds: ['oversaturated'],
        },
        controllability: { disturbanceRatio: 0.096, legTimeSigmaSeconds: 34, band: 'controllable' },
        headlineNetPercent: 3.7,
        allScenariosNetPercent: 2.4,
        stations: [
          { sequence: 1, name: 'Station 1', cumulativeDistanceMeters: 0 },
          { sequence: 2, name: 'Station 2', cumulativeDistanceMeters: 1000 },
        ],
        phases: [
          {
            id: 'occupancy_blind',
            title: 'Phase 1',
            vehicleCount: 1000,
            contrast: contrast(),
            allScenariosContrast: contrast({ passengerSecondsSavedPercent: 2.4 }),
            controlled: arm({ incidentsDetected: 2300, incidentsResolved: 900 }),
            uncontrolled: arm({ incidentsDetected: 4700, incidentsResolved: 430 }),
            lawCoverage: [
              { law: 'terminal_dispatch', decisionsGenerating: 860, decisionsTotal: 24900 },
              { law: 'two_way', decisionsGenerating: 6914, decisionsTotal: 24900 },
              { law: 'self_equalizing', decisionsGenerating: 378, decisionsTotal: 24900 },
              { law: 'boarding_limit', decisionsGenerating: 649, decisionsTotal: 24900 },
            ],
            holdSecondsByStation: [
              { sequence: 1, name: 'Station 1', holdSeconds: 18000, holdCount: 800 },
              { sequence: 2, name: 'Station 2', holdSeconds: 9000, holdCount: 300 },
            ],
            holdCountByActionType: [
              { actionType: 'two_way_hold', count: 2774, holdSeconds: 179880 },
              { actionType: 'terminal_dispatch_hold', count: 830, holdSeconds: 18211 },
            ],
            scenarios: [
              scenario('steady_variability', {
                trajectories: {
                  controlled: [{ vehicleId: 'BUS-1', points: [{ t: 0, d: 0, hold: 0 }] }],
                  uncontrolled: [{ vehicleId: 'BUS-1', points: [{ t: 0, d: 0, hold: 0 }] }],
                },
              }),
              scenario('slow_bus'),
              scenario('oversaturated', {
                saturated: true,
                contrast: contrast({ passengerSecondsSavedPercent: -4.5 }),
              }),
              scenario('phantom_position', {
                contrast: contrast({ passengerSecondsSavedPercent: 0.2 }),
              }),
            ],
          },
        ],
      },
    ],
    ...over,
  };
  return trialDataSchema.parse(data);
}

describe('resolveShowcase', () => {
  it('leads with the authored figures, not the trial, wherever a figure is authored', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    expect(model.verdict.sentence).toBe(showcaseFigures.headline.verdict);
    expect(model.verdict.netPercent).toBe(showcaseFigures.headline.netPassengerTimeSavedPercent);
    expect(model.verdict.excessWaitPercent).toBe(showcaseFigures.headline.excessWaitCutPercent);
    expect(model.hero.stats.map((stat) => stat.value)).toEqual([
      showcaseFigures.trial.buses,
      showcaseFigures.trial.decisions,
      showcaseFigures.trial.scenarios,
      showcaseFigures.headline.waitingRemovedHours,
    ]);
    expect(model.verdict.corridors).toHaveLength(3);
    expect(model.verdict.corridors[0]?.bandLabel).toBe('Controllable band');
    expect(model.verdict.corridors[2]?.bandLabel).toBe('High dispersion');
  });

  it('reads per-scenario results from the trial and lets an override win', () => {
    const figures: ShowcaseFigures = {
      ...showcaseFigures,
      scenarioOverrides: { slow_bus: { netPassengerTimeSavedPercent: 9.9 } },
    };
    const model = resolveShowcase(figures, trialData());
    const steady = model.gallery.cards.find((card) => card.id === 'steady_variability');
    const slow = model.gallery.cards.find((card) => card.id === 'slow_bus');
    expect(steady?.netPercent).toBe(2.5);
    expect(steady?.excessWaitPercent).toBe(40);
    expect(slow?.netPercent).toBe(9.9);
    expect(slow?.excessWaitPercent).toBe(40);
    expect(steady?.whatGoesWrong).toBe(showcaseFigures.scenarioNotes.steady_variability);
  });

  it('classifies every card by family and outcome', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    const byId = new Map(model.gallery.cards.map((card) => [card.id, card]));
    expect(byId.get('steady_variability')?.family).toBe('corridor');
    expect(byId.get('phantom_position')?.family).toBe('estimator');
    expect(byId.get('oversaturated')?.family).toBe('adversarial');
    expect(byId.get('steady_variability')?.outcome).toBe('helped');
    expect(byId.get('oversaturated')?.outcome).toBe('stress_test');
    expect(byId.get('phantom_position')?.outcome).toBe('no_effect');
    expect(model.gallery.families.map((family) => family.count)).toEqual([2, 1, 1]);
  });

  it('offers a replay per corridor, only for scenarios that carry trajectories', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    expect(model.liveTrial.corridors).toHaveLength(1);
    const urban = model.liveTrial.corridors[0];
    expect(urban?.presetId).toBe('urban');
    expect(urban?.name).toBe('City trunk');
    expect(urban?.netPercent).toBe(3.8);
    expect(urban?.scenarios.map((scenario) => scenario.id)).toEqual(['steady_variability']);
    expect(urban?.route).toBe(LUCKNOW_CORRIDOR);
    expect(urban?.trialCorridorLengthMeters).toBe(24000);
    expect(urban?.targetHeadwaySeconds).toBe(360);
    expect(urban?.stationNames).toHaveLength(25);
  });

  it('draws each corridor on its own route', () => {
    const data = trialData();
    const urban = data.corridors[0];
    if (!urban) throw new Error('fixture');
    data.corridors.push({ ...urban, presetId: 'intercity', totalDistanceMeters: 400000 });
    const model = resolveShowcase(showcaseFigures, data);
    expect(model.liveTrial.corridors.map((corridor) => corridor.route.id)).toEqual([
      'lko-41',
      'lko-11',
    ]);
    expect(model.gallery.corridors.map((corridor) => corridor.presetId)).toEqual([
      'urban',
      'intercity',
    ]);
    expect(model.gallery.corridors[1]?.cards).toHaveLength(4);
    expect(model.report.corridors.map((row) => row.name)).toEqual([
      'City trunk',
      'Inter-city trunk',
    ]);
  });

  it('names the laws from the wire label map and reads their coverage and holds', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    const twoWay = model.pipeline.laws.find((law) => law.id === 'two_way');
    expect(twoWay?.name).toBe('Two-way holding');
    expect(twoWay?.decisionsGenerating).toBe(6914);
    expect(twoWay?.decisionsTotal).toBe(24900);
    expect(twoWay?.holdCount).toBe(2774);
    expect(twoWay?.sharePercent).toBeCloseTo((6914 / 24900) * 100, 6);
    expect(model.pipeline.laws.map((law) => law.id)).toEqual([
      'terminal_dispatch',
      'two_way',
      'self_equalizing',
      'boarding_limit',
    ]);
  });

  it('renames the trial stations to the map corridor stops by order', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    expect(model.pipeline.stationHolds.map((station) => station.name)).toEqual([
      'Alambagh Bus Station',
      'Singar Nagar',
    ]);
    expect(model.pipeline.stationHolds[0]?.share).toBe(1);
    expect(model.pipeline.stationHolds[1]?.share).toBe(0.5);
  });

  it('matches stations by order when the trial numbers them from zero', () => {
    const data = trialData();
    const corridor = data.corridors[0];
    const phase = corridor?.phases[0];
    if (!corridor || !phase) throw new Error('fixture');
    corridor.stations = [
      { sequence: 0, name: 'Origin terminal', cumulativeDistanceMeters: 0 },
      { sequence: 1, name: 'Station 2', cumulativeDistanceMeters: 1000 },
    ];
    phase.holdSecondsByStation = [
      { sequence: 0, name: 'Origin terminal', holdSeconds: 18000, holdCount: 800 },
      { sequence: 1, name: 'Station 2', holdSeconds: 9000, holdCount: 300 },
    ];
    const model = resolveShowcase(showcaseFigures, data);
    expect(model.pipeline.stationHolds.map((station) => station.name)).toEqual([
      'Alambagh Bus Station',
      'Singar Nagar',
    ]);
  });

  it('takes the incident counts from the trial and the rates from the figures', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    expect(model.balance.incidents.before.detected).toBe(4700);
    expect(model.balance.incidents.after.detected).toBe(2300);
    expect(model.balance.incidents.before.resolvedPercent).toBe(
      showcaseFigures.headline.incidentsResolvedBeforePercent,
    );
    expect(model.balance.onTime.afterPercent).toBe(showcaseFigures.headline.onTimeAfterPercent);
  });

  it('still resolves when the lead corridor is missing from the data', () => {
    const model = resolveShowcase(showcaseFigures, trialData({ corridors: [] }));
    expect(model.gallery.cards).toEqual([]);
    expect(model.liveTrial.corridors).toEqual([]);
    expect(model.verdict.corridors).toHaveLength(3);
    expect(model.scale.stats).toHaveLength(6);
    expect(model.report.corridors).toEqual([]);
    expect(model.report.reference).toMatch(/^FT-\d{8}-00$/);
  });
});

describe('the report', () => {
  it('references itself by the newest run date and the corridor count', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    expect(model.report.reference).toBe('FT-20260923-01');
    expect(model.report.generatedLabel).toBe('23 September 2026');
    expect(model.report.title).toBe(showcaseFigures.report.title);
  });

  it('takes net and cut from the figures and every other column from the trial', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    const row = model.report.corridors[0];
    expect(row?.netPercent).toBe(3.8);
    expect(row?.excessWaitCutPercent).toBe(54);
    expect(row?.ewtBeforeSeconds).toBe(90);
    expect(row?.ewtAfterSeconds).toBeCloseTo(90 * 0.46, 6);
    expect(row?.incidentsBefore).toBe(4700);
    expect(row?.incidentsAfter).toBe(2300);
    expect(row?.resolvedBeforePercent).toBeCloseTo((430 / 4700) * 100, 6);
    expect(row?.onTimeAfterPercent).toBeCloseTo(60, 6);
    expect(row?.seedsAgreeing).toBe(6);
    expect(row?.scenariosPooled).toBe(2);
    expect(row?.scenariosExcluded).toBe(1);
    expect(row?.conclusion).toContain('City trunk: +3.8%');
  });

  it('lays out the comparison rows of the sample, both arms and the change', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    const rows = model.report.corridors[0]?.comparison ?? [];
    expect(rows.map((row) => row.id)).toEqual([
      'passenger_time',
      'excess_wait',
      'headway_cv',
      'bunched',
      'refused',
      'journey_time',
      'on_time',
      'lateness',
    ]);
    const time = rows[0];
    expect(time?.leftAlone).toBe('100 h');
    expect(time?.underControl).toBe('96 h');
    expect(time?.change).toEqual({ kind: 'improvement', percent: 3.8, good: true });
    const wait = rows[1];
    expect(wait?.leftAlone).toBe('90s');
    expect(wait?.underControl).toBe('41s');
    expect(wait?.change).toEqual({ kind: 'improvement', percent: 54, good: true });
    expect(rows[2]?.change).toEqual({ kind: 'improvement', percent: 12, good: true });
    expect(rows[4]?.hint).toContain('0.3% of people offered a seat were refused one');
    expect(rows[5]?.leftAlone).toBe('435.3 min');
    expect(rows[5]?.change).toEqual({ kind: 'cost', label: '+7.9 min' });
    expect(rows[6]?.leftAlone).toBe('60%');
    expect(rows[7]?.leftAloneNote).toBe('p95 3.3 min');
    // A higher on-time rate is an improvement, and a mean of -1e-12 is zero.
    const data = trialData();
    const phase = data.corridors[0]?.phases[0];
    if (!phase) throw new Error('fixture');
    phase.controlled.onTimeRate = 0.73;
    phase.uncontrolled.onTimeRate = 0.61;
    phase.uncontrolled.meanScheduleDeviationSeconds = -1e-12;
    const shifted = resolveShowcase(showcaseFigures, data).report.corridors[0]?.comparison ?? [];
    expect(shifted[6]?.change).toEqual({
      kind: 'improvement',
      percent: expect.closeTo(19.672, 2) as number,
      good: true,
    });
    expect(shifted[7]?.leftAlone).toBe('0.0 min');
    expect(rows[7]?.change).toEqual({ kind: 'cost', label: 'worst bus held 2.0 min' });
  });

  it('tabulates every scenario per corridor with its outcome, and the laws and busiest stations', () => {
    const model = resolveShowcase(showcaseFigures, trialData());
    expect(model.report.scenarios).toHaveLength(1);
    expect(model.report.scenarios[0]?.rows).toHaveLength(4);
    expect(
      model.report.scenarios[0]?.rows.find((row) => row.id === 'oversaturated')?.outcomeLabel,
    ).toBe('Stress test');
    expect(model.report.activity[0]?.laws.map((law) => law.id)).toEqual([
      'terminal_dispatch',
      'two_way',
      'self_equalizing',
      'boarding_limit',
    ]);
    expect(model.report.activity[0]?.stationHolds.map((station) => station.name)).toEqual([
      'Alambagh Bus Station',
      'Singar Nagar',
    ]);
    expect(model.report.method).toEqual(showcaseFigures.report.method);
    expect(model.report.summary.corridorLines).toHaveLength(3);
  });
});

describe('classification helpers', () => {
  it('reads a negative or saturated scenario as a stress test, never a failure', () => {
    expect(scenarioOutcome(-1, false)).toBe('stress_test');
    expect(scenarioOutcome(5, true)).toBe('stress_test');
    expect(scenarioOutcome(0.2, false)).toBe('no_effect');
    expect(scenarioOutcome(null, false)).toBe('no_effect');
    expect(scenarioOutcome(0.5, false)).toBe('helped');
  });

  it('puts the estimator attacks in their own family', () => {
    expect(scenarioFamily('frozen_feed')).toBe('estimator');
    expect(scenarioFamily('building_peak')).toBe('adversarial');
    expect(scenarioFamily('cascade')).toBe('corridor');
  });
});
