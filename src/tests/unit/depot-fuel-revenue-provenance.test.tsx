import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DepotFuelPage from '@/app/(protected)/project/depots/d/[depotId]/fuel/page';
import DepotRevenuePage from '@/app/(protected)/project/depots/d/[depotId]/revenue/page';
import { modelledDayLine } from '@/lib/depot/modelledDayLine';
import { REVENUE_MODEL_PARAMS } from '@/lib/depot/sim/revenueConfig';

/*
 * Each page's provenance line (tone, sentence and the dated
 * modelled-day extension) is pinned by rendering the page file itself in every state, so
 * changing or dropping the page default fails here. A page built on the modelled day
 * prints the date the day is for, on screen.
 */

const hooks = vi.hoisted(() => ({ fuel: {} as unknown, revenue: {} as unknown }));

vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: () => ({
    depotId: '1',
    data: { outshed: { coverage: { n: 5, of: 200 } } },
  }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({
    data: { feedNow: '2026-10-06T08:51:00', stale: false, source: 'live', depots: [] },
    error: null,
  }),
}));
vi.mock('@/hooks/useDepotFuel', () => ({ useDepotFuel: (): unknown => hooks.fuel }));
vi.mock('@/hooks/useDepotRevenue', () => ({ useDepotRevenue: (): unknown => hooks.revenue }));

const DAY = { duties: 163, routes: 4, busesRan: 138, buses: 200, dutiesWithoutBus: 0 };
const EMPTY_DAY = { duties: 0, routes: 0, busesRan: 0, buses: 200, dutiesWithoutBus: 0 };
const TOTALS = {
  busCount: 0,
  distanceKm: 0,
  fuelLitres: 0,
  cost: 0,
  kmPerLitre: null,
  costPerKm: null,
};

function fuel(day: typeof DAY, distanceKm: number): unknown {
  return {
    depot: { id: '1', name: 'Kaushambi' },
    operatingDate: '2026-10-06',
    pricePerLitre: 92,
    priceDefaulted: true,
    day,
    notRunCount: 200 - day.busesRan,
    totals: { ...TOTALS, busCount: day.busesRan, distanceKm },
    perClass: [],
    perRoute: [],
    routeTotal: 0,
    otherRoutes: null,
    flagged: [],
    flaggedTotal: 0,
    noDistanceCount: 0,
    noComparisonCount: 0,
    peersDifferCount: 0,
    rule: { thresholdPct: 15, minPeers: 2 },
    feedNow: '2026-10-06T08:51:00',
    stale: false,
  };
}

function revenue(day: typeof DAY): unknown {
  return {
    feedNow: '2026-10-06T08:51:00',
    stale: false,
    operatingDate: '2026-10-06',
    day,
    summary: {
      routes: 0,
      trips: 0,
      boardings: 0,
      revenue: 0,
      loadFactor: null,
      serviceKm: 0,
      modelledLengthRevenueShare: 1,
      earningsPerKm: null,
      lengthCoverage: { n: 0, of: 0 },
      provenance: 'modelled',
    },
    routes: [],
    notes: [],
    model: { params: REVENUE_MODEL_PARAMS },
  };
}

const loading = { data: null, error: null, loading: true, refresh: vi.fn() };
const failed = { data: null, error: 'Upstream unavailable', loading: false, refresh: vi.fn() };
const ok = (data: unknown): unknown => ({ data, error: null, loading: false, refresh: vi.fn() });

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

type PageFn = (props: { params: Promise<{ depotId: string }> }) => Promise<React.ReactElement>;

async function renderPage(page: PageFn): Promise<HTMLElement> {
  const element = await page({ params: Promise.resolve({ depotId: '1' }) });
  await act(async () => root.render(element));
  const lines = host.querySelectorAll('[data-testid="depot-provenance-line"]');
  expect(lines).toHaveLength(1);
  return lines[0] as HTMLElement;
}

const DATED = modelledDayLine({
  operatingDate: '2026-10-06',
  duties: 163,
  routes: 4,
  scheduled: { n: 5, of: 200 },
});

describe('the shared modelled-day extension', () => {
  it('is dated, tense-neutral and names the feed schedule coverage', () => {
    expect(DATED).toBe(
      'Built on the modelled day for 6 Oct 2026: 163 duties on 4 routes; the feed schedules 5 of 200 buses.',
    );
    expect(DATED).not.toMatch(/today|\bran\b|did not run/i);
    expect(
      modelledDayLine({ operatingDate: '2026-10-06', duties: 1, routes: 1, scheduled: null }),
    ).toBe('Built on the modelled day for 6 Oct 2026.');
  });
});

const PAGES = [
  {
    name: 'fuel',
    page: DepotFuelPage as PageFn,
    set: (v: unknown) => (hooks.fuel = v),
    data: () => fuel(DAY, 25588),
    empty: () => fuel(EMPTY_DAY, 0),
    replacedBy: 'Replaced when the fuel issue and odometer feed is connected.',
  },
  {
    name: 'revenue',
    page: DepotRevenuePage as PageFn,
    set: (v: unknown) => (hooks.revenue = v),
    data: () => revenue(DAY),
    empty: () => revenue(EMPTY_DAY),
    replacedBy: 'Replaced when the ticketing and route master feed is connected.',
  },
];

describe.each(PAGES)('the $name page provenance line', ({ page, set, data, empty, replacedBy }) => {
  const MODELLED = 'Generated from planning assumptions, not measured.';

  it.each([
    ['loading', () => loading],
    ['error', () => failed],
  ])('is MODELLED while %s, with no extension yet', async (_state, value) => {
    set(value());
    const line = await renderPage(page);
    expect(line.getAttribute('data-tone')).toBe('modelled');
    expect(line.textContent).toContain('MODELLED');
    expect(line.textContent).toContain(MODELLED);
    expect(line.textContent).toContain(replacedBy);
    expect(line.querySelector('[data-testid="depot-provenance-context"]')).toBeNull();
  });

  it('is MODELLED with the dated modelled day when there is data', async () => {
    set(ok(data()));
    const line = await renderPage(page);
    expect(line.getAttribute('data-tone')).toBe('modelled');
    expect(line.textContent).toContain(MODELLED);
    expect(line.querySelector('[data-testid="depot-provenance-context"]')?.textContent).toBe(DATED);
    // Nothing floats between the header and the hero: the sentence is only in the line.
    expect(host.textContent?.split('Built on the modelled day')).toHaveLength(2);
    expect(host.textContent).not.toMatch(/\btoday\b|\bran\b|did not run/i);
  });

  it('is MODELLED and dated (in the line or the panel) when the modelled day is empty', async () => {
    set(ok(empty()));
    const line = await renderPage(page);
    expect(line.getAttribute('data-tone')).toBe('modelled');
    expect(host.textContent).toContain('6 Oct 2026');
  });
});

describe('the empty modelled day on fuel', () => {
  it('replaces the band of zeros with the state panel', async () => {
    hooks.fuel = ok(fuel(EMPTY_DAY, 0));
    await renderPage(DepotFuelPage as PageFn);
    expect(host.querySelector('[data-testid="depot-figure-band"]')).toBeNull();
    expect(host.querySelector('[data-state="empty"]')).not.toBeNull();
  });

  it('prints no zeros in the provenance line; the panel names the day and links to the fuel feed', async () => {
    hooks.fuel = ok(fuel(EMPTY_DAY, 0));
    const line = await renderPage(DepotFuelPage as PageFn);
    expect(line.textContent).not.toMatch(/\b0 duties|\b0 routes|Built on the modelled day/);
    const panel = host.querySelector('[data-state="empty"]');
    expect(panel?.textContent).toContain('6 Oct 2026');
    const link = panel?.querySelector('a[href="/project/depots/sources#feed-fuel"]');
    expect(link?.textContent).toBe('Data sources');
  });
});
