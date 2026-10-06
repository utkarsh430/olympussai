import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { FuelPage } from '@/components/depot/fuel/FuelPage';
import type { FuelResponse } from '@/lib/depot/fuel/api';
import * as fuelColumns from '@/lib/depot/fuel/fuelColumns';
import * as fuelHeader from '@/lib/depot/fuel/fuelHeader';
import * as fuelPageModel from '@/lib/depot/fuel/fuelPageModel';
import * as fuelPageTables from '@/lib/depot/fuel/fuelPageTables';
import * as fuelStandOut from '@/lib/depot/fuel/fuelStandOut';
import * as modelledDayLine from '@/lib/depot/modelledDayLine';

/*
 * Guard review X9: the fuel page states a variance, never a cause and never a person.
 * (1) Every export of every fuel module that builds text is called with every probe, so a
 * new export is covered without being listed (and fails if no probe reaches it). (2) The
 * source of every fuel module, component and the page file is scanned. (3) The rendered
 * page is checked including `title` and `aria-label`.
 */

const PEOPLE_AND_BLAME =
  /theft|thieve|pilfer|misuse|\bsteal|\bstole|siphon|\bleak|tamper|driver|driving|conductor|\bcrew|\boperators?\b|\bfault|\bblam|negligen|\babus|fraud|simulated/i;

/*
 * Guard review R2-I4: a stated mechanical or operating cause is as forbidden as a person.
 * "Load factor" is the revenue page's measure and lives outside these modules; on the fuel
 * page "load" can only be a cause.
 */
const MECHANICAL_AND_OPERATING_CAUSES =
  /engine|\btyres?\b|\btires?\b|\bweigh|equipment|traffic|\bload(s|ed)?\b|overload|payload|\bladen|\broads?\b|gradient|\bhill|\bslope|incline|weather|monsoon|\bage\b|\baged\b|ageing|\baging|maintenance|\brepair|\bworn\b|\bwear|idling|\bidle|air.?condition/i;

const BANNED = new RegExp(`${PEOPLE_AND_BLAME.source}|${MECHANICAL_AND_OPERATING_CAUSES.source}`, 'i');

/** Every word R2-I4 names, in a form the guard must catch. */
const PLANTED_CAUSES = [
  'engine',
  'tyre',
  'tire',
  'weight',
  'equipment',
  'traffic',
  'load',
  'road',
  'gradient',
  'weather',
  'age',
  'maintenance',
  'idling',
  'air conditioning',
] as const;

const hooks = vi.hoisted(() => ({ fuel: {} as unknown }));
vi.mock('@/hooks/useDepotFuel', () => ({ useDepotFuel: (): unknown => hooks.fuel }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: () => ({ depotId: '1', data: { outshed: { coverage: { n: 5, of: 9 } } } }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({ data: null, error: null }),
}));

const totals = (km: number) => ({
  busCount: 3,
  distanceKm: km,
  fuelLitres: 40,
  cost: 3600,
  kmPerLitre: km > 0 ? 4.2 : null,
  costPerKm: km > 0 ? 18.2 : null,
});
const group = (key: string | null, km: number) => ({ key, ...totals(km) });
const day = (duties: number) => ({ duties, routes: 2, busesRan: 3, buses: 9, dutiesWithoutBus: 2 });
const bus = (route: string | null) => ({
  registrationNumber: 'UP32-1',
  routeName: route,
  serviceClass: 'ordinary',
  kmPerLitre: 3.7,
  peerMedianKmPerLitre: 4.4,
  variancePct: 18.84,
  comparison: route ? 'route' : 'depot',
  statement: 'x',
});

function response(defaulted: boolean, capped: boolean): FuelResponse {
  return {
    depot: { id: '1', name: 'A' },
    operatingDate: '2026-10-06',
    pricePerLitre: 92,
    priceDefaulted: defaulted,
    day: day(4),
    notRunCount: 6,
    totals: totals(300),
    perClass: [group('ordinary', 100), group('ac', 0)],
    perRoute: [group('R1', 100), group(null, 0)],
    routeTotal: capped ? 9 : 2,
    otherRoutes: capped ? { routeCount: 7, totals: totals(50) } : null,
    flagged: [bus('R1'), bus(null)],
    flaggedTotal: capped ? 5 : 2,
    noDistanceCount: 1,
    noComparisonCount: 2,
    peersDifferCount: 1,
    rule: { thresholdPct: 15, minPeers: 2 },
    feedNow: '2026-10-06T08:00:00',
    stale: false,
  } as unknown as FuelResponse;
}

const ROWS = [group('ordinary', 100), group('express', 0), group(null, 50)];
const PROBES: readonly unknown[][] = [
  [],
  [0],
  [1],
  [4],
  [15.04, 15],
  [3.7],
  [null],
  ['ordinary'],
  [null, 'R1'],
  ['R1'],
  [1, 15],
  [4, 15],
  [0, 0, { peersDiffer: 1, noComparison: 2, thresholdPct: 15 }],
  [0, 0],
  [5, 3],
  [1, 1],
  [day(0)],
  [day(4)],
  [ROWS],
  [ROWS, { routeCount: 3, totals: totals(10) }],
  [ROWS, fuelPageModel.groupLabel],
  ...(['distance', 'litres', 'cost', 'kmpl', 'cpk'] as const).flatMap((f) => [
    [group('R1', 100), f],
    [group('R1', 0), f],
  ]),
  [totals(300), { price: 92, defaulted: true }, day(4)],
  [totals(300), { price: 92, defaulted: false }],
  [response(true, true)],
  [response(false, false)],
  ['Built on the modelled day.'],
  [{ operatingDate: '2026-10-06', duties: 4, routes: 2, scheduled: { n: 5, of: 9 } }],
  [{ operatingDate: '2026-10-06', duties: 4, routes: 2, scheduled: null }],
  ['narrow', true],
  ['medium', false],
  [bus('R1')],
  [bus(null), 'narrow'],
  [bus('R1'), 'medium'],
];

/** Exports that return no text (a number, a flag or a group of numbers). */
const NO_TEXT: ReadonlySet<string> = new Set([
  'classFloor',
  'showRouteColumn',
  'STAND_OUT_WIDTHS',
  'ROUTE_WIDTHS',
]);

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

const MODULES: Record<string, Record<string, unknown>> = {
  fuelColumns,
  fuelHeader,
  fuelPageModel,
  fuelPageTables,
  fuelStandOut,
  modelledDayLine,
};

function produced(value: unknown): string[][] {
  if (typeof value !== 'function') return [stringsOf(value)];
  return PROBES.map((args) => {
    try {
      return stringsOf((value as (...a: unknown[]) => unknown)(...args));
    } catch {
      return [];
    }
  });
}

function checkModule(name: string, mod: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(mod)) {
    const all = produced(value).flat();
    if (!NO_TEXT.has(key)) {
      expect(all.length, `${name}.${key} is reached by no probe; add one`).toBeGreaterThan(0);
    }
    for (const text of all) expect(text, `${name}.${key}`).not.toMatch(BANNED);
  }
}

/** Comments may state the rule itself ("never a cause, never a person"): scan code only. */
function checkSource(source: string): void {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  expect(code).not.toMatch(BANNED);
}

/** The rendered text plus every `title` and `aria-label`. */
function checkRendered(host: HTMLElement): void {
  const attrs = [...host.querySelectorAll('[title], [aria-label]')].flatMap((el) => [
    el.getAttribute('title') ?? '',
    el.getAttribute('aria-label') ?? '',
  ]);
  for (const text of [host.textContent ?? '', ...attrs]) expect(text).not.toMatch(BANNED);
}

describe('every string a fuel module can produce names no cause and no person', () => {
  it.each(Object.entries(MODULES))('%s', (name, mod) => checkModule(name, mod));
});

describe('the fuel sources name no cause and no person', () => {
  const root = process.cwd();
  const dirs = ['src/lib/depot/fuel', 'src/components/depot/fuel'];
  const files = [
    ...dirs.flatMap((d) => readdirSync(join(root, d)).map((f) => join(d, f))),
    'src/app/(protected)/project/depots/d/[depotId]/fuel/page.tsx',
  ];
  it.each(files)('%s', (file) => checkSource(readFileSync(join(root, file), 'utf8')));
});

describe('the rendered fuel page, with its titles and labels', () => {
  it.each([
    ['data', { data: response(true, true), error: null, loading: false, refresh: vi.fn() }],
    ['stale', { data: response(false, false), error: 'x', loading: false, refresh: vi.fn() }],
    ['loading', { data: null, error: null, loading: true, refresh: vi.fn() }],
    ['error', { data: null, error: 'Upstream unavailable', loading: false, refresh: vi.fn() }],
  ])('%s', async (_state, value) => {
    hooks.fuel = value;
    const host = document.createElement('div');
    const root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(<FuelPage provenance={{ default: 'modelled' }} />));
    checkRendered(host);
    await act(async () => root.unmount());
  });
});

describe('the rendered fuel page states the shortfall and prints no raw date', () => {
  it('in the band caption (R2-m8), and with no YYYY-MM-DD in text, titles or labels', async () => {
    hooks.fuel = { data: response(true, true), error: null, loading: false, refresh: vi.fn() };
    const host = document.createElement('div');
    const root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(<FuelPage provenance={{ default: 'modelled' }} />));
    const band = host.querySelector('[data-testid="depot-figure-band"]');
    expect(band?.textContent).toContain('6 with no duty · 2 duties without a bus');
    expect(host.querySelector('[data-testid="depot-fuel-standout-foot"]')?.textContent).not.toContain(
      'without a bus',
    );
    const attrs = [...host.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].filter((a) => a.name !== 'href').map((a) => a.value),
    );
    for (const text of [host.textContent ?? '', ...attrs]) expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    await act(async () => root.unmount());
  });
});

describe('the guard fails on every stated cause, wherever it is planted', () => {
  it.each(PLANTED_CAUSES)('"%s" in a module string, the source, the text, a title and an aria-label', (word) => {
    const sentence = `UP32-1 uses more fuel, likely ${word}`;
    expect(() => checkModule('planted', { planted: () => sentence })).toThrow();
    expect(() => checkSource(`const s = '${sentence}';`)).toThrow();
    const text = document.createElement('div');
    text.textContent = sentence;
    expect(() => checkRendered(text)).toThrow();
    for (const attr of ['title', 'aria-label']) {
      const host = document.createElement('div');
      const cell = document.createElement('span');
      cell.textContent = '18.8%';
      cell.setAttribute(attr, sentence);
      host.append(cell);
      expect(() => checkRendered(host), attr).toThrow();
    }
  });

  it('catches the word forms', () => {
    for (const form of ['tyres', 'tires', 'loaded', 'roads', 'aged', 'air-conditioned', 'idle', 'weighs'])
      expect(form).toMatch(BANNED);
  });
});
