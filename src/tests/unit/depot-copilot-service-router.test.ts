import { describe, expect, it } from 'vitest';
import { copilotQuerySchema, type CopilotQuery } from '@/lib/depot/copilot/queries';
import { hourOf } from '@/lib/depot/copilot/router/hours';
import { findRoute } from '@/lib/depot/copilot/router/resolveRoute';
import { scriptedRoute } from '@/lib/depot/copilot/router/scriptedRouter';

const DEPOTS = [
  { id: '101', name: 'KANPUR' },
  { id: '102', name: 'ETAWAH' },
  { id: '103', name: 'AGRA CANTT' },
] as const;
const ROUTES = ['VND_1613_ORD_OUT', 'LKO_204_EXP_IN', 'R-77'] as const;

const route = (question: string, scope?: string): CopilotQuery =>
  scriptedRoute(question, DEPOTS, scope, ROUTES);

describe('hourOf', () => {
  it.each([
    ['at 10am', 10],
    ['at 10 am', 10],
    ['at 10:00', 10],
    ['at 10:45', 10],
    ['after 6 pm', 18],
    ['after 6pm', 18],
    ['at 18:00', 18],
    ['at 12 am', 0],
    ['at 12 pm', 12],
    ['at midnight', 0],
    ['at noon', 12],
    ['short at 10', 10],
    ['around 7', 7],
    ['at 0:30', 0],
  ] as const)('reads %j as %i', (text, hour) => {
    expect(hourOf(text)).toBe(hour);
  });

  it.each(['at 25:00', 'at 13 pm', 'at 0 am', 'top 5 depots', 'depot 101', 'at 10:75', 'now'])(
    'reads no hour in %j',
    (text) => {
      expect(hourOf(text)).toBeNull();
    },
  );
});

describe('findRoute', () => {
  it('matches a route as the feed spells it, in any case', () => {
    expect(findRoute('why is vnd_1613_ord_out short', ROUTES)).toMatchObject({
      found: 'known',
      routeName: 'VND_1613_ORD_OUT',
    });
    expect(findRoute('how is route r-77 doing', ROUTES)).toMatchObject({
      found: 'known',
      routeName: 'R-77',
    });
  });

  it('says unknown for a route-shaped token the snapshot does not carry', () => {
    expect(findRoute('why is route abc_999 short', ROUTES)).toEqual({ found: 'unknown' });
    expect(findRoute('how is route 42 doing', ROUTES)).toEqual({ found: 'unknown' });
  });

  it('finds nothing in a question that names no route', () => {
    expect(findRoute('which routes are over-served after 6 pm', ROUTES)).toEqual({ found: 'none' });
    expect(findRoute('how is the route doing', ROUTES)).toEqual({ found: 'none' });
  });
});

describe('service question shapes', () => {
  it.each([
    ['Why is route VND_1613_ORD_OUT short at 10?', { kind: 'routeHour', routeName: 'VND_1613_ORD_OUT', hour: 10 }],
    ['why is vnd_1613_ord_out short at 10am', { kind: 'routeHour', routeName: 'VND_1613_ORD_OUT', hour: 10 }],
    ['route VND_1613_ORD_OUT at 10 am', { kind: 'routeHour', routeName: 'VND_1613_ORD_OUT', hour: 10 }],
    ['VND_1613_ORD_OUT at 18:00', { kind: 'routeHour', routeName: 'VND_1613_ORD_OUT', hour: 18 }],
    ['how many buses on LKO_204_EXP_IN at 6 pm', { kind: 'routeHour', routeName: 'LKO_204_EXP_IN', hour: 18 }],
    ['LKO_204_EXP_IN at midnight', { kind: 'routeHour', routeName: 'LKO_204_EXP_IN', hour: 0 }],
    ['LKO_204_EXP_IN at noon', { kind: 'routeHour', routeName: 'LKO_204_EXP_IN', hour: 12 }],
    ['How is route VND_1613_ORD_OUT doing today?', { kind: 'routeProposals', routeName: 'VND_1613_ORD_OUT' }],
    ['what should change on LKO_204_EXP_IN', { kind: 'routeProposals', routeName: 'LKO_204_EXP_IN' }],
    ['What should depot Kanpur change this evening?', { kind: 'hourProposals', hour: 16, depotId: '101' }],
    ['what should etawah change this morning', { kind: 'hourProposals', hour: 6, depotId: '102' }],
    ['Which routes are over-served after 6 pm?', { kind: 'hourProposals', hour: 18 }],
    ['which routes are short at 10:00', { kind: 'hourProposals', hour: 10 }],
    ['which routes are under served at 7am', { kind: 'hourProposals', hour: 7 }],
    ['What is the plan for today?', { kind: 'serviceBrief' }],
    ["today's plan", { kind: 'serviceBrief' }],
    ['the daily brief', { kind: 'serviceBrief' }],
    ['service brief please', { kind: 'serviceBrief' }],
  ] as const)('routes %j', (question, expected) => {
    const query = route(question);
    expect(query).toEqual(expected);
    expect(copilotQuerySchema.safeParse(query).success).toBe(true);
  });

  it('answers a route question about the route when a depot is named too', () => {
    expect(route('how is VND_1613_ORD_OUT from kanpur doing at 10am')).toEqual({
      kind: 'routeHour',
      routeName: 'VND_1613_ORD_OUT',
      hour: 10,
    });
    expect(route('what should kanpur change on VND_1613_ORD_OUT')).toEqual({
      kind: 'routeProposals',
      routeName: 'VND_1613_ORD_OUT',
    });
  });

  it('refuses a route the snapshot does not carry with the unknown-route reason', () => {
    expect(route('why is route ABC_999_X short at 10')).toEqual({
      kind: 'unsupported',
      reason: 'unknown_route',
    });
  });

  it('uses the asking depot only when the question says this depot', () => {
    expect(route('what should this depot change this evening', '102')).toEqual({
      kind: 'hourProposals',
      hour: 16,
      depotId: '102',
    });
    expect(route('which routes are short this evening', '102')).toEqual({
      kind: 'hourProposals',
      hour: 16,
    });
  });

  it('still declines a person question that names a route', () => {
    expect(route('who drives VND_1613_ORD_OUT at 10')).toEqual({
      kind: 'unsupported',
      reason: 'people',
    });
  });

  it('leaves the depot questions as they were', () => {
    expect(route('how is kanpur doing')).toEqual({ kind: 'depotSummary', depotId: '101' });
    expect(route('top 3 depots by dark buses')).toEqual({
      kind: 'rankDepots',
      metric: 'dark',
      order: 'top',
      limit: 3,
    });
    expect(route('network summary')).toEqual({ kind: 'networkSummary' });
    expect(route('compare kanpur and etawah')).toEqual({
      kind: 'compareDepots',
      depotA: '101',
      depotB: '102',
    });
  });

  it('routes without a route list as before', () => {
    expect(scriptedRoute('how is kanpur doing', DEPOTS)).toEqual({
      kind: 'depotSummary',
      depotId: '101',
    });
    expect(scriptedRoute('why is route VND_1613_ORD_OUT short at 10', DEPOTS)).toEqual({
      kind: 'unsupported',
      reason: 'unknown_route',
    });
  });
});
