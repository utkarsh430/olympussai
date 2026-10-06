import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EconomicsPage } from '@/components/depot/economics/EconomicsPage';
import { RevenueHero } from '@/components/depot/revenue/RevenueHero';
import { RevenueRoutesTable } from '@/components/depot/revenue/RevenueRoutesTable';
import { ModelledStatement } from '@/components/depot/revenue/ModelledStatement';
import { RevenueSummary } from '@/components/depot/revenue/RevenueSummary';
import type { EconomicsResponse } from '@/lib/depot/revenue/api';
import type { RouteRevenueFigure } from '@/lib/depot/revenue/types';
import { ECONOMICS_WEIGHTS, MIXED_CLASS_NOTE, REVENUE_MODEL_PARAMS } from '@/lib/depot/sim/revenueConfig';
import { useDepotEconomics } from '@/hooks/useDepotEconomics';

vi.mock('@/hooks/useDepotEconomics', () => ({ useDepotEconomics: vi.fn() }));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;
let host: HTMLElement;
let root: Root;

const COMPONENTS = [
  { key: 'earningsPerKm', value: 30, peerMedian: 25, z: 0.8, contribution: 0.32 },
  { key: 'costPerKm', value: 20, peerMedian: 22, z: 0.3, contribution: 0.1 },
  { key: 'loadFactor', value: 0.6, peerMedian: 0.55, z: -0.4, contribution: -0.1 },
] as const;

const DATA = {
  feedNow: '2026-10-06T08:00:00Z',
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  provenance: 'modelled',
  operatingDate: '2026-10-06',
  weights: ECONOMICS_WEIGHTS,
  depots: [
    {
      depotId: '1',
      name: 'Alambagh',
      kind: 'depot',
      fleet: 40,
      lengthCoverage: { n: 2, of: 2 },
      score: {
        depotId: '1',
        peerGroup: 'all',
        ranked: true,
        reason: 'ok',
        missing: [],
        economicsIndex: 61.5,
        rank: 1,
        peerCount: 6,
        components: COMPONENTS.map((c) => ({
          ...c,
          coverage: c.key === 'earningsPerKm' ? { n: 2, of: 2 } : null,
          provenance: 'modelled',
        })),
        provenance: 'modelled',
      },
    },
  ],
} as unknown as EconomicsResponse;

function route(name: string, revenue: number): RouteRevenueFigure {
  return {
    routeName: name,
    serviceClass: 'ordinary',
    trips: 4,
    seatsPerTrip: 40,
    seatCapacity: 160,
    loadFactor: 0.5,
    boardings: 80,
    revenue,
    // No real profile: a MODELLED 60 km; 4 trips out and back run 4 * 60 * 2 = 480 km.
    lengthKm: 60,
    provenance: 'modelled',
    serviceKm: 480,
    earningsPerKm: Math.round((revenue / 480) * 100) / 100,
    earningsWithheld: null,
    lengthProvenance: 'modelled',
  };
}

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
  });
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(useDepotEconomics).mockReturnValue({
    data: DATA,
    error: null,
    loading: false,
    refresh: vi.fn(),
  } as unknown as ReturnType<typeof useDepotEconomics>);
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

describe('EconomicsPage', () => {
  it('tags the ranking MODELLED, says the indices are separate and links to the league table', async () => {
    await render(<EconomicsPage />);
    const text = host.textContent ?? '';
    expect(text).toContain('Depot Economics Index ranking within peer groups');
    expect(host.querySelector('[data-provenance="modelled"]')).not.toBeNull();
    expect(text).toContain('Economics index (MODELLED)');
    expect(text).toContain('separate from the Depot Efficiency Index, which is built from live data');
    expect(host.querySelector('a[href="/project/depots/league"]')).not.toBeNull();
    expect(host.querySelector('a[href="/project/depots/d/1"]')).not.toBeNull();
    expect(text).toContain('1 ranked of 1 operating depot (MODELLED)');
    expect(text.toLowerCase()).not.toContain('simulated');
  });

  it('opens a MODELLED breakdown for the selected depot', async () => {
    await render(<EconomicsPage />);
    const button = host.querySelector<HTMLButtonElement>('button[aria-label^="Economics breakdown"]');
    await act(async () => button?.click());
    const panel = host.querySelector('[data-testid="depot-economics-breakdown"]');
    expect(panel?.textContent).toContain('Economics breakdown (modelled)');
    expect(panel?.textContent).toContain('rank 1 of 6 in its peer group');
    expect(panel?.textContent).toContain('₹30.00 per km');
    expect(panel?.textContent).toContain('on 2 of 2 routes');
  });
});

function sparseData(): EconomicsResponse {
  const base = DATA.depots[0] as EconomicsResponse['depots'][number];
  const unranked = (id: string): EconomicsResponse['depots'][number] => ({
    ...base,
    depotId: id,
    name: `Depot ${id}`,
    lengthCoverage: { n: 0, of: 9 },
    score: {
      ...base.score,
      depotId: id,
      // S39: no real length is no reason; what leaves these unranked is the peer-group guard.
      ranked: false,
      reason: 'peer_group_too_small',
      missing: [],
      economicsIndex: null,
      rank: null,
      peerCount: null,
      components: base.score.components.map((c) => ({ ...c, peerMedian: null, z: null })),
    },
  });
  return { ...DATA, depots: [unranked('2'), unranked('3'), unranked('4')] } as EconomicsResponse;
}

function useData(data: EconomicsResponse): void {
  vi.mocked(useDepotEconomics).mockReturnValue({
    data,
    error: null,
    loading: false,
    refresh: vi.fn(),
  } as unknown as ReturnType<typeof useDepotEconomics>);
}

describe('EconomicsPage truthfulness', () => {
  it('tags every modelled column header on the grid and the breakdown', async () => {
    await render(<EconomicsPage />);
    const headers = [...host.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
    for (const label of ['Earnings per km', 'Fuel cost per km', 'Load factor']) {
      expect(headers.some((h) => h.includes(`${label} (MODELLED)`))).toBe(true);
    }
    const button = host.querySelector<HTMLButtonElement>('button[aria-label^="Economics breakdown"]');
    await act(async () => button?.click());
    const panel = host.querySelector('[data-testid="depot-economics-breakdown"]');
    const inner = [...(panel?.querySelectorAll('th') ?? [])].map((th) => th.textContent ?? '');
    expect(inner).toContain('Depot (MODELLED)');
    expect(inner).toContain('Peer median (MODELLED)');
    expect(panel?.textContent).toContain('Fuel cost per km');
  });

  it('says fuel is one cost, what the index can tell, and carries the full statement', async () => {
    await render(<EconomicsPage />);
    const text = host.textContent ?? '';
    expect(text).toContain('Fuel is only one cost. The difference between earnings and fuel cost per kilometre is not profit.');
    expect(text).toContain('is not a finding about any depot');
    expect(text).toContain('planning assumptions');
    expect(text).toMatch(/fuel issue records/i);
    expect(text).toContain('each duty that a bus ran is one trip, a run out and back');
    expect(text).toContain("This index is driven by the model's class mix and load-factor assumptions");
    expect(text).toContain('Fuel cost per km (MODELLED)');
    expect(text).toContain(
      'Route lengths: 2 of 2 routes run in the modelled day rest on a real route profile',
    );
    expect(host.querySelector('a[href="/project/depots/sources"]')).not.toBeNull();
  });

  it('puts no aria-selected on a table row', async () => {
    await render(<EconomicsPage />);
    expect(host.querySelector('tbody tr[aria-selected]')).toBeNull();
    expect(host.querySelector('tbody tr button[aria-pressed]')).not.toBeNull();
  });

  it('explains an almost empty ranking, shows unranked depots, and gives each a visible reason', async () => {
    useData(sparseData());
    await render(<EconomicsPage />);
    const text = host.textContent ?? '';
    expect(text).toContain('Only 0 of 3 operating depots are ranked.');
    expect(text).toContain('so no depot waits for route profiles');
    expect(text).not.toMatch(/known length|length not known|can be ranked/);
    expect(text).toContain('Route lengths: 0 of 27 routes run in the modelled day rest on a real route profile');
    expect(host.querySelector('a[href="/project/depots/routes"]')).not.toBeNull();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
    const first = host.querySelector('tbody tr')?.textContent ?? '';
    expect(first).toContain('not ranked');
    expect(first).toContain('peer group too small');
    expect(first).toContain('lengths: 0 of 9 routes from real route profiles, the rest modelled');
  });

  it('says nothing is ranked yet when the filter is turned off, and filters when searching', async () => {
    useData(sparseData());
    await render(<EconomicsPage />);
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(true);
    await act(async () => box?.click());
    expect(host.textContent).toContain('Nothing is ranked yet.');
  });

  it('announces a selected depot that the filters hide', async () => {
    useData(sparseData());
    await render(<EconomicsPage />);
    const button = host.querySelector<HTMLButtonElement>('button[aria-label^="Economics breakdown"]');
    await act(async () => button?.click());
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => box?.click());
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/hidden by the filters/i);
  });
});

describe('revenue components', () => {
  it('tags each summary tile MODELLED and states the earnings coverage', async () => {
    await render(
      <RevenueSummary
        operatingDate="2026-10-06"
        totals={{
          routes: 2,
          trips: 8,
          boardings: 160,
          revenue: 12345,
          loadFactor: 0.5,
          serviceKm: 0,
          modelledLengthRevenueShare: 0.4,
          earningsPerKm: null,
          lengthCoverage: { n: 0, of: 2 },
          provenance: 'modelled',
        }}
      />,
    );
    expect(host.querySelectorAll('[data-provenance="modelled"]')).toHaveLength(5);
    expect(host.textContent).toContain('₹12,345');
    expect(host.textContent).toContain('Lengths: 0 of 2 routes from real route profiles, the rest modelled');
    expect(host.textContent).toContain('40.0% of revenue is on routes of modelled length (no real profile yet)');
    expect(host.textContent).toContain('no kilometres run');
  });

  it('prints the response notes and the definitions in the MODELLED statement', async () => {
    await render(<ModelledStatement params={REVENUE_MODEL_PARAMS} notes={[MIXED_CLASS_NOTE]} />);
    expect(host.textContent).toContain('the class its name states (ordinary when it states none)');
    expect(host.textContent).toContain('occupied seats over seats offered, weighted by trips');
  });

  it('caps the hero and offers Show all', async () => {
    const routes = Array.from({ length: 12 }, (_, i) => route(`R${i}`, (12 - i) * 100));
    await render(<RevenueHero routes={routes} />);
    expect(host.querySelectorAll('li')).toHaveLength(10);
    const toggle = host.querySelector<HTMLButtonElement>('button');
    expect(toggle?.textContent).toBe('Show all 12');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.hasAttribute('aria-pressed')).toBe(false);
    await act(async () => toggle?.click());
    expect(host.querySelectorAll('li')).toHaveLength(12);
    // One signal: the label stays, the expanded state changes.
    expect(toggle?.textContent).toBe('Show all 12');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps one fixed Show all label with aria-expanded on the route table', async () => {
    const routes = Array.from({ length: 30 }, (_, i) => route(`R${i}`, 100 + i));
    await render(<RevenueRoutesTable routes={routes} />);
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(toggle?.textContent).toBe('Show all 30');
    await act(async () => toggle?.click());
    expect(toggle?.textContent).toBe('Show all 30');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('tags every modelled route-table header and each length cell with its provenance', async () => {
    const derived = { ...route('R1', 50), lengthKm: 80, lengthProvenance: 'derived' } as RouteRevenueFigure;
    await render(<RevenueRoutesTable routes={[route('R0', 100), derived]} />);
    const headers = [...host.querySelectorAll('th')].map((th) => th.textContent ?? '');
    for (const label of ['Trips', 'Boardings', 'Load factor', 'Revenue', 'Earnings per km']) {
      expect(headers.some((h) => h.includes(`${label} (MODELLED)`))).toBe(true);
    }
    // The column mixes real and typical lengths, so each cell carries the tag, not the header.
    expect(headers.some((h) => h.includes('Route length'))).toBe(true);
    expect(host.textContent).toContain('60 km (modelled)');
    expect(host.textContent).toContain('80 km (derived)');
  });

  it('sorts the route length column by the length itself', async () => {
    const long = { ...route('Long', 100), lengthKm: 90, lengthProvenance: 'derived' } as RouteRevenueFigure;
    const short = { ...route('Short', 200), lengthKm: 10, lengthProvenance: 'derived' } as RouteRevenueFigure;
    await render(<RevenueRoutesTable routes={[long, short]} />);
    const button = [...host.querySelectorAll<HTMLButtonElement>('th button')].find((b) =>
      b.textContent?.includes('Route length'),
    );
    await act(async () => button?.click());
    const names = [...host.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent);
    expect(names).toEqual(['Short', 'Long']);
  });

  it('gives earnings on a modelled length, and says why only when nothing ran', async () => {
    const idle = { ...route('R1', 0), trips: 0, serviceKm: 0, earningsPerKm: null, earningsWithheld: 'no_service_km' } as RouteRevenueFigure;
    await render(<RevenueRoutesTable routes={[route('R0', 120), idle]} />);
    // 120 rupees over 480 km = 0.25 a km.
    expect(host.textContent).toContain('₹0.25 per km');
    expect(host.textContent).toContain('no kilometres run');
    expect(host.textContent).toContain('ran no kilometres and has no earnings per kilometre');
    expect(host.textContent).not.toContain('undefined');
    expect(host.textContent).toContain('Earnings per km');
  });
});
