import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotDutiesPage from '@/app/(protected)/project/depots/d/[depotId]/duties/page';
import { DutyPage } from '@/components/depot/duties/DutyPage';
import type { DutyBoardResponse } from '@/lib/depot/duties/api';
import { COST_SENTENCE, MODEL_NOTICE } from '@/lib/depot/duties/dutyBoardModel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';

const hook = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/hooks/useDepotDuties', () => ({ useDepotDuties: (): unknown => hook.value }));
vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { source: 'live', stale: false, feedNow: '2026-10-06T10:00:00Z' },
    error: null,
  }),
}));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: (): unknown => ({
    depotId: '20',
    data: { outshed: { coverage: { n: 8, of: 200 } } },
  }),
}));

const BASE: DutyBoardResponse = {
  feedNow: '2026-10-06T10:00:00Z',
  fetchedAt: '2026-10-06T10:00:05.000Z',
  source: 'live',
  stale: false,
  depotId: '20',
  depotName: 'Alambagh',
  operatingDate: '2026-10-06',
  peakRequirement: 1,
  routeCount: 2,
  duties: [
    {
      id: 'D-0',
      routeName: 'ORD_1',
      startMin: 420,
      endMin: 900,
      serviceClass: 'ordinary',
      registrationNumber: 'UP32A0001',
      busStanding: 'in_yard',
      busClass: 'ordinary',
      state: 'assigned',
      blockers: null,
    },
  ],
  spareBuses: ['UP32A0002'],
  routesWithoutDuty: ['ORD_2'],
  counts: {
    duties: 1,
    assigned: 1,
    unassigned: 0,
    spare: 1,
    spareByStanding: { inYard: 0, standing: 0, onRoad: 1 },
    excluded: { notInYard: 0, notHeard: 0, offRoad: 0, dark: 0 },
  },
};

const EMPTY: DutyBoardResponse = {
  ...BASE,
  duties: [],
  routeCount: 0,
  counts: { ...BASE.counts, duties: 0, assigned: 0, spare: 0 },
  spareBuses: [],
  routesWithoutDuty: [],
};

function setHook(partial: Record<string, unknown>): void {
  hook.value = { data: null, error: null, loading: false, refresh: () => {}, ...partial };
}

const text = (markup: string): string =>
  markup.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

/** Text outside the closed disclosure, i.e. what the reader sees without opening it. */
const visible = (markup: string): string => {
  const at = markup.indexOf('data-testid="duties-how"');
  return text(at < 0 ? markup : markup.slice(0, markup.lastIndexOf('<', at)));
};

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await DepotDutiesPage({ params: Promise.resolve({ depotId: '20' }) }));
}

const MIXED = 'Bus states are DERIVED';
const STATES: readonly (readonly [string, Record<string, unknown>])[] = [
  ['loading', { loading: true }],
  ['error', { error: 'Depot data unavailable' }],
  ['not found', { error: DEPOT_NOT_FOUND_MESSAGE }],
  ['empty', { data: EMPTY }],
  ['data', { data: BASE }],
];

describe('the duty page in every state', () => {
  beforeEach(() => setHook({}));

  it.each(STATES)('declares MIXED with its clauses and says nothing is assigned (%s)', async (_n, p) => {
    setHook(p);
    const markup = await renderPage();
    expect(markup).toContain('data-tone="mixed"');
    const seen = visible(markup);
    expect(seen).toContain(MIXED);
    expect(seen).toContain('duties and the matching are MODELLED.');
    expect(seen).toContain('nothing is assigned or dispatched');
    expect(text(markup)).not.toMatch(/simulated|\btoday\b|\bran\b/i);
    expect(text(markup)).not.toContain('Assigned');
  });

  // The ONE modelled-day formula (modelledDayLine) with the plain
  // date and the feed's schedule coverage; the raw ISO date never reaches the screen.
  it('puts the dated modelled-day sentence in the provenance line, and nowhere else', async () => {
    setHook({ data: BASE });
    const markup = await renderPage();
    const context = markup.slice(markup.indexOf('depot-provenance-context'));
    const sentence =
      'Built on the modelled day for 6 Oct 2026: 1 duty on 1 route; the feed schedules 8 of 200 buses.';
    expect(text(context)).toContain(sentence);
    expect(text(markup).split('Built on the modelled day')).toHaveLength(2);
  });

  it.each(STATES)('puts no raw ISO date in any text, title or aria-label (%s)', async (_n, p) => {
    setHook(p);
    const markup = await renderPage();
    expect(text(markup)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const attributes = [...markup.matchAll(/(?:title|aria-label)="([^"]*)"/g)].map((m) => m[1]);
    expect(attributes.join(' ')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // Each state's body is pinned, not only the header.
  it('loading: the board footprint with its words', async () => {
    setHook({ loading: true });
    const markup = await renderPage();
    expect(markup).toContain('data-testid="duties-loading"');
    expect(text(markup)).toContain('Loading the duty figures');
    expect(text(markup)).toContain('Loading the timeline');
  });

  it('error: what failed, what to do, Retry and a way back', async () => {
    setHook({ error: 'Depot data unavailable' });
    const markup = await renderPage();
    const body = text(markup);
    expect(markup).toContain('data-testid="depot-error"');
    expect(body).toContain('Could not load duties');
    expect(body).toContain('Retry');
    expect(body).toContain('Back to the network overview');
    expect(markup).toContain('href="/project/depots"');
  });

  it('not found: names the id and links back to the network overview', async () => {
    setHook({ error: DEPOT_NOT_FOUND_MESSAGE });
    const markup = await renderPage();
    expect(markup).toContain('data-testid="duties-unknown"');
    expect(text(markup)).toContain('No depot has the id 20 in the current feed.');
    expect(text(markup)).toContain('Back to the network overview');
    expect(markup).toContain('href="/project/depots"');
    expect(text(markup)).not.toContain('Retry');
  });

  it('gives an empty board one "no duties" sentence with its cause and a way on', async () => {
    setHook({ data: EMPTY });
    const markup = await renderPage();
    const body = text(markup);
    expect(body).toContain('None of its buses reports a route');
    expect(body.split('No duties are modelled for this depot')).toHaveLength(2);
    expect(markup).toContain('href="/project/depots/sources"');
    expect(body).not.toContain('Duty timeline');
  });

  it('shows the band under the tagged label, and the method in the closed disclosure', async () => {
    setHook({ data: BASE });
    const markup = await renderPage();
    const seen = visible(markup);
    expect(seen).toContain('Duty timeline');
    expect(seen).toContain('Spare buses');
    expect(seen).toContain('1 on the road');
    expect(seen).not.toContain(COST_SENTENCE);
    const body = text(markup);
    expect(body).toContain(MODEL_NOTICE);
    expect(body).toContain(COST_SENTENCE);
    expect(body).toContain('1 bus is on the road with no duty.');
    expect(body).toContain('1 route has no duty: ORD_2.');
    expect(markup).not.toContain('data-testid="depot-stale"');
  });

  it('says once, above the chart, why duties have no bus and how eligibility was judged', async () => {
    setHook({
      data: {
        ...BASE,
        eligibilityIgnoredLocation: true,
        recencyNotJudged: true,
        counts: {
          ...BASE.counts,
          unassigned: 2,
          excluded: { notInYard: 0, notHeard: 3, offRoad: 1, dark: 2 },
        },
      },
    });
    const seen = visible(await renderPage());
    expect(seen.split('No bus for 2 duties')).toHaveLength(2);
    expect(seen).toContain('3 not heard recently · 1 off the road · 2 dark');
    expect(seen).toContain('so location is not used: every bus that is not off the road or dark is eligible, standing or out on the road.');
    expect(seen).toContain('The feed has no clock, so no bus could be judged');
  });

  it('puts a stale strip above the board when the feed is stale', () => {
    setHook({ data: { ...BASE, stale: true } });
    expect(renderToStaticMarkup(<DutyPage depotId="20" />)).toContain('data-testid="depot-stale"');
  });
});
