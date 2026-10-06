import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DutyPage } from '@/components/depot/duties/DutyPage';
import type { DutyBoardResponse } from '@/lib/depot/duties/api';
import { COST_SENTENCE, MODEL_NOTICE } from '@/lib/depot/duties/dutyBoardModel';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';

const hook = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/hooks/useDepotDuties', () => ({ useDepotDuties: (): unknown => hook.value }));

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
    excluded: { notInYard: 0, offRoad: 0, dark: 0 },
  },
};

function setHook(partial: Record<string, unknown>): void {
  hook.value = { data: null, error: null, loading: false, refresh: () => {}, ...partial };
}

const text = (markup: string): string => markup.replace(/<[^>]*>/g, '');

describe('DutyPage states', () => {
  beforeEach(() => setHook({}));

  it('shows placeholders with the footprint of the board while loading', () => {
    setHook({ loading: true });
    expect(renderToStaticMarkup(<DutyPage depotId="20" />)).toContain(
      'data-testid="duties-loading"',
    );
  });

  it('says a well-formed id is not in the feed, with a way back', () => {
    setHook({ error: DEPOT_NOT_FOUND_MESSAGE });
    const markup = renderToStaticMarkup(<DutyPage depotId="20" />);
    expect(text(markup)).toContain('No depot has the id 20 in the current feed.');
    expect(markup).toContain('href="/project/depots"');
  });

  it('shows what failed and a Retry button', () => {
    setHook({ error: 'Depot data unavailable' });
    const markup = renderToStaticMarkup(<DutyPage depotId="20" />);
    expect(markup).toContain('role="alert"');
    expect(text(markup)).toContain('Retry');
  });

  it('gives an empty board one sentence with its reason, and still the model notice', () => {
    setHook({
      data: {
        ...BASE,
        duties: [],
        routeCount: 0,
        counts: { ...BASE.counts, duties: 0, assigned: 0, spare: 0 },
        spareBuses: [],
        routesWithoutDuty: [],
      },
    });
    const body = text(renderToStaticMarkup(<DutyPage depotId="20" />));
    expect(body).toContain(
      'No duties are modelled for this depot: none of its buses reports a route',
    );
    expect(body).toContain(MODEL_NOTICE);
    expect(body).not.toContain('Duty timeline');
  });

  it('shows the notice, summary, cost sentence, spare buses and routes without a duty', () => {
    setHook({ data: BASE });
    const markup = renderToStaticMarkup(<DutyPage depotId="20" />);
    const body = text(markup);
    expect(body).toContain(MODEL_NOTICE);
    expect(body).toContain('MODELLED: 1 duty.');
    expect(body).toContain(COST_SENTENCE);
    expect(body).toContain('1 bus is in the yard with no duty.');
    expect(body).toContain('1 route has no duty: ORD_2.');
    expect(body).not.toMatch(/simulated/i);
    expect(markup).not.toContain('data-testid="depot-stale"');
  });

  it('puts a stale strip above the board when the feed is stale', () => {
    setHook({ data: { ...BASE, stale: true } });
    expect(renderToStaticMarkup(<DutyPage depotId="20" />)).toContain('data-testid="depot-stale"');
  });
});
