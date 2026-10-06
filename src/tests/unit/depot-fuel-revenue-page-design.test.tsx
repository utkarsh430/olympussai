import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FuelPage } from '@/components/depot/fuel/FuelPage';
import { RevenuePage } from '@/components/depot/revenue/RevenuePage';
import { useDepotFuel } from '@/hooks/useDepotFuel';
import { useDepotRevenue } from '@/hooks/useDepotRevenue';
import type { FuelFlaggedBus, FuelResponse } from '@/lib/depot/fuel/api';
import {
  BASIS_LABEL,
  classFloor,
  classNote,
  classTableRows,
  formatVariance,
  fuelBand,
  fuelDisclosure,
  routeDash,
  showRouteColumn,
  standOutFooter,
  standOutNote,
} from '@/lib/depot/fuel/fuelPageTables';
import { groupLabel } from '@/lib/depot/fuel/fuelPageModel';
import type { FuelGroupRow } from '@/lib/depot/fuel/types';
import type { RevenueResponse } from '@/lib/depot/revenue/api';

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

function withoutDisclosure(): string {
  const clone = host.cloneNode(true) as HTMLElement;
  clone.querySelector('[data-testid="depot-how-produced"]')?.remove();
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
  it('shows N of M buses ran as the first band figure, with the not-run count as a caption', () => {
    const band = fuelBand(fuelData());
    expect(band).toHaveLength(5);
    expect(band[0]).toMatchObject({
      label: 'Buses ran',
      value: '158 of 200',
      caption: '42 did not run',
    });
    expect(band[3]?.caption).toBe('₹20.10 per km');
    expect(band[4]?.caption).toContain('planning price');
  });

  it('writes a signed numeric variance, a short basis and the peers median', () => {
    expect(formatVariance(18.84)).toBe('+18.8%');
    expect(formatVariance(-3)).toBe('-3.0%');
    expect(BASIS_LABEL).toEqual({ route: 'route peers', depot: 'class in depot' });
  });

  it('puts the rule once in a one-line note and the unlisted counts in one line under the table', () => {
    expect(standOutNote(15, 2)).toBe(
      "More than 15% above the peers' median, with at least 2 peers close to it",
    );
    const line = standOutFooter(fuelData());
    expect(line).toContain('2 buses are above the 15% threshold');
    expect(line).toContain('4 buses have too few similar buses to compare');
    expect(line).toContain('2 of the day’s duties had no bus');
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

  it('keeps the old closing statement and the price in the disclosure, and names no cause or person anywhere', () => {
    const data = fuelData();
    const disclosure = fuelDisclosure(data).join(' ');
    expect(disclosure).toContain('Every figure on this page is MODELLED');
    expect(disclosure).toContain('fuel issue records');
    expect(disclosure).toContain('odometer readings');
    expect(disclosure).toContain('planning price of ₹90 per litre, not a quoted price');
    const strings = [
      disclosure,
      standOutNote(15, 2),
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
    await render(<FuelPage />);
    expect(host.querySelector('[data-testid="depot-figure-band"]')?.textContent).toContain(
      '158 of 200',
    );
    const tables = [...host.querySelectorAll('table')];
    const standOut = tables[0];
    const headers = [...(standOut?.querySelectorAll('thead th') ?? [])].map((th) =>
      th.textContent?.trim(),
    );
    expect(headers).toEqual([
      'Registration',
      'Class',
      'Km per litre',
      "Peers' median",
      'Variance',
      'Basis',
    ]);
    const first = [...(standOut?.querySelectorAll('tbody tr:first-child td') ?? [])].map(
      (td) => td.textContent,
    );
    expect(first).toContain('+18.8%');
    expect(first).toContain('class in depot');
    expect(standOut?.textContent).not.toContain('a sentence that must not appear');
    expect(host.querySelector('[data-provenance]')).toBeNull();
    expect(withoutDisclosure()).not.toMatch(/MODELLED|\(modelled\)/);
    expect(
      host.querySelector('details[data-testid="depot-how-produced"]')?.hasAttribute('open'),
    ).toBe(false);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3 + 4 + 1);
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
    await render(<FuelPage />);
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
    await render(<FuelPage />);
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
    await render(<RevenuePage />);
    expect(host.querySelector('[data-testid="depot-figure-band"]')?.textContent).toContain(
      '₹12,345',
    );
    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Modelled revenue by route"]')).toBeNull();
    expect(host.textContent).toContain(
      'lengths: 1 of 2 routes from real route profiles, the rest modelled'.replace('l', 'L'),
    );
    expect(
      [...host.querySelectorAll('[data-provenance]')].map((t) => t.getAttribute('data-provenance')),
    ).toEqual(['derived']);
    expect(withoutDisclosure()).not.toMatch(/MODELLED|\(modelled\)/);
    expect(
      host.querySelector('details[data-testid="depot-how-produced"]')?.hasAttribute('open'),
    ).toBe(false);
    const rupee = host.querySelector('tbody tr td:nth-child(6)');
    expect(rupee?.className).toContain('depot-align-right');
  });
});
