import { describe, expect, it } from 'vitest';
import type { DepotNetworkResponse } from '@/lib/depot/api';
import { buildAnswer } from '@/lib/depot/copilot/facts/answers';
import { copilotQuerySchema, UNKNOWN_ROUTE_QUERY } from '@/lib/depot/copilot/queries';
import { renderDraft } from '@/lib/depot/copilot/render';
import { interpretQuery } from '@/lib/depot/copilot/service/interpret';

const ok = (value: unknown): boolean => copilotQuerySchema.safeParse(value).success;

describe('service query kinds', () => {
  it('accepts a route and an hour of the day', () => {
    expect(ok({ kind: 'routeHour', routeName: 'VND_1613_ORD_OUT', hour: 10 })).toBe(true);
    expect(ok({ kind: 'routeHour', routeName: 'VND_1613_ORD_OUT', hour: 0 })).toBe(true);
    expect(ok({ kind: 'routeHour', routeName: 'VND_1613_ORD_OUT', hour: 23 })).toBe(true);
  });

  it('refuses an hour outside the day, a fraction or a malformed route name', () => {
    expect(ok({ kind: 'routeHour', routeName: 'R_1', hour: 24 })).toBe(false);
    expect(ok({ kind: 'routeHour', routeName: 'R_1', hour: -1 })).toBe(false);
    expect(ok({ kind: 'routeHour', routeName: 'R_1', hour: 10.5 })).toBe(false);
    expect(ok({ kind: 'routeHour', routeName: 'R 1; drop', hour: 10 })).toBe(false);
    expect(ok({ kind: 'routeProposals', routeName: '' })).toBe(false);
    expect(ok({ kind: 'routeProposals', routeName: 'x'.repeat(65) })).toBe(false);
  });

  it('accepts a route day, an hour with or without a depot, and the brief with or without a date', () => {
    expect(ok({ kind: 'routeProposals', routeName: 'R_1' })).toBe(true);
    expect(ok({ kind: 'hourProposals', hour: 16 })).toBe(true);
    expect(ok({ kind: 'hourProposals', hour: 16, depotId: '101' })).toBe(true);
    expect(ok({ kind: 'serviceBrief' })).toBe(true);
    expect(ok({ kind: 'serviceBrief', date: '2026-10-06' })).toBe(true);
  });

  it('is strict: no extra key, no bad depot, no malformed date', () => {
    expect(ok({ kind: 'routeProposals', routeName: 'R_1', hour: 3 })).toBe(false);
    expect(ok({ kind: 'hourProposals', hour: 16, depotId: 'not a depot' })).toBe(false);
    expect(ok({ kind: 'serviceBrief', date: '6 Oct' })).toBe(false);
  });

  it('has an unknown-route refusal', () => {
    expect(ok(UNKNOWN_ROUTE_QUERY)).toBe(true);
    expect(UNKNOWN_ROUTE_QUERY).toEqual({ kind: 'unsupported', reason: 'unknown_route' });
  });
});

describe('the unknown-route refusal', () => {
  const network = { depots: [] } as unknown as DepotNetworkResponse;

  it('is a fixed sentence that passes the draft rules and names no route', () => {
    const request = buildAnswer(UNKNOWN_ROUTE_QUERY, { network });
    expect(request.facts).toEqual([]);
    expect(request.scriptedDraft.headline).toBe('That route is not in the current feed');
    expect(renderDraft(request.scriptedDraft, request.facts).ok).toBe(true);
    expect(interpretQuery(UNKNOWN_ROUTE_QUERY, (id) => id)).toBe(
      'A route that is not in the current feed',
    );
  });

  it('interprets the service kinds without echoing the question', () => {
    const name = (id: string): string => (id === '101' ? 'KANPUR' : id);
    expect(interpretQuery({ kind: 'routeHour', routeName: 'R_1', hour: 6 }, name)).toBe(
      'Route R_1 at 06:00',
    );
    expect(interpretQuery({ kind: 'hourProposals', hour: 16, depotId: '101' }, name)).toBe(
      'Routes of KANPUR short and over-served around 16:00',
    );
    expect(interpretQuery({ kind: 'serviceBrief' }, name)).toBe("The day's service brief");
  });
});
