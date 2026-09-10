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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

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

const spacing = (
  over: Partial<FleetTrialReport['phases'][number]['controlled']['spacing']> = {},
) => ({
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
    holdCountByActionType: [{ actionType: 'hold', count: 5, holdSeconds: 100 }],
    safetyRejections: [{ reason: 'max_lateness_breach', count: 3 }],
  };
}

function buildReport(over: Partial<FleetTrialReport> = {}): FleetTrialReport {
  const raw = {
    generatedAt: '2026-09-06T09:00:00.000Z',
    durationMs: 2000,
    corridorPreset: {
      id: 'urban',
      title: '24 km city trunk',
      description: 'A city trunk corridor.',
    },
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
        {
          stopId: 'S1',
          name: 'One',
          sequence: 0,
          cumulativeDistanceMeters: 0,
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
    ...over,
  };
  // Parsed, not cast. A fixture that has drifted out of the wire contract
  // would otherwise keep this suite green while the real page broke.
  return fleetTrialReportSchema.parse(raw);
}

// ─── THE PAGE HAS TO ANSWER BEFORE IT EXPLAINS ──────────────────────────
//
// The captain's report was that there is too much on this page to read. It
// rendered 1,055 separate blocks of visible text on a completed 1,000-bus
// trial, everything expanded at once, with the answer to "did the controller
// help" nowhere in particular. The fix is ORDER and DISCLOSURE, never deletion:
// the answer comes first, the reasoning is one click away, and every caveat
// that was on the page is still on the page.
describe('the answer, before the detail', () => {
  /** The same report, with the scenarios agreeing on the sign of the result. */
  function agreeingReport(over: Partial<FleetTrialReport> = {}) {
    const base = buildReport(over);
    return buildReport({
      ...over,
      phases: base.phases.map((p) => ({
        ...p,
        scenarioAgreement: { ...p.scenarioAgreement, positive: 2, count: 2 },
      })),
    });
  }

  it('leads with one unambiguous sentence about whether the controller helped', () => {
    render(<SimulatorConsole initialReport={agreeingReport()} />);
    expect(screen.getByText('The controller helped.')).toBeTruthy();
  });

  it('refuses to claim a direction the scenarios split evenly on', () => {
    // The stock fixture is 1 of 2 scenarios positive. A mean with the
    // scenarios either side of zero is not a small effect, it is no measured
    // effect - the same rule the policy sweeps are already read by.
    render(<SimulatorConsole initialReport={buildReport()} />);
    expect(screen.getByText('This trial did not measure an effect.')).toBeTruthy();
  });

  it('takes that sentence off passenger time even when excess wait disagrees', () => {
    // The measured trap this page exists to prevent: excess wait improves
    // while the whole journey gets worse, because the hold is paid for by
    // everyone already aboard.
    const costly = buildReport({
      phases: buildReport().phases.map((p) => ({
        ...p,
        contrast: {
          ...p.contrast,
          ewtImprovementPercent: 46,
          passengerSecondsSaved: -5_000,
          passengerSecondsSavedPercent: -12,
        },
        scenarioAgreement: { ...p.scenarioAgreement, positive: 0, count: 2 },
      })),
    });
    render(<SimulatorConsole initialReport={costly} />);
    expect(screen.getByText('The controller cost more than it saved.')).toBeTruthy();
    // And the excess-wait figure is still shown, not suppressed for disagreeing.
    expect(screen.getAllByText(/\+46\.0%/).length).toBeGreaterThan(0);
  });

  it('puts the scenario count ON the headline, not in a paragraph elsewhere', () => {
    render(<SimulatorConsole initialReport={agreeingReport()} />);
    const answer = screen.getByText('The controller helped.').closest('section')!;
    // The qualification a reader needs to size the number is inside the same
    // panel as the number, not a banner they have to correlate by hand.
    expect(answer.textContent).toMatch(/averaged over\s*1 of 2\s*scenarios/i);
    expect(answer.textContent).toMatch(/controllable band|disturbed|Barely disturbed/i);
    expect(answer.textContent).toMatch(/timetable/i);
    expect(answer.textContent).toMatch(/invented/i);
  });

  it('opens with the detail collapsed, so the answer is what arrives first', () => {
    const { container } = render(<SimulatorConsole initialReport={buildReport()} />);
    const sections = container.querySelectorAll('details');
    expect(sections.length).toBeGreaterThan(0);
    // Not one of them is open. A page that ships a disclosure defaulted open
    // has simply moved the wall of text behind a chevron.
    expect([...sections].filter((d) => (d as HTMLDetailsElement).open)).toHaveLength(0);
  });

  it('keeps every caveat reachable — nothing is deleted to make the page calm', () => {
    const { container } = render(<SimulatorConsole initialReport={buildReport()} />);
    const everything = container.textContent ?? '';
    // Each of these was a banner or a paragraph on the old page, and each was
    // written to stop a specific misreading that has already happened once.
    expect(everything).toMatch(/the CORRIDOR and the TRAFFIC are a model/i);
    expect(everything).toMatch(/hard safety filter/i);
    expect(everything).toMatch(/law coverage/i);
    expect(everything).toMatch(/A higher detected count under control is not a failure/i);
    expect(everything).toMatch(/rises if spacing was bought by stranding people/i);
    expect(everything).toMatch(/What this trial does not test|does not cover/i);
    expect(everything).toMatch(/the command lifecycle/i);
  });

  it('still shows the whole scenario library, including any the headline leaves out', () => {
    const { container } = render(<SimulatorConsole initialReport={buildReport()} />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/More passengers than seats/);
    expect(text).toMatch(/Steady variability/i);
  });
});

describe('the headline on the console', () => {
  it('says which scenarios it averaged, and what the full set says instead', () => {
    render(<SimulatorConsole initialReport={buildReport()} />);

    // The scope is a qualification ON the headline rather than a banner beside
    // it, so the count is split across elements — match on the rendered text of
    // the list item that carries it.
    const line = screen
      .getAllByRole('listitem')
      .find((item) => /averaged over\s*1 of 2\s*scenarios/i.test(item.textContent ?? ''))!;
    expect(line).toBeDefined();
    const said = line.textContent ?? '';
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

// ─────────────────────────────────────────────────────────────────────────
// WHAT THE PAGE SAYS WHILE A TRIAL RUNS, AND WHAT IT SAYS WHEN ONE DOES NOT
// ─────────────────────────────────────────────────────────────────────────
//
// A trial on the 400 km inter-city corridor at 1,000 buses takes about 30
// seconds, MEASURED. For all of that time this console changed the button's
// label and did nothing else - no stage, no count, no sign of life - which is
// long enough that a reasonable person concludes the page has hung and either
// clicks again or reloads and loses the run.
//
// The reducer's own tests (`fleetTrialRun.test.ts`) pin the transitions. These
// pin what an operator actually SEES, and in particular that the four ways a
// run can end read as four different things.

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** A fetch stub that answers the trial POST and the progress poll separately. */
function stubFetch(handlers: {
  trial?: () => Promise<Partial<Response>> | Partial<Response>;
  progress?: () => Promise<Partial<Response>> | Partial<Response>;
}) {
  const trialCalls: unknown[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/progress')) {
      return (await handlers.progress?.()) ?? { ok: true, json: async () => ({ running: false }) };
    }
    trialCalls.push(init);
    if (!handlers.trial) return { ok: true, json: async () => buildReport() };
    return await handlers.trial();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, trialCalls };
}

/** A POST that never settles, so the console stays in its running state. */
const neverSettles = () => new Promise<Partial<Response>>(() => {});

describe('the simulator console while a trial is running', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says it is running, and how long it has been running', async () => {
    stubFetch({ trial: neverSettles });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getByText(/running — \d+s so far/i)).toBeTruthy();
  });

  it('keeps the progress ABOVE the report, where the operator is already looking', async () => {
    // The brief that reordered this page moved almost everything down or
    // behind a disclosure. What became of the run the operator just started is
    // the one thing that may not move: a progress notice below a full report
    // reads as though the report were the answer to it.
    stubFetch({ trial: neverSettles });
    const { container } = render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    const status = screen.getByText(/running — \d+s so far/i);
    const answer = screen.getByText(/did not measure an effect|controller helped|cost more/i);
    expect(status.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And it is never behind a disclosure.
    expect(status.closest('details')).toBeNull();
    expect(container.querySelector('details')).not.toBeNull();
  });

  it('reports the stage and the run count the trial actually sent', async () => {
    stubFetch({
      trial: neverSettles,
      progress: () => ({
        ok: true,
        json: async () => ({
          running: true,
          runId: 'r1',
          done: 142,
          total: 437,
          stage: 'policy_study',
          label: 'How late a bus may be pushed - 12 min, seed 2',
          startedAtMs: Date.now(),
        }),
      }),
    });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getByText(/How late a bus may be pushed/)).toBeTruthy();
    // A COUNT and its denominator, never a percentage - see OpsCoverage.
    expect(screen.getByText(/142 of 437/)).toBeTruthy();
    expect(screen.queryByText(/32%/)).toBeNull();
  });

  it('does not claim a run count before the trial has finished a run', async () => {
    // "0 of 0" would be a denominator nobody measured.
    stubFetch({ trial: neverSettles });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getByText(/has not finished its first run yet/i)).toBeTruthy();
    expect(screen.queryByText(/ of 0/)).toBeNull();
  });

  it('keeps showing the previous report while the next run is in flight', async () => {
    // No flash of empty: the reader keeps what they had until there is
    // something to replace it with.
    stubFetch({ trial: neverSettles });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getByText(/24 km city trunk · 60 buses per phase · run/i)).toBeTruthy();
  });

  it('survives a progress poll that fails, because a failed poll is not a failed trial', async () => {
    stubFetch({
      trial: neverSettles,
      progress: () => Promise.reject(new Error('poll died')),
    });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getByText(/running —/i)).toBeTruthy();
    expect(screen.queryByText(/could not be reached/i)).toBeNull();
  });
});

describe('the simulator console and the double click', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts exactly one trial however many times Run is pressed', async () => {
    // The reported behaviour, at the surface it happens on.
    const { trialCalls } = stubFetch({ trial: neverSettles });
    render(<SimulatorConsole initialReport={buildReport()} />);
    const button = screen.getByRole('button', { name: /run again/i });
    fireEvent.click(button);
    await flush();
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();

    expect(trialCalls).toHaveLength(1);
  });

  it('disables the button while a run is in flight', async () => {
    stubFetch({ trial: neverSettles });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getByRole('button', { name: /running/i })).toBeDisabled();
  });
});

describe('the four ways a run ends without a report', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const failWith = (status: number, code: string, message: string) => () => ({
    ok: false,
    status,
    json: async () => ({ error: { code, message } }),
  });

  it('says the trial failed, and that the previous result is still the previous result', async () => {
    stubFetch({
      trial: failWith(500, 'TRIAL_FAILED', 'The trial did not finish: the corridor came apart'),
    });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getByText(/the corridor came apart/i)).toBeTruthy();
    expect(screen.getByText(/still the one that was there before/i)).toBeTruthy();
    // And the report itself is untouched.
    expect(screen.getByText(/24 km city trunk · 60 buses per phase · run/i)).toBeTruthy();
  });

  it('says the service could not be reached when it genuinely could not', async () => {
    // The captain hit this banner: the control service was restarting mid-run.
    // It is correctly loud, and it must keep being loud.
    stubFetch({
      trial: failWith(
        503,
        'CONTROL_SERVICE_UNAVAILABLE',
        'The simulator service is temporarily unreachable; no trial can be run right now.',
      ),
    });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getByText(/the simulator service could not be reached/i)).toBeTruthy();
  });

  it('does NOT say the service was unreachable when the console merely gave up waiting', async () => {
    // THE regression this pair exists for. A trial that outran its own budget
    // was reported as an unreachable service - a statement about a service
    // that was healthy, answering, and had finished the run - and it sent a
    // supervisor to look at the wrong machine.
    stubFetch({
      trial: failWith(
        504,
        'CONTROL_SERVICE_TIMEOUT',
        'The console stopped waiting for this trial.',
      ),
    });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    // The title names it as this console's own deadline, not the service's.
    expect(
      screen.getByText(/the console stopped waiting — the trial probably has not/i),
    ).toBeTruthy();
    expect(screen.queryByText(/could not be reached/i)).toBeNull();
  });

  it('says the console has STOPPED CALLING when the breaker is open, not that it could not reach', async () => {
    // The third message. "Unreachable" tells an operator to go and look at the
    // service; this one tells them the service has genuinely been failing and
    // that retrying is pointless until the cooldown elapses. They were the
    // same sentence.
    stubFetch({
      trial: failWith(
        503,
        'CONTROL_SERVICE_CIRCUIT_OPEN',
        'The console has stopped calling the simulator service after 3 failures in a row, and will keep refusing for about 24 more seconds.',
      ),
    });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getAllByText(/stopped calling the simulator service/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/failing repeatedly/i)).toBeTruthy();
    // And it does NOT claim this attempt failed to reach anything.
    expect(screen.queryByText(/the simulator service could not be reached/i)).toBeNull();
  });

  it('says a trial is already running, rather than reporting a failure', async () => {
    // Two tabs, or a reload mid-run. Nothing is wrong.
    stubFetch({
      trial: failWith(409, 'TRIAL_ALREADY_RUNNING', 'A trial is already running.'),
    });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getAllByText(/a trial is already running/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/nothing was started twice/i)).toBeTruthy();
  });

  it('ends a run whose service vanished, rather than spinning forever', async () => {
    // fetch itself rejects - the service went away mid-request.
    stubFetch({ trial: () => Promise.reject(new Error('socket hang up')) });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.getAllByText(/could not be reached/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /run again/i })).not.toBeDisabled();
  });
});

describe('the simulator console when a run finishes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces the progress with the result, with no empty state in between', async () => {
    stubFetch({
      trial: () => ({
        ok: true,
        json: async () => buildReport({ generatedAt: '2026-09-07T09:00:00.000Z' }),
      }),
    });
    render(<SimulatorConsole initialReport={buildReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /run again/i }));
    await flush();

    expect(screen.queryByText(/running —/i)).toBeNull();
    expect(screen.queryByText(/no trial has been run yet/i)).toBeNull();
    // And it is now the reader's OWN run, not a stored one.
    expect(screen.getByText(/your run/i)).toBeTruthy();
  });
});
