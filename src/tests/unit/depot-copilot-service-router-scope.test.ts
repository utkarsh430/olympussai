import { describe, expect, it } from 'vitest';
import { scriptedRoute } from '@/lib/depot/copilot/router/scriptedRouter';

/**
 * "This depot": a question asked from a depot's page is about that depot when
 * it names none. The scope only fills a gap; it never overrides a named depot
 * and never turns a network or ranking question into a depot one.
 */

const DEPOTS = [
  { id: '101', name: 'KANPUR' },
  { id: '102', name: 'ETAWAH' },
  { id: '105', name: 'GORAKHPUR' },
] as const;

describe('scriptedRoute with a scope depot', () => {
  it.each([
    ['Give me a summary of this depot.', { kind: 'depotSummary', depotId: '102' }],
    ['What exceptions does this depot have?', { kind: 'exceptionsFor', depotId: '102' }],
    ['Any exceptions?', { kind: 'exceptionsFor', depotId: '102' }],
    ['Which transfers are proposed?', { kind: 'transfersFor', depotId: '102' }],
    ['How punctual are departures here?', { kind: 'outshedStatus', depotId: '102' }],
    ['Status of this depot', { kind: 'depotSummary', depotId: '102' }],
    ['Compare this depot with Kanpur', { kind: 'compareDepots', depotA: '102', depotB: '101' }],
  ] as const)('routes %j to the scope depot', (question, expected) => {
    expect(scriptedRoute(question, DEPOTS, '102')).toEqual(expected);
  });

  it('keeps a depot the question names', () => {
    expect(scriptedRoute('Exceptions at Kanpur', DEPOTS, '102')).toEqual({
      kind: 'exceptionsFor',
      depotId: '101',
    });
  });

  it('leaves network and ranking questions alone', () => {
    expect(scriptedRoute('Give me a network overview', DEPOTS, '102')).toEqual({
      kind: 'networkSummary',
    });
    expect(scriptedRoute('Which five depots rank highest?', DEPOTS, '102')).toMatchObject({
      kind: 'rankDepots',
    });
    expect(scriptedRoute('Which depots are short of buses?', DEPOTS, '102')).toEqual({
      kind: 'depotsInDeficit',
    });
  });

  it('still declines questions about people', () => {
    expect(scriptedRoute('Which drivers at this depot are late?', DEPOTS, '102')).toEqual({
      kind: 'unsupported',
    });
  });

  it('ignores a scope depot that is not in the list', () => {
    for (const question of ['Give me a summary of this depot.', 'Any exceptions?']) {
      expect(scriptedRoute(question, DEPOTS, '999')).toEqual(scriptedRoute(question, DEPOTS));
    }
    expect(scriptedRoute('Any exceptions?', DEPOTS, '999')).toEqual({ kind: 'unsupported' });
  });

  it('declines "this depot" with no scope, as before', () => {
    expect(scriptedRoute('What exceptions does this depot have?', DEPOTS)).toEqual({
      kind: 'unsupported',
    });
  });
});
