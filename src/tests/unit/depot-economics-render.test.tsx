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
      earningsCoverage: { n: 2, of: 2 },
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
    lengthKm: null,
    revenueBasis: 'flat_fare_unknown_length',
    provenance: 'modelled',
    serviceKm: null,
    earningsPerKm: null,
    earningsWithheld: 'unknown_length',
    lengthProvenance: null,
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
    expect(text).toContain('Economics indexMODELLED');
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
          flatFareRevenueShare: 0.4,
          flatFareRouteShare: 0.5,
          earningsPerKm: null,
          earningsCoverage: { n: 0, of: 2 },
          provenance: 'modelled',
        }}
      />,
    );
    expect(host.querySelectorAll('[data-provenance="modelled"]')).toHaveLength(5);
    expect(host.textContent).toContain('₹12,345');
    expect(host.textContent).toContain('Based on 0 of 2 routes whose length is known');
    expect(host.textContent).toContain('Flat fare, length not known: 40.0% of revenue, 50.0% of routes');
  });

  it('prints the response notes and the definitions in the MODELLED statement', async () => {
    await render(<ModelledStatement params={REVENUE_MODEL_PARAMS} notes={[MIXED_CLASS_NOTE]} />);
    expect(host.textContent).toContain('most numerous class');
    expect(host.textContent).toContain('occupied seat-kilometres over seat-kilometres');
  });

  it('caps the hero and offers Show all', async () => {
    const routes = Array.from({ length: 12 }, (_, i) => route(`R${i}`, (12 - i) * 100));
    await render(<RevenueHero routes={routes} />);
    expect(host.querySelectorAll('li')).toHaveLength(10);
    const toggle = host.querySelector<HTMLButtonElement>('button');
    expect(toggle?.textContent).toBe('Show all 12');
    await act(async () => toggle?.click());
    expect(host.querySelectorAll('li')).toHaveLength(12);
  });

  it('says why earnings are withheld in the route table', async () => {
    await render(<RevenueRoutesTable routes={[route('R0', 100)]} />);
    expect(host.textContent).toContain('length not known');
    expect(host.textContent).toContain('Earnings per km');
  });
});
