import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotDutiesPage from '@/app/(protected)/project/depots/d/[depotId]/duties/page';
import { DutyPage } from '@/components/depot/duties/DutyPage';
import type { DutyBoardResponse } from '@/lib/depot/duties/api';
import { COST_SENTENCE, MODEL_NOTICE } from '@/lib/depot/duties/dutyBoardModel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';

const hook = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/hooks/useDepotDuties', () => ({ useDepotDuties: (): unknown => hook.value }));
vi.mock('@/lib/depot/depotGate', () => ({ requireDepotPage: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { source: 'live', stale: false, feedNow: '2026-10-06T10:00:00Z' },
    error: null,
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

describe('the duty page in every state (guard X1)', () => {
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

  it('puts the dated modelled-day sentence in the provenance line, and nowhere else', async () => {
    setHook({ data: BASE });
    const markup = await renderPage();
    const context = markup.slice(markup.indexOf('depot-provenance-context'));
    expect(text(context)).toContain(
      'This page is built on the modelled day for 2026-10-06, rebuilt from the live fleet as of the feed time: 1 duty on 1 route.',
    );
    expect(text(markup).split('This page is built on')).toHaveLength(2);
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
    expect(seen).toContain('so location is not used: every standing bus is eligible.');
    expect(seen).toContain('The feed has no clock, so no bus could be judged');
  });

  it('puts a stale strip above the board when the feed is stale', () => {
    setHook({ data: { ...BASE, stale: true } });
    expect(renderToStaticMarkup(<DutyPage depotId="20" />)).toContain('data-testid="depot-stale"');
  });
});
