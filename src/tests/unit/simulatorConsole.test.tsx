// @vitest-environment jsdom
//
// The simulator console, driven the way the captain drove it.
//
// Two things this page must never do again, both about reporting:
//
//   * lead with a "net passenger time" figure that silently averages in
//     `oversaturated`, a scenario that exists to prove the harness reports
//     NOTHING past the denied-boarding line - measured on urban at 500
//     buses/phase it pulled the headline from +2.5% to +0.8%;
//   * render the last report the control-service PROCESS happened to produce
//     as though it were the reader's own, with no statement of when it ran, on
//     what corridor, or at what fleet size. A 60-bus diagnostic run reporting
//     -7.9% was read that way off a page whose own controls said 1,000 buses.
//
// The charts are mocked: they are SVG geometry with their own concerns, and
// none of the rules here is about them.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/ops/control-room/simulator/TrialCharts', () => ({
  MareyComparison: () => <div data-testid="marey" />,
  PassengerBalance: () => <div data-testid="balance" />,
  StationHolds: () => <div data-testid="holds" />,
  SweepBands: () => <div data-testid="sweeps" />,
}));

import { SimulatorConsole } from '@/components/ops/control-room/simulator/SimulatorConsole';
import { fleetTrialReportSchema, type FleetTrialReport } from '@/models/fleetTrial';

// ─── A report small enough to read, shaped exactly like the wire ─────────
//
// Built by hand rather than captured from a run, and validated against the
// same Zod schema the page parses real reports with - so it cannot drift out
// of the contract without this file failing.

const spacing = (over: Partial<FleetTrialReport['phases'][number]['controlled']['spacing']> = {}) => ({
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

const arm = (totalPassengerSeconds: number, spacingOver = {}) => ({
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

const scenario = (id: string, title: string, saturated: boolean) => ({
  id,
  title,
  mechanism: 'mechanism',
  whatItTests: 'what it tests',
  vehicleCount: 30,
  seed: 1,
  horizonSeconds: 7200,
  controlled: arm(9_000, saturated ? { saturated: true, deniedShare: 0.5 } : {}),
  uncontrolled: arm(10_000, saturated ? { saturated: true, deniedShare: 0.52 } : {}),
  contrast: saturated ? contrast(-500, 10_000) : contrast(250, 10_000),
  sweeps: { controlled: [], uncontrolled: [] },
  trajectories: { controlled: [], uncontrolled: [] },
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
      scenario('steady_variability', 'Steady variability', false),
      scenario('oversaturated', 'More passengers than seats', true),
    ],
    // The readable scenario alone: +2.5%.
    controlled: arm(9_750),
    uncontrolled: arm(10_000),
    contrast: contrast(250, 10_000),
    // Both, including the one built to lose: +(250-500)/20000 = -1.25%.
    allScenarios: {
      controlled: arm(20_250),
      uncontrolled: arm(20_000),
      contrast: contrast(-250, 20_000),
    },
    scenarioAgreement: {
      positive: 1,
      count: 2,
      worstPercent: -5,
      worstScenarioId: 'oversaturated',
      bestPercent: 2.5,
      bestScenarioId: 'steady_variability',
    },
    lawCoverage: [
      { law: 'two_way', decisionsGenerating: 10, decisionsTotal: 40, commonestDecline: null, commonestDeclineShare: null },
    ],
    holdSecondsByStation: [{ stopId: 'S1', name: 'One', sequence: 0, holdSeconds: 100, holdCount: 5 }],
    holdCountByActionType: [{ actionType: 'hold', count: 5, holdSeconds: 100 }],
    safetyRejections: [{ reason: 'max_lateness_breach', count: 3 }],
  };
}

function buildReport(over: Partial<FleetTrialReport> = {}): FleetTrialReport {
  const raw = {
    generatedAt: '2026-09-06T09:00:00.000Z',
    durationMs: 2000,
    corridorPreset: { id: 'urban', title: '24 km city trunk', description: 'A city trunk corridor.' },
    alightingOnlySelectable: false,
    headlineScope: {
      includedScenarioIds: ['steady_variability'],
      excludedScenarios: [
        { id: 'oversaturated', title: 'More passengers than seats', deniedShare: 0.52 },
      ],
      fellBackToAllScenarios: false,
      note: 'Averaged over 1 of 2 scenarios.',
    },
    corridor: {
      routeDirectionId: 'RD-1',
      routeName: 'City trunk',
      totalDistanceMeters: 24_000,
      stationCount: 10,
      holdingPointCount: 10,
      targetHeadwaySeconds: 600,
      bunchedThresholdRatio: 0.25,
      warningThresholdRatio: 0.5,
      maxHoldSeconds: 120,
      kf: 0.4,
      kb: 0.4,
      selfEqualizingK: 0.4,
      stations: [
        { stopId: 'S1', name: 'One', sequence: 0, cumulativeDistanceMeters: 0, latitude: 1, longitude: 1 },
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
    provenance: [{ field: 'demand', value: 'invented', source: 'modelled', note: 'No ticketing feed exists.' }],
    notExercised: ['the command lifecycle'],
    ...over,
  };
  // Parsed, not cast. A fixture that has drifted out of the wire contract
  // would otherwise keep this suite green while the real page broke.
  return fleetTrialReportSchema.parse(raw);
}

describe('the headline on the console', () => {
  it('says which scenarios it averaged, and what the full set says instead', () => {
    render(<SimulatorConsole initialReport={buildReport()} />);

    const heading = screen.getByText(/average 1 of 2 scenarios/i);
    const notice = heading.closest('[role="status"], [role="alert"], div')!;
    const said = notice.textContent ?? '';
    // The excluded scenario is NAMED, with the measured share that excluded
    // it, so a reader can check the call rather than take it.
    expect(said).toMatch(/More passengers than seats/);
    expect(said).toMatch(/52% of people offered a seat were refused one/);
    // ...and the all-scenarios figure is stated beside the headline, never
    // dropped: the reader sees both numbers and which population each covers.
    expect(said).toMatch(/-1\.3%/);
    expect(said).toMatch(/\+2\.5%/);
  });

  it('does not go silent when nothing was excluded — silence would be ambiguous', () => {
    const clean = buildReport({
      headlineScope: {
        includedScenarioIds: ['steady_variability', 'oversaturated'],
        excludedScenarios: [],
        fellBackToAllScenarios: false,
        note: 'Averaged over all 2 scenarios.',
      },
    });
    render(<SimulatorConsole initialReport={clean} />);
    expect(screen.getAllByText(/averaged over all 2 scenarios/i).length).toBeGreaterThan(0);
  });

  it('warns rather than reporting a verdict when every scenario saturated', () => {
    const allSaturated = buildReport({
      headlineScope: {
        includedScenarioIds: ['oversaturated'],
        excludedScenarios: [],
        fellBackToAllScenarios: true,
        note: 'Every scenario in this trial ran past the saturation line.',
      },
    });
    render(<SimulatorConsole initialReport={allSaturated} />);
    expect(screen.getAllByText(/past the saturation line/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/not as a verdict on the controller/i)).toBeTruthy();
  });
});

describe('whose report the console is showing', () => {
  it('names a stored report as one that may not be the reader’s', () => {
    render(<SimulatorConsole initialReport={buildReport()} />);
    expect(screen.getByText(/a stored result — not necessarily yours/i)).toBeTruthy();
    expect(screen.getByText(/last trial this service ran/i)).toBeTruthy();
  });

  it('states when it ran, on what corridor, and at what fleet size', () => {
    // All three were absent. The page showed a report and said nothing about
    // where it came from, which is what let a 60-bus run pass for a 1,000-bus
    // one.
    render(<SimulatorConsole initialReport={buildReport()} />);
    expect(screen.getByText(/24 km city trunk · 60 buses per phase · run/i)).toBeTruthy();
    expect(screen.getByText('2026-09-06T09:00:00.000Z')).toBeTruthy();
  });

  it('sets its own controls to what the report on screen actually ran', () => {
    // The controls describe the NEXT run. Leaving them on a fixed default put
    // "1,000 buses" above a 60-bus report, and nothing said which was true.
    render(<SimulatorConsole initialReport={buildReport()} />);
    expect(screen.getByLabelText(/buses per phase/i)).toHaveValue('60');
    expect(screen.getByLabelText(/corridor/i)).toHaveValue('urban');
  });

  it('offers to run one rather than showing a foreign result, when the service has none', () => {
    render(<SimulatorConsole initialReport={null} />);
    expect(screen.getByText(/no trial has been run yet/i)).toBeTruthy();
  });
});
