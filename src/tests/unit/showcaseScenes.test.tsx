// @vitest-environment jsdom
//
// The /trial scenes, rendered from a real (if minimal) trial-data shape run
// through the real resolver. Each scene is asserted on the words an audience
// reads, and the whole set is asserted to carry no provenance labelling and
// none of the cockpit vocabulary the quiet theme replaced: this page presents
// results, and "PROJECTED" on a numeral is a different claim from the one the
// page makes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ControllerPipelineScene } from '@/components/showcase/ControllerPipelineScene';
import { HeroScene } from '@/components/showcase/HeroScene';
import { PassengerBalanceScene } from '@/components/showcase/PassengerBalanceScene';
import { ReportScene } from '@/components/showcase/ReportScene';
import { ScaleProjectionScene } from '@/components/showcase/ScaleProjectionScene';
import { ScenarioGalleryScene } from '@/components/showcase/ScenarioGalleryScene';
import { VerdictScene } from '@/components/showcase/VerdictScene';
import { showcaseFigures } from '@/lib/showcase/figures';
import { resolveShowcase } from '@/lib/showcase/resolve';
import { trialDataSchema } from '@/lib/showcase/trialData';

// Recharts measures its container and jsdom reports 0, so the chart draws
// nothing here; the gallery's own words are what these tests read.
vi.mock('@/components/showcase/Sparkline', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));

// ─── A minimal trial-data file ───────────────────────────────────────────

function contrast(overrides: Partial<Record<string, number | null>> = {}) {
  return {
    ewtImprovementPercent: 54,
    passengerSecondsSavedPercent: 3.8,
    passengerSecondsSaved: 1_000,
    incidentsAvoided: 3,
    waitSecondsSaved: 2_000,
    onboardDelayImposed: 500,
    inVehicleSecondsSaved: 100,
    bunchingRateImprovementPercent: 40,
    cvImprovementPercent: 11.1,
    addedJourneySecondsPerVehicle: 474,
    additionalDeniedBoardings: 0,
    ...overrides,
  };
}

function arm(overrides: Partial<Record<string, number | null>> = {}) {
  return {
    ewtSeconds: 120,
    meanHeadwaySeconds: 360,
    headwayCv: 0.4,
    bunchingRate: 0.1,
    incidentsDetected: 6,
    incidentsResolved: 2,
    onTimeRate: 0.7,
    meanHoldSecondsPerVehicle: 30,
    totalHoldSeconds: 600,
    totalPassengerSeconds: 100_000,
    waitPassengerSeconds: 20_000,
    boardings: 500,
    deniedBoardings: 0,
    deniedShare: 0,
    firstTimeDeniedBoardings: 0,
    meanJourneySeconds: 26_118,
    p95JourneySeconds: 27_000,
    meanScheduleDeviationSeconds: 40,
    p95ScheduleDeviationSeconds: 200,
    maxHoldSecondsOnAnyVehicle: 120,
    alightingOnlyActions: 0,
    alightingOnlyPassengersPassed: 0,
    ...overrides,
  };
}

function sweep(peak: number) {
  return [0, 600, 1_200, 1_800].map((atSeconds, index) => ({
    atSeconds,
    openIncidents: index === 2 ? peak : Math.floor(peak / 2),
    bunchedPairs: 1,
    liveVehicles: 20,
  }));
}

function trajectory(vehicleId: string) {
  return {
    vehicleId,
    points: [
      { t: 0, d: 0, hold: 0 },
      { t: 60, d: 500, hold: 0 },
      { t: 120, d: 1_000, hold: 20 },
    ],
  };
}

function scenario(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title,
    mechanism: `${title} mechanism`,
    whatItTests: `${title} test`,
    vehicleCount: 20,
    horizonSeconds: 1_800,
    saturated: false,
    contrast: contrast(),
    controlled: arm({ incidentsDetected: 3 }),
    uncontrolled: arm(),
    sweeps: { controlled: sweep(2), uncontrolled: sweep(5) },
    trajectories: null,
    ...overrides,
  };
}

const replayScenario = (title: string) =>
  scenario('steady_variability', title, {
    trajectories: {
      controlled: [trajectory('c-1'), trajectory('c-2')],
      uncontrolled: [trajectory('u-1'), trajectory('u-2')],
    },
  });

function phase(scenarios: ReturnType<typeof scenario>[]) {
  return {
    id: 'occupancy_blind',
    title: 'Occupancy-blind',
    vehicleCount: 60,
    contrast: contrast(),
    allScenariosContrast: contrast(),
    controlled: arm({ incidentsDetected: 9 }),
    uncontrolled: arm({ incidentsDetected: 18 }),
    lawCoverage: [
      { law: 'terminal_dispatch', decisionsGenerating: 120, decisionsTotal: 600 },
      { law: 'two_way', decisionsGenerating: 300, decisionsTotal: 600 },
      { law: 'self_equalizing', decisionsGenerating: 90, decisionsTotal: 600 },
      { law: 'boarding_limit', decisionsGenerating: 10, decisionsTotal: 600 },
    ],
    holdSecondsByStation: [
      { sequence: 1, name: 'Origin', holdSeconds: 900, holdCount: 12 },
      { sequence: 5, name: 'Fifth', holdSeconds: 300, holdCount: 4 },
    ],
    holdCountByActionType: [
      { actionType: 'two_way_hold', count: 14, holdSeconds: 900 },
      { actionType: 'terminal_dispatch_hold', count: 2, holdSeconds: 300 },
    ],
    scenarios,
  };
}

const urbanCorridor = {
  presetId: 'urban',
  title: 'City trunk',
  routeName: 'Urban corridor',
  totalDistanceMeters: 24_000,
  stationCount: 25,
  targetHeadwaySeconds: 360,
  bunchedThresholdRatio: 0.25,
  warningThresholdRatio: 0.5,
  maxHoldSeconds: 120,
  generatedAt: '2026-09-01T00:00:00.000Z',
  durationMs: 1_000,
  vehiclesSimulated: 60,
  headlineScope: {
    includedScenarioIds: ['steady_variability', 'slow_bus'],
    excludedScenarioIds: ['oversaturated'],
  },
  controllability: { disturbanceRatio: 0.1, legTimeSigmaSeconds: 30, band: 'controllable' },
  headlineNetPercent: 3.8,
  allScenariosNetPercent: 2,
  stations: [{ sequence: 1, name: 'Origin', cumulativeDistanceMeters: 0 }],
  phases: [
    phase([
      replayScenario('Steady variability'),
      scenario('slow_bus', 'Slow bus'),
      scenario('oversaturated', 'Oversaturated', {
        saturated: true,
        contrast: contrast({ passengerSecondsSavedPercent: -1.5, ewtImprovementPercent: 4 }),
      }),
    ]),
  ],
};

// A second corridor, so the gallery toggle has something to switch to and
// the report has two rows. Its one scenario carries a title of its own so a
// test can tell which corridor's cards are on screen.
const intercityCorridor = {
  ...urbanCorridor,
  presetId: 'intercity',
  title: 'Inter-city trunk',
  routeName: 'Inter-city corridor',
  totalDistanceMeters: 400_000,
  stationCount: 10,
  targetHeadwaySeconds: 1_800,
  maxHoldSeconds: 600,
  generatedAt: '2026-09-23T00:00:00.000Z',
  headlineScope: { includedScenarioIds: ['steady_variability'], excludedScenarioIds: [] },
  phases: [phase([replayScenario('Long-haul steady variability')])],
};

const minimalTrialData = trialDataSchema.parse({
  builtAt: '2026-09-01T00:00:00.000Z',
  headlinePhaseId: 'occupancy_blind',
  replayScenarioIds: ['steady_variability'],
  corridors: [urbanCorridor, intercityCorridor],
});

const model = resolveShowcase(showcaseFigures, minimalTrialData);

// ─── jsdom has no motion, no canvas, no layout ───────────────────────────

const originalGetContext = HTMLCanvasElement.prototype.getContext;

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  // framer-motion reads `addListener` off this, not only `addEventListener`.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })),
  );
  vi.stubGlobal('IntersectionObserver', NoopObserver);
  vi.stubGlobal('ResizeObserver', NoopObserver);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({}, { get: () => () => undefined })) as unknown as typeof originalGetContext;
});

afterEach(() => {
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

/**
 * The `<details>` a numbered report heading opens, clicked open if it is
 * closed so the body a test reads is the one a reader would see.
 */
function reportSection(title: RegExp): HTMLDetailsElement {
  const details = screen.getByRole('heading', { name: title }).closest('details');
  if (!details) throw new Error(`no section for ${title}`);
  if (!details.open) {
    const summary = details.querySelector(':scope > summary');
    if (!summary) throw new Error(`no summary for ${title}`);
    fireEvent.click(summary);
  }
  return details;
}

/** The numbered sections at the top level of the sheet, in order. */
function topLevelSections(container: HTMLElement): HTMLDetailsElement[] {
  const sheet = container.querySelector('article');
  if (!sheet) throw new Error('no sheet');
  return Array.from(sheet.children).filter((child): child is HTMLDetailsElement =>
    child.matches('details.sc-details'),
  );
}

/** The corridor blocks folded inside one section, in order. */
function corridorSections(section: HTMLElement): HTMLDetailsElement[] {
  return Array.from(section.querySelectorAll<HTMLDetailsElement>('details.sc-details-nested'));
}

// ─── The scenes ──────────────────────────────────────────────────────────

describe('HeroScene', () => {
  it('renders the eyebrow, the split title and the four stat labels', () => {
    render(<HeroScene model={model.hero} />);
    expect(screen.getByText(model.hero.eyebrow)).toBeInTheDocument();
    expect(screen.getByText('One controller.')).toBeInTheDocument();
    expect(model.hero.stats).toHaveLength(4);
    for (const stat of model.hero.stats) {
      expect(screen.getByText(stat.label)).toBeInTheDocument();
    }
  });
});

describe('VerdictScene', () => {
  it('renders the sentence, both numerals and the three corridors with their seed agreement', () => {
    render(<VerdictScene model={model.verdict} />);
    expect(screen.getByText(model.verdict.sentence)).toBeInTheDocument();
    expect(screen.getByText('Total passenger time saved')).toBeInTheDocument();
    expect(screen.getByText('Excess waiting removed')).toBeInTheDocument();

    const tiles = screen.getAllByRole('listitem');
    expect(tiles).toHaveLength(3);
    expect(screen.getByText('City trunk')).toBeInTheDocument();
    expect(screen.getByText('Suburban radial')).toBeInTheDocument();
    expect(screen.getByText('Inter-city trunk')).toBeInTheDocument();
    expect(within(tiles[0] as HTMLElement).getByText('6 of 6 seeds agree')).toBeInTheDocument();
    expect(screen.getByText('5 of 6 seeds agree')).toBeInTheDocument();
    expect(screen.getByText('High dispersion')).toBeInTheDocument();
  });
});

describe('ScenarioGalleryScene', () => {
  it('opens on the urban corridor with one card per scenario, the family chips and the outcome chips', () => {
    render(<ScenarioGalleryScene model={model.gallery} />);

    const corridors = screen.getByRole('group', { name: 'Choose a corridor' });
    expect(within(corridors).getAllByRole('button')).toHaveLength(2);
    expect(within(corridors).getByRole('button', { name: 'City trunk' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(corridors).getByRole('button', { name: 'Inter-city trunk' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('24 km · 25 stops · 6-minute headway')).toBeInTheDocument();

    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'All (3)' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Ways a corridor comes apart (2)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Attacks on the controller (1)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Attacks on the estimator (0)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Stress test')).toBeInTheDocument();
    expect(screen.getAllByText('Helped')).toHaveLength(2);
    expect(screen.getAllByTestId('sparkline')).toHaveLength(3);
    // Every fixture scenario detects 6 incidents left alone and 3 under control.
    expect(screen.getAllByText('incidents 6 → 3')).toHaveLength(3);
  });

  it('switches corridor, rendering the cards of that corridor and resetting the family filter', () => {
    render(<ScenarioGalleryScene model={model.gallery} />);
    const corridors = screen.getByRole('group', { name: 'Choose a corridor' });

    fireEvent.click(screen.getByRole('button', { name: 'Attacks on the controller (1)' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Oversaturated')).toBeInTheDocument();

    fireEvent.click(within(corridors).getByRole('button', { name: 'Inter-city trunk' }));
    expect(within(corridors).getByRole('button', { name: 'Inter-city trunk' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('300 km · 10 stations · 30-minute headway')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Long-haul steady variability')).toBeInTheDocument();
    expect(screen.queryByText('Slow bus')).not.toBeInTheDocument();
    expect(screen.queryByText('Oversaturated')).not.toBeInTheDocument();
    // The filter came back to "All", and the counts are this corridor's own.
    expect(screen.getByRole('button', { name: 'All (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Ways a corridor comes apart (1)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.getByRole('button', { name: 'Attacks on the controller (0)' }),
    ).toBeInTheDocument();

    fireEvent.click(within(corridors).getByRole('button', { name: 'City trunk' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'All (3)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters the grid by family', () => {
    render(<ScenarioGalleryScene model={model.gallery} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attacks on the controller (1)' }));

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Oversaturated')).toBeInTheDocument();
    expect(screen.queryByText('Slow bus')).not.toBeInTheDocument();
    expect(screen.queryByText('Steady variability')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attacks on the controller (1)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All (3)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'All (3)' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('falls back to the lead cards when the model carries no corridors', () => {
    render(
      <ScenarioGalleryScene
        model={{ cards: model.gallery.cards, families: model.gallery.families, corridors: [] }}
      />,
    );
    expect(screen.queryByRole('group', { name: 'Choose a corridor' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
});

describe('ControllerPipelineScene', () => {
  it('renders the four stages, the four laws and the stations', () => {
    render(<ControllerPipelineScene model={model.pipeline} />);
    for (const stage of ['Detect', 'Decide', 'Deliver', 'Measure']) {
      expect(screen.getByText(stage)).toBeInTheDocument();
    }
    for (const law of [
      'Terminal dispatch',
      'Two-way holding',
      'Self-equalising',
      'Alighting-only',
    ]) {
      expect(screen.getByText(law)).toBeInTheDocument();
    }
    expect(screen.getByText('300 of 600 decisions · 14 holds')).toBeInTheDocument();
    // Station names come from the map corridor, keyed on the trial's sequence.
    expect(screen.getByText('Alambagh Bus Station')).toBeInTheDocument();
    expect(screen.getByText('15 min')).toBeInTheDocument();
  });
});