import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotRoutesPage from '@/app/(protected)/project/depots/routes/page';
import { ROUTES_FIXTURE, PLAN_FIXTURE, slot } from './depot-routes.fixtures';

/**
 * Guard X1 (rulings §2, S51): the routes page's provenance default is MIXED and names what
 * is live, what is derived and what is modelled. The page is rendered from its real module
 * in every state, so changing or dropping the default fails here.
 */
const state = vi.hoisted(() => ({ routes: null as unknown, allocation: null as unknown }));

vi.mock('@/lib/auth/server', () => ({ requireProjectSession: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { source: 'live', stale: false, feedNow: '2026-10-06T14:02:00Z', depots: [] },
    error: null,
  }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: (): URLSearchParams => new URLSearchParams() }));
vi.mock('@/hooks/useDepotRoutes', async (original) => ({
  ...(await original<typeof import('@/hooks/useDepotRoutes')>()),
  useDepotRoutes: (): unknown => state.routes,
}));
vi.mock('@/hooks/useDepotAllocation', () => ({ useDepotAllocation: (): unknown => state.allocation }));

const LINE =
  'Routes and the buses on them are LIVE; stops, terminals and dead kilometres a trip, from ' +
  'the route-details feed and inferred depot positions, are DERIVED';
const MODELLED_PART = 'trips a day and the daily dead kilometres built on them are MODELLED.';

const text = (markup: string): string =>
  markup.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

function provenanceLine(markup: string): { readonly tone: string | null; readonly words: string } {
  const start = markup.indexOf('data-testid="depot-provenance-line"');
  const open = markup.lastIndexOf('<', start);
  const tone = /data-tone="([a-z]+)"/.exec(markup.slice(open, markup.indexOf('>', start)))?.[1] ?? null;
  const end = markup.indexOf('</p>', start);
  return { tone, words: text(markup.slice(open, end)) };
}

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await DepotRoutesPage());
}

describe('the routes page provenance line in every state', () => {
  beforeEach(() => {
    state.routes = slot({ data: ROUTES_FIXTURE });
    state.allocation = slot({ data: PLAN_FIXTURE });
  });

  const STATES: readonly (readonly [string, () => void])[] = [
    ['loading', () => {
      state.routes = slot({ loading: true });
      state.allocation = slot({ loading: true });
    }],
    ['error', () => {
      state.routes = slot({ error: 'Depot data is unavailable.' });
      state.allocation = slot({ error: 'Depot data is unavailable.' });
    }],
    ['empty', () => {
      state.routes = slot({ data: { ...ROUTES_FIXTURE, routes: [], total: 0, inFeed: 0 } });
    }],
    ['data', () => {}],
  ];

  it.each(STATES)('is MIXED and names the live, derived and modelled parts when %s', async (_, set) => {
    set();
    const markup = await renderPage();
    const line = provenanceLine(markup);
    // every string the page draws in this state, attributes (title, aria-label) included
    expect(markup.toLowerCase()).not.toContain('simulated');
    expect(line.tone).toBe('mixed');
    expect(line.words).toContain(LINE);
    expect(line.words).toContain(MODELLED_PART);
  });

  it('tags the modelled plan section and the modelled trips column on the visible page', async () => {
    const markup = await renderPage();
    const plan = markup.slice(markup.indexOf('id="allocation-title"'));
    // The label row: the heading, then its tag, before the row's closing tag.
    expect(plan.slice(0, plan.indexOf('</div>'))).toMatch(/data-provenance="modelled"/);
    const tripsHeader = markup.slice(markup.indexOf('Trips/day'), markup.indexOf('</th>', markup.indexOf('Trips/day')));
    expect(tripsHeader).toContain('data-provenance="modelled"');
  });

  it('tags the dead-km column DERIVED, the same word the line uses, once a route has a figure', async () => {
    const withDeadKm = {
      ...ROUTES_FIXTURE,
      routes: ROUTES_FIXTURE.routes.map((r) => ({
        ...r,
        deadKm: { depotId: '1', depotPosition: 'yard' as const, provenance: 'derived' as const,
          perTripKm: 12.4, outKm: 6.2, inKm: 6.2, firstStopUsed: 'A', lastStopUsed: 'B', approximated: false },
      })),
    };
    state.routes = slot({ data: withDeadKm });
    const markup = await renderPage();
    const at = markup.indexOf('Dead km/trip');
    expect(at).toBeGreaterThan(-1);
    expect(markup.slice(at, markup.indexOf('</th>', at))).toContain('data-provenance="derived"');
  });
});
