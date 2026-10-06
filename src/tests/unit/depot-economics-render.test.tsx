import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EconomicsPage } from '@/components/depot/economics/EconomicsPage';
import { RevenueRoutesTable } from '@/components/depot/revenue/RevenueRoutesTable';
import { HowProduced } from '@/components/depot/revenue/HowProduced';
import type { EconomicsResponse } from '@/lib/depot/revenue/api';
import type { RouteRevenueFigure } from '@/lib/depot/revenue/types';
import { revenueBand, revenueDisclosure } from '@/lib/depot/revenue/revenueTablePageModel';
import { ECONOMICS_TABLE_NOTE } from '@/lib/depot/revenue/economicsPageModel';
import {
  ECONOMICS_WEIGHTS,
  MIXED_CLASS_NOTE,
  REVENUE_MODEL_PARAMS,
} from '@/lib/depot/sim/revenueConfig';
import { useDepotEconomics } from '@/hooks/useDepotEconomics';

vi.mock('@/hooks/useDepotEconomics', () => ({ useDepotEconomics: vi.fn() }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { source: 'live', stale: false, feedNow: '2026-10-06T08:00:00Z' },
    error: null,
  }),
}));

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

type HookResult = ReturnType<typeof useDepotEconomics>;

function useHook(result: Partial<HookResult>): void {
  vi.mocked(useDepotEconomics).mockReturnValue({
    data: null,
    error: null,
    loading: false,
    refresh: vi.fn(),
    ...result,
  } as unknown as HookResult);
}

function useData(data: EconomicsResponse): void {
  useHook({ data });
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useData(DATA);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
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

/** Every string the page can show or speak: text, titles and accessible names. */
function everyString(): string {
  const attrs = [...host.querySelectorAll('[title], [aria-label]')].flatMap((el) => [
    el.getAttribute('title') ?? '',
    el.getAttribute('aria-label') ?? '',
  ]);
  return [host.textContent ?? '', ...attrs].join(' \n ');
}

function breakdownButton(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('button[aria-label^="Score breakdown for"]');
}

/** X1: the page declares MODELLED in every state, so dropping the default fails here. */
describe('EconomicsPage provenance line', () => {
  const MODELLED_SENTENCE = 'Generated from planning assumptions, not measured.';
  const states: readonly [string, Partial<HookResult>][] = [
    ['loading', { loading: true }],
    ['error', { error: 'The service is down.' }],
    ['empty', { data: { ...DATA, depots: [] } as EconomicsResponse }],
    ['data', { data: DATA }],
  ];
  for (const [name, result] of states) {
    it(`is MODELLED with its sentence while ${name}`, async () => {
      useHook(result);
      await render(<EconomicsPage />);
      const line = host.querySelector('[data-testid="depot-provenance-line"]');
      expect(line?.getAttribute('data-tone')).toBe('modelled');
      expect(line?.textContent).toContain('MODELLED');
      expect(line?.textContent).toContain(MODELLED_SENTENCE);
      expect(line?.textContent).toContain('a ticketing feed');
    });
  }

  it('carries the dated, tense-neutral modelled day in its extension and nothing else above the band', async () => {
    await render(<EconomicsPage />);
    const context = host.querySelector('[data-testid="depot-provenance-context"]');
    expect(context?.textContent).toContain('modelled day for 2026-10-06');
    // The disclosure quotes the revenue page's shared statement, which that page owns.
    const attrs = everyString().replace(host.textContent ?? '', '');
    expect(`${pageTextWithoutDisclosure()} ${attrs}`).not.toMatch(/\bran\b|\btoday\b|did not run/i);
    expect(host.querySelector('[data-testid="depot-economics-status"]')).toBeNull();
  });
});

describe('EconomicsPage', () => {
  it('keeps the three facts in one visible sentence, the section tagged MODELLED, the paragraphs in the disclosure', async () => {
    await render(<EconomicsPage />);
    const visible = pageTextWithoutDisclosure();
    expect(visible).toContain(ECONOMICS_TABLE_NOTE);
    expect(visible).not.toContain('Fuel is only one cost.');
    const label = host.querySelector('#economics-ranking-title')?.closest(
      '[data-testid="depot-section-label"]',
    );
    expect(label?.querySelector('[data-provenance="modelled"]')).not.toBeNull();
    expect(label?.textContent).toContain(ECONOMICS_TABLE_NOTE);
    const details = host.querySelector('details[data-testid="depot-how-produced"]');
    expect(details?.hasAttribute('open')).toBe(false);
    const text = details?.textContent ?? '';
    expect(text).toContain(
      'The Depot Economics Index is modelled from planning assumptions and is separate from the Depot Efficiency Index, which is built from live data. The efficiency index is on the league table.',
    );
    expect(text).toContain(
      "This index is driven by the model's class mix and load-factor assumptions; it shows how a ranking will work once ticketing data is supplied and is not a finding about any depot.",
    );
    expect(text).toContain(
      'Fuel is only one cost. The difference between earnings and fuel cost per kilometre is not profit.',
    );
    expect(text).toContain('planning assumptions');
    expect(text).toMatch(/fuel issue records/i);
    expect(text).toContain(
      'The Depot Economics Index ranks operating depots on three MODELLED figures',
    );
    expect(text).toContain(
      'Route lengths: 2 of 2 routes run in the modelled day rest on a real route profile',
    );
    expect(details?.querySelector('a[href="/project/depots/league"]')).not.toBeNull();
    expect(details?.querySelector('a[href="/project/depots/sources"]')).not.toBeNull();
    expect(host.querySelector('a[href="/project/depots/d/1"]')).not.toBeNull();
    expect(everyString().toLowerCase()).not.toContain('simulated');
    // Every string the page shows or speaks, titles and names included: only the two
    // required sentences may say "profit", and no efficiency value is printed.
    const rest = everyString()
      .split(ECONOMICS_TABLE_NOTE)
      .join('')
      .split('Fuel is only one cost. The difference between earnings and fuel cost per kilometre is not profit.')
      .join('');
    expect(rest).not.toMatch(/\b(profit|profits|profitable|loss|losses|margin|margins)\b/i);
    expect(rest).not.toMatch(/efficiency index (of|is) \d|efficiency \d/i);
    expect(host.querySelector('[data-testid="depot-economics-shortfall"]')).toBeNull();
  });

  it('bands ranked, no duty and under a minimum at 24px figures, captions from the page model', async () => {
    await render(<EconomicsPage />);
    const band = host.querySelector('[data-testid="depot-figure-band"]');
    expect(band?.textContent).toContain('Ranked');
    expect(band?.textContent).toContain('of 1 operating depot');
    expect(band?.textContent).toContain('No duty in the modelled day');
    expect(band?.textContent).toContain('Under the peer-group minimum');
    expect(band?.querySelector('[data-provenance]')).toBeNull();
  });

  it('heads the columns with units, prints bare numbers with a muted signed change, and groups by peer group', async () => {
    await render(<EconomicsPage />);
    const headers = [...host.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    expect(headers).toEqual([
      'Rank',
      'Depot',
      'Economics index',
      'Earnings ₹/km',
      'Fuel ₹/km',
      'Load %',
      'Fleet',
    ]);
    expect(headers.some((h) => /MODELLED|peer group/i.test(h))).toBe(false);
    expect(host.querySelector('thead [data-provenance]')).toBeNull();
    expect(host.querySelector('table.depot-table-fixed')).not.toBeNull();
    expect(host.querySelector('[data-testid="depot-table-group"]')?.textContent).toBe('All depots · 1');
    const cells = [...host.querySelectorAll('tbody tr:not([data-testid]) td')];
    const shown = (i: number): string =>
      [...(cells[i]?.querySelectorAll('[aria-hidden]') ?? [])].map((n) => n.textContent).join(' ');
    expect(shown(3)).toBe('30.00 +5.00');
    expect(shown(4)).toBe('20.00 −2.00');
    expect(shown(5)).toContain('60.0 +5.0');
    expect(cells[3]?.textContent).toContain('better than peers');
    expect(host.textContent).toContain(
      'Change vs peer median; higher earnings and lower fuel cost are better.',
    );
    expect(host.querySelector('[data-testid="depot-economics-breakdown"]')).toBeNull();
    expect(host.textContent).not.toContain('Rows 1 to');
  });

  it('opens the breakdown from the index cell, tagged MODELLED, below the table under 2xl', async () => {
    await render(<EconomicsPage />);
    const button = breakdownButton();
    expect(button?.closest('td')).toBe(host.querySelectorAll('tbody tr:not([data-testid]) td')[2]);
    expect(button?.textContent).toContain('61.5');
    expect(host.querySelector('tbody button')?.textContent).not.toMatch(/^score$/i);
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => button?.click());
    expect(breakdownButton()?.getAttribute('aria-pressed')).toBe('true');
    const panel = host.querySelector('[data-testid="depot-economics-breakdown"]');
    expect(panel?.querySelector('[data-provenance="modelled"]')).not.toBeNull();
    expect(panel?.textContent).toContain('rank 1 of 6 in its peer group');
    expect(panel?.textContent).toContain('₹30.00 per km');
    expect(panel?.textContent).toContain('on 2 of 2 routes');
    expect(panel?.textContent).toContain('Fuel cost per km');
    const inner = [...(panel?.querySelectorAll('th') ?? [])].map((th) => th.textContent ?? '');
    expect(inner).toContain('Peer median');
    expect(panel?.textContent).not.toMatch(/efficiency/i);
    expect(panel?.className).toContain('2xl:top-[var(--depot-panel-top)]');
    expect(panel?.className).not.toMatch(/(^|\s)xl:/);
    expect(document.activeElement).toBe(panel);
    expect(host.querySelector('[class*="2xl:grid-cols"]')).not.toBeNull();
    expect(host.querySelector('tbody tr[aria-selected]')).toBeNull();
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

function manyRows(n: number): EconomicsResponse {
  const base = DATA.depots[0] as EconomicsResponse['depots'][number];
  const depots = Array.from({ length: n }, (_, i) => ({
    ...base,
    depotId: String(i + 1),
    name: `Depot ${i + 1}`,
    score: { ...base.score, depotId: String(i + 1), rank: i + 1, peerGroup: 'small' },
  }));
  return { ...DATA, depots } as unknown as EconomicsResponse;
}

describe('EconomicsPage truthfulness', () => {
  it('pages at 25 with the shared pager and counts the group over every page', async () => {
    useData(manyRows(30));
    await render(<EconomicsPage />);
    expect(host.querySelectorAll('tbody tr:not([data-testid])')).toHaveLength(25);
    expect(host.querySelector('[data-testid="depot-table-group"]')?.textContent).toBe(
      'Small fleets · 30',
    );
    expect(host.textContent).toContain('Rows 1 to 25 of 30');
  });

  it('shows a state panel for an almost empty ranking, with the Routes link and no band', async () => {
    useData(sparseData());
    await render(<EconomicsPage />);
    const panel = host.querySelector('[data-testid="depot-economics-shortfall"]');
    expect(panel?.getAttribute('data-state')).toBe('not-ranked');
    expect(panel?.textContent).toContain('No depot is ranked among the 3 operating depots.');
    expect(panel?.textContent).toContain('A depot is ranked when its modelled day has a duty');
    expect(panel?.querySelector('a[href="/project/depots/routes"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="depot-figure-band"]')).toBeNull();
    const text = host.textContent ?? '';
    expect(text).toContain('Only 0 of 3 operating depots are ranked.');
    expect(text).toContain('so no depot waits for route profiles');
    expect(text).not.toMatch(/known length|length not known|can be ranked/);
    expect(text).toContain(
      'Route lengths: 0 of 27 routes run in the modelled day rest on a real route profile',
    );
    const rows = host.querySelectorAll('tbody tr:not([data-testid])');
    expect(rows).toHaveLength(3);
    const first = rows[0]?.textContent ?? '';
    expect(first).toContain('not ranked');
    expect(first).toContain('peer group too small');
    expect(first).toContain('lengths: 0 of 9 routes from real route profiles, the rest modelled');
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
    await act(async () => breakdownButton()?.click());
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
    expect(band.map((f) => f.label)).toEqual([
      'Trips',
      'Boardings',
      'Load factor',
      'Revenue',
      '₹ / km',
    ]);
    expect(band[3]?.value).toBe('₹12,345');
    expect(band[3]?.caption).toBe('route lengths modelled');
    expect(band[4]?.caption).toBe('no kilometres run');
    for (const f of band) expect(`${f.label}${f.value}${f.caption}`).not.toMatch(/MODELLED/);
  });

  it('prints the response notes and the definitions in the closed disclosure', async () => {
    const totals = { modelledLengthRevenueShare: 0.4 } as Parameters<typeof revenueDisclosure>[1];
    await render(
      <HowProduced
        paragraphs={revenueDisclosure(REVENUE_MODEL_PARAMS, totals, [MIXED_CLASS_NOTE])}
      />,
    );
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(host.textContent).toContain('How these figures are produced');
    expect(host.textContent).toContain('the class its name states (ordinary when it states none)');
    expect(host.textContent).toContain('occupied seats over seats offered, weighted by trips');
    expect(host.textContent).toContain(
      'Duties run in the modelled day, one trip out and back each',
    );
    expect(host.textContent).toContain(
      '40.0% of revenue is on routes of modelled length (no real profile yet)',
    );
    expect(host.textContent).toContain(
      "These are planning assumptions, not the corporation's figures.",
    );
    expect(host.querySelector('a[href="/project/depots/sources"]')).not.toBeNull();
  });

  // Round 2 (critique revenue #1, #2): the pager only above 25 rows; the bar sits in the
  // load-factor cell; the length coverage moved to the band caption (one statement).
  it('pages the route table above 25 rows and draws the bar in the load-factor cell', async () => {
    const routes = Array.from({ length: 30 }, (_, i) => route(`R${i}`, 100 + i));
    await render(<RevenueRoutesTable routes={routes} />);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(host.textContent).toContain('Rows 1 to 25 of 30');
    const cells = host.querySelectorAll('tbody tr td:nth-child(5)');
    expect(cells[0]?.querySelector('.depot-bar-fill')).not.toBeNull();
    expect(cells[0]?.textContent).toBe('50.0%');
    expect(host.querySelectorAll('tbody .depot-bar-fill').length).toBe(25);
    await render(<RevenueRoutesTable routes={routes.slice(0, 4)} />);
    expect(host.textContent).not.toMatch(/Rows 1 to|Previous|Next/);
  });

  it('tags nothing MODELLED in the table; only a length from a real profile is DERIVED', async () => {
    const derived = {
      ...route('R1', 50),
      lengthKm: 80,
      lengthProvenance: 'derived',
    } as RouteRevenueFigure;
    await render(<RevenueRoutesTable routes={[route('R0', 100), derived]} />);
    const headers = [...host.querySelectorAll('th')].map((th) => th.textContent ?? '');
    expect(headers.some((h) => /MODELLED/i.test(h))).toBe(false);
    for (const label of [
      'Trips',
      'Boardings',
      'Load factor',
      'Revenue',
      '₹ / km',
      'Route length',
    ]) {
      expect(headers.some((h) => h.includes(label))).toBe(true);
    }
    const tags = [...host.querySelectorAll('[data-provenance]')].map((t) =>
      t.getAttribute('data-provenance'),
    );
    // Ruling S51 (round 2): the by-route section carries MODELLED on its label.
    expect(tags).toEqual(['modelled', 'derived']);
    expect(host.textContent).not.toMatch(/\(modelled\)|\(derived\)/);
  });

  it('sorts the route length column by the length itself', async () => {
    const long = {
      ...route('Long', 100),
      lengthKm: 90,
      lengthProvenance: 'derived',
    } as RouteRevenueFigure;
    const short = {
      ...route('Short', 200),
      lengthKm: 10,
      lengthProvenance: 'derived',
    } as RouteRevenueFigure;
    await render(<RevenueRoutesTable routes={[long, short]} />);
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
    await render(<RevenueRoutesTable routes={[route('R0', 120), idle]} />);
    // 120 rupees over 480 km = 0.25 a km.
    expect(host.textContent).toContain('0.25');
    // The reason is in the cell's title, not a sentence in the cell.
    expect(
      host.querySelector('td[title*="runs no kilometres and has no earnings per kilometre"]'),
    ).not.toBeNull();
    expect(host.textContent).not.toContain('undefined');
    expect(host.textContent).toContain('₹ / km'); // round 2: the header is "₹ / km"
  });
});
