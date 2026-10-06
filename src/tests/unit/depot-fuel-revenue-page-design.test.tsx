import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FuelPage } from '@/components/depot/fuel/FuelPage';
import { RevenuePage } from '@/components/depot/revenue/RevenuePage';
import { useDepotFuel } from '@/hooks/useDepotFuel';
import { useDepotRevenue } from '@/hooks/useDepotRevenue';
import type { FuelFlaggedBus, FuelResponse } from '@/lib/depot/fuel/api';
import {
  classFloor,
  classNote,
  classTableRows,
  fuelBand,
  fuelDisclosure,
  ranCaption,
} from '@/lib/depot/fuel/fuelPageTables';
import {
  BASIS_LABEL,
  formatVariance,
  routeDash,
  showRouteColumn,
  standOutFooter,
  standOutNote,
} from '@/lib/depot/fuel/fuelStandOut';
import { groupLabel } from '@/lib/depot/fuel/fuelPageModel';
import type { FuelGroupRow } from '@/lib/depot/fuel/types';
import type { RevenueResponse } from '@/lib/depot/revenue/api';

// The pages now render their own header (round 2), whose provenance line reads the feed.
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({ data: null, error: null }),
}));
vi.mock('@/hooks/useDepotFuel', () => ({ useDepotFuel: vi.fn() }));
vi.mock('@/hooks/useDepotRevenue', () => ({ useDepotRevenue: vi.fn() }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: () => ({ depotId: '1', data: null }),
}));

const BANNED =
  /theft|pilfer|misuse|driver|conductor|driving|engine|tyre|\bload\b|traffic|simulated/i;

const group = (key: string | null, kmPerLitre: number | null, distanceKm = 100): FuelGroupRow =>
  ({
    key,
    busCount: 5,
    distanceKm,
    fuelLitres: 20,
    cost: 1800,
    kmPerLitre,
    costPerKm: kmPerLitre === null ? null : 18,
  }) as FuelGroupRow;

const bus = (
  n: number,
  routeName: string | null,
  comparison: 'route' | 'depot',
): FuelFlaggedBus => ({
  registrationNumber: `UP32-${n}`,
  routeName,
  serviceClass: 'express',
  kmPerLitre: 3.7,
  peerMedianKmPerLitre: 4.4,
  variancePct: 18.84,
  comparison,
  statement: 'a sentence that must not appear in a cell',
});

function fuelData(over: Partial<FuelResponse> = {}): FuelResponse {
  const totals = {
    busCount: 158,
    distanceKm: 26854.6,
    fuelLitres: 6000,
    cost: 540000,
    kmPerLitre: 4.5,
    costPerKm: 20.1,
  };
  return {
    depot: { id: '1', name: 'Alambagh' },
    provenance: 'modelled',
    operatingDate: '2026-10-06',
    pricePerLitre: 90,
    priceDefaulted: true,
    day: { duties: 160, routes: 20, busesRan: 158, buses: 200, dutiesWithoutBus: 2 },
    notRunCount: 42,
    totals,
    perClass: [
      group('ordinary', 3.7),
      group('express', 4.8),
      group('ac', 4.2),
      group('premium', null, 0),
    ],
    perRoute: [group('R1', 4.4)],
    routeTotal: 1,
    otherRoutes: null,
    flagged: [bus(1, null, 'depot'), bus(2, null, 'depot'), bus(3, 'R7', 'route')],
    flaggedTotal: 3,
    noDistanceCount: 0,
    noComparisonCount: 4,
    peersDifferCount: 2,
    rule: { thresholdPct: 15, minPeers: 2 },
    feedNow: '2026-10-06T08:00:00Z',
    stale: false,
    ...over,
  } as unknown as FuelResponse;
}

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let host: HTMLElement;
let root: Root;

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
  });
}

function sectionTags(): (string | null)[][] {
  return [...host.querySelectorAll('[data-testid="depot-section-label"]')].map((label) => [
    (label.querySelector('h2, h3, h4')?.textContent ?? '').replace(/ · .*$/, '').trim(),
    label.querySelector('[data-provenance]')?.getAttribute('data-provenance') ?? null,
  ]);
}

function withoutDisclosure(): string {
  const clone = host.cloneNode(true) as HTMLElement;
  clone.querySelector('[data-testid="depot-how-produced"]')?.remove();
  // The header's provenance line is the page default, pinned in depot-fuel-revenue-provenance.
  clone.querySelector('[data-testid="depot-page-header"]')?.remove();
  return clone.textContent ?? '';
}

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

describe('fuel page models', () => {
  // Round 2: tense-neutral for the modelled day (rereview F1 m1); "Cost" names fuel cost.
  it('shows N of M buses running duties first, with the no-duty count as a caption', () => {
    const band = fuelBand(fuelData());
    expect(band).toHaveLength(5);
    expect(band[0]).toMatchObject({
      label: 'Buses running duties',
      value: '158 of 200',
      caption: '42 no duty · 2 duties unmatched',
    });
    expect(band[3]?.label).toBe('Fuel cost');
    expect(fuelBand(fuelData({ notRunCount: 0 }))[0]?.caption).toBe(
      '2 duties unmatched',
    );
    expect(ranCaption(42, 0)).toBe('42 no duty');
    expect(ranCaption(0, 1)).toBe('1 duty unmatched');
    expect(ranCaption(0, 0)).toBe('every bus has a duty');
    // One band figure is about 199 px at 1440 (about 36 characters): the caption fits it.
    expect(ranCaption(113, 75).length).toBeLessThanOrEqual(36);
    for (const f of band) expect(`${f.label} ${f.caption}`).not.toMatch(/\bran\b|did not|today/i);
    expect(band[3]?.caption).toBe('₹20.10 per km');
    expect(band[4]?.caption).toContain('planning price');
  });

  it('writes a signed numeric variance, a short basis and the peers median', () => {
    expect(formatVariance(18.84, 15)).toBe('+18.8%');
    expect(formatVariance(-3, 15)).toBe('-3.0%');
    expect(BASIS_LABEL).toEqual({ route: 'route peers', depot: 'class in depot' });
  });

  it('puts the rule once in a one-line note and the unlisted counts in one line under the table', () => {
    // X3: the note names the measure and its direction (it read "above the peers' median").
    expect(standOutNote(15)).toBe(
      'Uses more than 15% more fuel per kilometre than the median of its peers',
    );
    const line = standOutFooter(fuelData());
    expect(line).toContain('2 buses are above the 15% threshold');
    expect(line).toContain('4 buses have too few similar buses to compare');
    expect(line).not.toMatch(/without a bus|have no bus/);
    expect(
      standOutFooter(
        fuelData({
          peersDifferCount: 0,
          noComparisonCount: 0,
          day: {
            duties: 1,
            routes: 1,
            busesRan: 1,
            buses: 1,
            dutiesWithoutBus: 0,
          } as FuelResponse['day'],
        }),
      ),
    ).toBeNull();
  });

  it('shows a dash for no route and drops the route column when most rows have none', () => {
    expect(routeDash(null)).toBe('—');
    expect(routeDash('R7')).toBe('R7');
    const [a, b, c] = fuelData().flagged;
    expect(showRouteColumn([a, b, c] as FuelFlaggedBus[])).toBe(false);
    expect(showRouteColumn([a, c, c] as FuelFlaggedBus[])).toBe(true);
    expect(showRouteColumn([])).toBe(false);
  });

  it('scales class bars from a floor so differences read, with a no-distance class at zero', () => {
    const rows = fuelData().perClass;
    expect(classFloor(rows)).toBe(1.8);
    const shaped = classTableRows(rows, groupLabel);
    expect(shaped.map((r) => r.widthPct)).toEqual([63, 100, 80, 0]);
    expect(shaped[3]?.valueText).toBe('—');
    expect(classNote(rows)).toBe('Bars start at 1.8 km per litre, not zero');
  });

  it('says in the disclosure that a route distance may rest on a modelled length, and that the table does not mark which', () => {
    expect(fuelDisclosure(fuelData())).toContain(
      "A route's distance rests on its one-way length: the real length where the route's stop profile has been looked up, otherwise a modelled length typical of its service class. The route table does not mark which routes use a modelled length.",
    );
  });

  it('keeps the old closing statement and the price in the disclosure, and names no cause or person anywhere', () => {
    const data = fuelData();
    const disclosure = fuelDisclosure(data).join(' ');
    expect(disclosure).toContain('Every figure on this page is MODELLED');
    expect(disclosure).toContain('fuel issue records');
    expect(disclosure).toContain('odometer readings');
    expect(disclosure).toContain('planning price of ₹90 per litre, not a quoted price');
    const strings = [
      disclosure,
      standOutNote(15),
      standOutFooter(data) ?? '',
      classNote(data.perClass),
      ...fuelBand(data).flatMap((f) => [f.label, f.value, f.caption]),
      ...classTableRows(data.perClass, groupLabel).flatMap((r) => [
        r.label,
        r.valueText,
        r.distanceText,
      ]),
      ...Object.values(BASIS_LABEL),
    ];
    for (const text of strings) expect(text).not.toMatch(BANNED);
  });
});

describe('FuelPage', () => {
  it('has the band first, the stand-out table, no sentence in a cell and no tag outside the disclosure', async () => {
    vi.mocked(useDepotFuel).mockReturnValue({
      data: fuelData(),
      error: null,
      loading: false,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useDepotFuel>);
    await render(<FuelPage provenance={{ default: 'modelled' }} />);
    expect(host.querySelector('[data-testid="depot-figure-band"]')?.textContent).toContain(
      '158 of 200',
    );
    const tables = [...host.querySelectorAll('table')];
    const standOut = tables[0];
    const headers = [...(standOut?.querySelectorAll('thead th') ?? [])].map((th) =>
      th.textContent?.trim(),
    );
    // X3: consumption in the direction of the variance (was km per litre beside "+18.8%").
    expect(headers).toEqual([
      'Registration',
      'Class',
      'L / 100 km',
      "Peers' median L / 100 km",
      'Variance',
      'Basis',
    ]);
    const first = [...(standOut?.querySelectorAll('tbody tr:first-child td') ?? [])].map(
      (td) => td.textContent,
    );
    expect(first).toContain('+18.8%');
    // X3: a bus at 3.7 km per litre against peers at 4.4 reads as MORE fuel, in one direction.
    expect(first).toEqual(expect.arrayContaining(['27.0', '22.7']));
    expect(host.textContent).toContain(
      'Uses more than 15% more fuel per kilometre than the median of its peers',
    );
    expect(standOut?.textContent).not.toMatch(/km per litre|above the peers/i);
    expect(first).toContain('class in depot');
    expect(standOut?.textContent).not.toContain('a sentence that must not appear');
    // Ruling S51 (round 2): the sections that put generated figures beside real
    // registrations and route names carry ONE tag on their label; nothing else does.
    expect(sectionTags()).toEqual([
      ['Buses that stand out', 'modelled'],
      ['By service class', null],
      ['By route', 'modelled'],
    ]);
    expect(host.querySelectorAll('[data-provenance]')).toHaveLength(2);
    expect(withoutDisclosure().match(/MODELLED/g)).toHaveLength(2);
    expect(withoutDisclosure()).not.toMatch(/\(modelled\)/);
    expect(
      host.querySelector('details[data-testid="depot-how-produced"]')?.hasAttribute('open'),
    ).toBe(false);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3 + 4 + 1);
    // Critique fuel #3: LITRES dropped from BY ROUTE so it fits at 800; units in headers.
    const routeHeaders = [...(tables[2]?.querySelectorAll('thead th') ?? [])].map((th) =>
      th.textContent?.trim(),
    );
    expect(routeHeaders).toEqual([
      'Route',
      'Buses',
      'Distance km',
      'Fuel cost ₹',
      'Km per litre',
      'Fuel cost ₹/km',
    ]);
    const routeCells = [...(tables[2]?.querySelectorAll('tbody tr:first-child td') ?? [])].map(
      (td) => td.textContent,
    );
    expect(routeCells.slice(2)).toEqual(['100', '1,800', '4.4', '18.00']);
    expect(host.textContent).not.toMatch(BANNED);
  });

  it('keeps the route column when most rows have a route, and a state panel when no bus ran', async () => {
    const withRoutes = fuelData({
      flagged: [bus(1, 'R1', 'route'), bus(2, 'R2', 'route')] as never,
    });
    vi.mocked(useDepotFuel).mockReturnValue({
      data: withRoutes,
      error: null,
      loading: false,
      refresh: vi.fn(),
    } as never);
    await render(<FuelPage provenance={{ default: 'modelled' }} />);
    expect(host.querySelector('table thead')?.textContent).toContain('Route');
    const none = fuelData({
      totals: {
        busCount: 0,
        distanceKm: 0,
        fuelLitres: 0,
        cost: 0,
        kmPerLitre: null,
        costPerKm: null,
      } as never,
    });
    vi.mocked(useDepotFuel).mockReturnValue({
      data: none,
      error: null,
      loading: false,
      refresh: vi.fn(),
    } as never);
    await render(<FuelPage provenance={{ default: 'modelled' }} />);
    expect(host.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(host.querySelector('table')).toBeNull();
  });
});

describe('RevenuePage', () => {
  it('is a band, one table with the coverage line, and a closed disclosure; no chart panel or tags', async () => {
    const route = (name: string, revenue: number, lengthProvenance: 'derived' | 'modelled') => ({
      routeName: name,
      serviceClass: 'ordinary',
      trips: 4,
      seatsPerTrip: 40,
      seatCapacity: 160,
      loadFactor: 0.5,
      boardings: 80,
      revenue,
      lengthKm: 80,
      provenance: 'modelled',
      serviceKm: 640,
      earningsPerKm: revenue / 640,
      earningsWithheld: null,
      lengthProvenance,
    });
    const data = {
      feedNow: '2026-10-06T08:00:00Z',
      stale: false,
      operatingDate: '2026-10-06',
      day: { duties: 8, routes: 2, busesRan: 8, buses: 10, dutiesWithoutBus: 0 },
      summary: {
        routes: 2,
        trips: 8,
        boardings: 160,
        revenue: 12345,
        loadFactor: 0.5,
        serviceKm: 1280,
        modelledLengthRevenueShare: 0.4,
        earningsPerKm: 9.64,
        lengthCoverage: { n: 1, of: 2 },
        provenance: 'modelled',
      },
      routes: [route('R1', 8000, 'derived'), route('R2', 4345, 'modelled')],
      notes: [],
      model: { params: (await import('@/lib/depot/sim/revenueConfig')).REVENUE_MODEL_PARAMS },
    } as unknown as RevenueResponse;
    vi.mocked(useDepotRevenue).mockReturnValue({
      data,
      error: null,
      loading: false,
      refresh: vi.fn(),
    } as never);
    await render(<RevenuePage provenance={{ default: 'modelled' }} />);
    expect(host.querySelector('[data-testid="depot-figure-band"]')?.textContent).toContain(
      '₹12,345',
    );
    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Modelled revenue by route"]')).toBeNull();
    // Round 2: the length coverage is the band caption, from the response (critique revenue).
    expect(host.querySelector('[data-testid="depot-figure-band"]')?.textContent).toContain(
      '1 of 2 route lengths from real profiles',
    );
    // Ruling S51: the by-route label carries MODELLED. M14: mixed lengths say where each
    // came from in a plain BASIS column ("Profile", "Model"), never a tag inside a cell.
    expect(sectionTags()).toEqual([['By route', 'modelled']]);
    expect(
      [...host.querySelectorAll('[data-provenance]')].map((t) => t.getAttribute('data-provenance')),
    ).toEqual(['modelled']);
    expect(host.querySelectorAll('tbody [data-provenance]')).toHaveLength(0);
    const headers = [...host.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
    expect(headers.some((h) => h.startsWith('Basis'))).toBe(true);
    expect(headers.some((h) => h.startsWith('Class'))).toBe(false);
    const basis = [...host.querySelectorAll('tbody tr')].map(
      (tr) => tr.lastElementChild?.textContent,
    );
    expect([...basis].sort()).toEqual(['Model', 'Profile']);
    // Every date through formatPlainDate: no YYYY-MM-DD in the text or any attribute.
    const values = [...host.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].filter((a) => a.name !== 'href').map((a) => a.value),
    );
    for (const text of [host.textContent ?? '', ...values]) {
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
    expect(host.textContent).not.toMatch(/Rows 1 to|Previous/);
    expect(withoutDisclosure().match(/MODELLED/g)).toHaveLength(1);
    expect(
      host.querySelector('details[data-testid="depot-how-produced"]')?.hasAttribute('open'),
    ).toBe(false);
    const rupee = host.querySelector('tbody tr td:nth-child(6)');
    expect(rupee?.className).toContain('depot-align-right');
  });
});
