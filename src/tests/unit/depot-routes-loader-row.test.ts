import { describe, expect, it } from 'vitest';
import {
  LOADER_COST_LINE,
  defaultLoaderDepot,
  loadButtonTitle,
  loaderDepotLabel,
  loaderDepots,
  planRowSentence,
} from '@/lib/depot/routes/loaderRow';
import { EMPTY_PLAN_FIXTURE } from './depot-routes.fixtures';

const OPTIONS = [
  { value: '1', label: 'AGRA' },
  { value: '2', label: 'BIJNOR' },
  { value: '3', label: 'CHANDPUR' },
];
const SUMMARIES = [
  { id: '1', assigned: 40 },
  { id: '2', assigned: 84 },
  { id: '3', assigned: 1 },
];

describe('the loader row', () => {
  it('lists depots by buses on routes, most first, and defaults to the first', () => {
    const depots = loaderDepots(OPTIONS, SUMMARIES);
    expect(depots.map((d) => d.label)).toEqual(['BIJNOR', 'AGRA', 'CHANDPUR']);
    expect(defaultLoaderDepot(depots, null)).toBe('2');
    expect(loaderDepotLabel(depots[0]!)).toBe('BIJNOR · 84 on routes');
  });

  it('defaults to the depot scope from the URL when that depot runs a route', () => {
    const depots = loaderDepots(OPTIONS, SUMMARIES);
    expect(defaultLoaderDepot(depots, '3')).toBe('3');
    expect(defaultLoaderDepot(depots, '99')).toBe('2');
  });

  it('keeps name order, without counts, before the network feed has answered', () => {
    const depots = loaderDepots(OPTIONS, []);
    expect(depots.map((d) => d.label)).toEqual(['AGRA', 'BIJNOR', 'CHANDPUR']);
    expect(loaderDepotLabel(depots[0]!)).toBe('AGRA');
    expect(defaultLoaderDepot([], null)).toBe('');
  });

  it('says why nothing can be planned, in one sentence', () => {
    expect(planRowSentence(EMPTY_PLAN_FIXTURE)).toBe(
      "No route can be planned yet: no route's details have been loaded.",
    );
    const some = { ...EMPTY_PLAN_FIXTURE, coverage: { ...EMPTY_PLAN_FIXTURE.coverage, profiled: { n: 3, of: 9 } } };
    expect(planRowSentence(some)).toBe(
      'No route can be planned yet: none of the 3 routes with details loaded can be measured from a depot.',
    );
  });

  it('states the cost of a press in the title and the muted line', () => {
    expect(loadButtonTitle('BIJNOR', 12)).toBe(
      'Looks up 12 routes of BIJNOR on the route-details service: one lookup per route, one at a time, at most 40 a press.',
    );
    expect(LOADER_COST_LINE).toBe('One lookup on the route-details service per route, one at a time');
  });
});
