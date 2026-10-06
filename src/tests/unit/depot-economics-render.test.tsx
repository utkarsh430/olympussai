import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EconomicsPage } from '@/components/depot/economics/EconomicsPage';
import { RevenueRoutesTable } from '@/components/depot/revenue/RevenueRoutesTable';
import { HowProduced } from '@/components/depot/revenue/HowProduced';
import type { EconomicsResponse } from '@/lib/depot/revenue/api';
import type { RouteRevenueFigure } from '@/lib/depot/revenue/types';
import { revenueBand, revenueDisclosure } from '@/lib/depot/revenue/revenueTablePageModel';
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

/** The page's text without the closed disclosure, where the definitions now live. */
function pageTextWithoutDisclosure(): string {
  const clone = host.cloneNode(true) as HTMLElement;
  clone.querySelector('[data-testid="depot-how-produced"]')?.remove();
  return clone.textContent ?? '';
}

describe('EconomicsPage', () => {
  it('says the indices are separate, links to the league table and has no MODELLED tag outside the disclosure', async () => {
    await render(<EconomicsPage />);
    const text = host.textContent ?? '';
    expect(text).toContain('Depot Economics Index ranking within peer groups');
    expect(text).toContain('separate from the Depot Efficiency Index, which is built from live data');
    expect(host.querySelector('a[href="/project/depots/league"]')).not.toBeNull();
    expect(host.querySelector('a[href="/project/depots/d/1"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="depot-economics-status"]')?.textContent).toContain(
      'ranked of 1 operating depot',
    );
    expect(host.querySelector('[data-provenance]')).toBeNull();
    expect(pageTextWithoutDisclosure()).not.toMatch(/MODELLED|\(modelled\)/);
    expect(text.toLowerCase()).not.toContain('simulated');
    expect(host.querySelector('[data-testid="depot-economics-shortfall"]')).toBeNull();
  });

  it('opens a breakdown for the selected depot, below the table under 2xl, with the shell offsets', async () => {
    await render(<EconomicsPage />);
    const button = host.querySelector<HTMLButtonElement>('button[aria-label^="Economics breakdown"]');
    await act(async () => button?.click());
    const panel = host.querySelector('[data-testid="depot-economics-breakdown"]');
    expect(panel?.textContent).toContain('Economics breakdown');
    expect(panel?.textContent).not.toMatch(/MODELLED|\(modelled\)/);
    expect(panel?.textContent).toContain('rank 1 of 6 in its peer group');
    expect(panel?.textContent).toContain('₹30.00 per km');
    expect(panel?.textContent).toContain('on 2 of 2 routes');
    expect(panel?.className).toContain('2xl:top-[var(--depot-panel-top)]');
    expect(panel?.className).not.toMatch(/(^|\s)xl:/);
    expect(host.querySelector('h2#economics-breakdown-title')?.className).toContain(
      'scroll-mt-[var(--depot-anchor-mt)]',
    );
    expect(host.querySelector('[class*="2xl:grid-cols"]')).not.toBeNull();
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
  it('names the columns without tags, keeps Rank, Depot and the index first and fixes the row height', async () => {
    await render(<EconomicsPage />);
    const headers = [...host.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
    for (const label of ['Earnings per km', 'Fuel cost per km', 'Load factor', 'Economics index']) {
      expect(headers.some((h) => h.includes(label))).toBe(true);
    }
    expect(headers.some((h) => /MODELLED/i.test(h))).toBe(false);
    expect(headers.slice(0, 3).map((h) => h.trim())).toEqual(['Rank', 'Depot', 'Economics index']);
    expect(host.querySelector('table.depot-table-fixed')).not.toBeNull();
    const button = host.querySelector<HTMLButtonElement>('button[aria-label^="Economics breakdown"]');
    await act(async () => button?.click());
    const panel = host.querySelector('[data-testid="depot-economics-breakdown"]');
    const inner = [...(panel?.querySelectorAll('th') ?? [])].map((th) => th.textContent ?? '');
    expect(inner).toContain('Depot');
    expect(inner).toContain('Peer median');
    expect(panel?.textContent).toContain('Fuel cost per km');
  });

  it('keeps the not-profit and index-limits sentences visible and the full statement in the disclosure', async () => {
    await render(<EconomicsPage />);
    const visible = pageTextWithoutDisclosure();
    expect(visible).toContain(
      'Fuel is only one cost. The difference between earnings and fuel cost per kilometre is not profit.',
    );
    expect(visible).toContain("This index is driven by the model's class mix and load-factor assumptions");
    expect(visible).toContain('is not a finding about any depot');
    const details = host.querySelector('details[data-testid="depot-how-produced"]');
    expect(details?.hasAttribute('open')).toBe(false);
    const text = details?.textContent ?? '';
    expect(text).toContain('planning assumptions');
    expect(text).toMatch(/fuel issue records/i);
    expect(text).toContain('each duty that a bus ran is one trip, a run out and back');
    expect(text).toContain('The Depot Economics Index ranks operating depots on three MODELLED figures');
    expect(text).toContain('Route lengths: 2 of 2 routes run in the modelled day rest on a real route profile');
    expect(details?.querySelector('a[href="/project/depots/sources"]')).not.toBeNull();
  });

  it('puts no aria-selected on a table row', async () => {
    await render(<EconomicsPage />);
    expect(host.querySelector('tbody tr[aria-selected]')).toBeNull();
    expect(host.querySelector('tbody tr button[aria-pressed]')).not.toBeNull();
  });

  it('shows a state panel for an almost empty ranking, then the unranked depots with a reason each', async () => {
    useData(sparseData());
    await render(<EconomicsPage />);
    const text = host.textContent ?? '';
    const panel = host.querySelector('[data-testid="depot-economics-shortfall"]');
    expect(panel?.getAttribute('data-state')).toBe('not-ranked');
    expect(panel?.textContent).toContain('No depot is ranked among the 3 operating depots.');
    expect(panel?.textContent).toContain('A depot is ranked when a duty ran');
    expect(text).toContain('Only 0 of 3 operating depots are ranked.');
    expect(text).toContain('so no depot waits for route profiles');
    expect(text).not.toMatch(/known length|length not known|can be ranked/);
    expect(text).toContain('Route lengths: 0 of 27 routes run in the modelled day rest on a real route profile');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
    const first = host.querySelector('tbody tr')?.textContent ?? '';
    expect(first).toContain('not ranked');
    expect(first).toContain('peer group too small');
    expect(first).toContain('lengths: 0 of 9 routes from real route profiles, the rest modelled');
    const rows = host.querySelectorAll('[data-testid="depot-economics-status"] li');
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows[1]?.textContent).toContain('not ranked: peer group too small');
  });

  it('says nothing is ranked yet when the filter is turned off, in a state panel, never an empty table', async () => {
    useData(sparseData());
    await render(<EconomicsPage />);
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(true);
    await act(async () => box?.click());
    expect(host.textContent).toContain('Nothing is ranked yet.');
    expect(host.querySelector('tbody')).toBeNull();
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
  it('has five band figures with short captions and no tag', () => {
    const band = revenueBand({
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
    });
    expect(band.map((f) => f.label)).toEqual(['Trips', 'Boardings', 'Load factor', 'Revenue', 'Earnings per km']);
    expect(band[3]?.value).toBe('₹12,345');
    expect(band[3]?.caption).toBe('40.0% on modelled lengths');
    expect(band[4]?.caption).toBe('no kilometres run');
    for (const f of band) expect(`${f.label}${f.value}${f.caption}`).not.toMatch(/MODELLED/);
  });

  it('prints the response notes and the definitions in the closed disclosure', async () => {
    const totals = { modelledLengthRevenueShare: 0.4 } as Parameters<typeof revenueDisclosure>[1];
    await render(<HowProduced paragraphs={revenueDisclosure(REVENUE_MODEL_PARAMS, totals, [MIXED_CLASS_NOTE])} />);
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(host.textContent).toContain('How these figures are produced');
    expect(host.textContent).toContain('the class its name states (ordinary when it states none)');
    expect(host.textContent).toContain('occupied seats over seats offered, weighted by trips');
    expect(host.textContent).toContain('Duties that ran in the modelled day, one trip out and back each');
    expect(host.textContent).toContain('40.0% of revenue is on routes of modelled length (no real profile yet)');
    expect(host.textContent).toContain("These are planning assumptions, not the corporation's figures.");
    expect(host.querySelector('a[href="/project/depots/sources"]')).not.toBeNull();
  });

  it('pages the route table at 25 and draws an inline revenue bar', async () => {
    const routes = Array.from({ length: 30 }, (_, i) => route(`R${i}`, 100 + i));
    await render(<RevenueRoutesTable routes={routes} coverage={{ n: 0, of: 30 }} />);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(host.textContent).toContain('Rows 1 to 25 of 30');
    expect(host.querySelectorAll('tbody .depot-bar-fill').length).toBe(25);
    expect(host.textContent).toContain('Lengths: 0 of 30 routes from real route profiles, the rest modelled');
  });

  it('tags nothing MODELLED in the table; only a length from a real profile is DERIVED', async () => {
    const derived = { ...route('R1', 50), lengthKm: 80, lengthProvenance: 'derived' } as RouteRevenueFigure;
    await render(<RevenueRoutesTable routes={[route('R0', 100), derived]} coverage={{ n: 1, of: 2 }} />);
    const headers = [...host.querySelectorAll('th')].map((th) => th.textContent ?? '');
    expect(headers.some((h) => /MODELLED/i.test(h))).toBe(false);
    for (const label of ['Trips', 'Boardings', 'Load factor', 'Revenue', 'Earnings per km', 'Route length']) {
      expect(headers.some((h) => h.includes(label))).toBe(true);
    }
    const tags = [...host.querySelectorAll('[data-provenance]')].map((t) => t.getAttribute('data-provenance'));
    expect(tags).toEqual(['derived']);
    expect(host.textContent).not.toMatch(/\(modelled\)|\(derived\)/);
  });

  it('sorts the route length column by the length itself', async () => {
    const long = { ...route('Long', 100), lengthKm: 90, lengthProvenance: 'derived' } as RouteRevenueFigure;
    const short = { ...route('Short', 200), lengthKm: 10, lengthProvenance: 'derived' } as RouteRevenueFigure;
    await render(<RevenueRoutesTable routes={[long, short]} coverage={{ n: 2, of: 2 }} />);
    const button = [...host.querySelectorAll<HTMLButtonElement>('th button')].find((b) =>
      b.textContent?.includes('Route length'),
    );
    await act(async () => button?.click());
    const names = [...host.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent);
    expect(names).toEqual(['Short', 'Long']);
  });

  it('gives earnings on a modelled length, and says why only when nothing ran', async () => {
    const idle = {
      ...route('R1', 0),
      trips: 0,
      serviceKm: 0,
      earningsPerKm: null,
      earningsWithheld: 'no_service_km',
    } as RouteRevenueFigure;
    await render(<RevenueRoutesTable routes={[route('R0', 120), idle]} coverage={{ n: 0, of: 2 }} />);
    // 120 rupees over 480 km = 0.25 a km.
    expect(host.textContent).toContain('₹0.25');
    // The reason is in the cell's title, not a sentence in the cell.
    expect(host.querySelector('td[title*="ran no kilometres and has no earnings per kilometre"]')).not.toBeNull();
    expect(host.textContent).not.toContain('undefined');
    expect(host.textContent).toContain('Earnings per km');
  });
});
