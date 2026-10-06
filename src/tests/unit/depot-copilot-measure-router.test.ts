import { describe, expect, it } from 'vitest';
import { copilotQuerySchema, type CopilotQuery } from '@/lib/depot/copilot/queries';
import { scriptedRoute } from '@/lib/depot/copilot/router/scriptedRouter';
import { interpretQuery } from '@/lib/depot/copilot/service/interpret';

/**
 * Round 8 A: a question for ONE measure at a named depot is that measure at that
 * depot, not the depot's summary (browser capture: "How many buses are dark at
 * KAUSHAMBI right now?" was understood as "A summary of KAUSHAMBI").
 */
const DEPOTS = [
  { id: '49', name: 'KAUSHAMBI' },
  { id: '101', name: 'KANPUR' },
  { id: '150', name: 'NOIDA' },
  { id: '157', name: 'NOIDA ELECTRIC' },
  { id: '60', name: 'MEERUT CITY' },
  { id: '61', name: 'MEERUT ROAD' },
] as const;

const nameOf = (id: string): string => DEPOTS.find((d) => d.id === id)?.name ?? id;
const m = (depotId: string, measure: string): CopilotQuery =>
  copilotQuerySchema.parse({ kind: 'depotMeasure', depotId, measure });

const TABLE: readonly (readonly [string, CopilotQuery, string])[] = [
  ['How many buses are dark at KAUSHAMBI right now?', m('49', 'dark'), 'Buses that are dark at KAUSHAMBI'],
  ['how many buses are dark at kaushambi', m('49', 'dark'), 'Buses that are dark at KAUSHAMBI'],
  ['Kaushambi: how many dark buses right now?', m('49', 'dark'), 'Buses that are dark at KAUSHAMBI'],
  ['Dark buses at Kanpur', m('101', 'dark'), 'Buses that are dark at KANPUR'],
  ['How many buses are off the road at Kanpur?', m('101', 'offRoad'), 'Buses that are off the road at KANPUR'],
  ['kanpur off road buses right now', m('101', 'offRoad'), 'Buses that are off the road at KANPUR'],
  ['How many buses have main power off at Kaushambi?', m('49', 'powerCut'), 'Buses with main power off at KAUSHAMBI'],
  ['Kanpur: power off right now?', m('101', 'powerCut'), 'Buses with main power off at KANPUR'],
  ['How many buses are in the yard at Kanpur right now?', m('101', 'inYard'), 'Buses in the yard at KANPUR'],
  ['kaushambi buses in yard', m('49', 'inYard'), 'Buses in the yard at KAUSHAMBI'],
  ['How many buses are on the road at Kanpur?', m('101', 'onRoad'), 'Buses on the road at KANPUR'],
  ['Kaushambi on road right now', m('49', 'onRoad'), 'Buses on the road at KAUSHAMBI'],
  ['How many buses are standing at Kanpur?', m('101', 'standing'), 'Buses standing at KANPUR'],
  ['kaushambi standing buses right now', m('49', 'standing'), 'Buses standing at KAUSHAMBI'],
  ['What is the fleet size of Kanpur?', m('101', 'fleet'), 'The fleet size of KANPUR'],
  ['How many buses does Kaushambi have?', m('49', 'fleet'), 'The fleet size of KAUSHAMBI'],
  ['What is the efficiency index of Kanpur?', m('101', 'index'), 'The efficiency index of KANPUR'],
  ['kaushambi index right now', m('49', 'index'), 'The efficiency index of KAUSHAMBI'],
  ['What rank is Kanpur?', m('101', 'rank'), 'The rank of KANPUR among its peers'],
  ['Kaushambi ranking', m('49', 'rank'), 'The rank of KAUSHAMBI among its peers'],
  ['How many visiting buses are at Kanpur?', m('101', 'visitors'), 'Visiting buses in the yard at KANPUR'],
  ['kaushambi visitors right now', m('49', 'visitors'), 'Visiting buses in the yard at KAUSHAMBI'],
  // A depot name that is the prefix of another's.
  ['How many buses are dark at Noida?', m('150', 'dark'), 'Buses that are dark at NOIDA'],
  ['How many buses are dark at Noida Electric?', m('157', 'dark'), 'Buses that are dark at NOIDA ELECTRIC'],
  ['noida electric on the road', m('157', 'onRoad'), 'Buses on the road at NOIDA ELECTRIC'],
  // Unclear or unknown depots keep the calm refusals.
  [
    'How many buses are dark at Meerut?',
    { kind: 'unsupported', reason: 'ambiguous_depot' },
    'A question outside what can be answered here',
  ],
  [
    'How many buses are dark at Atlantis right now?',
    { kind: 'unsupported', reason: 'out_of_scope' },
    'A question outside what can be answered here',
  ],
  // No depot: the network.
  ['How many buses are dark right now?', { kind: 'networkSummary' }, 'A summary of the whole network'],
  ['how many buses are off the road', { kind: 'networkSummary' }, 'A summary of the whole network'],
  ['How many buses are on the road?', { kind: 'networkSummary' }, 'A summary of the whole network'],
  // Unchanged: a summary, a ranking and a list stay what they were.
  ['Tell me about Kaushambi', { kind: 'depotSummary', depotId: '49' }, 'A summary of KAUSHAMBI'],
  [
    'Which depots have the most dark buses?',
    { kind: 'rankDepots', metric: 'dark', order: 'top', limit: 5 },
    'Depots by dark rate, highest first, up to 5',
  ],
];

describe('round 8 A: one measure at a named depot', () => {
  it('has at least thirty phrasings', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(30);
  });

  it.each(TABLE)('%s', (question, query, understood) => {
    const routed = scriptedRoute(question, DEPOTS);
    expect(routed).toEqual(query);
    expect(copilotQuerySchema.safeParse(routed).success).toBe(true);
    expect(interpretQuery(routed, nameOf)).toBe(understood);
  });

  it('asked from a depot, a measure with no depot named is about that depot', () => {
    expect(scriptedRoute('How many buses are dark right now?', DEPOTS, '49')).toEqual(
      m('49', 'dark'),
    );
    expect(scriptedRoute('How many buses are dark across the network?', DEPOTS, '49')).toEqual({
      kind: 'networkSummary',
    });
  });

  it('a named depot is never displaced by the depot the question was asked from', () => {
    expect(scriptedRoute('How many buses are dark at Kanpur?', DEPOTS, '49')).toEqual(
      m('101', 'dark'),
    );
  });

  it('refuses a measure the catalogue does not know', () => {
    expect(
      copilotQuerySchema.safeParse({ kind: 'depotMeasure', depotId: '49', measure: 'fuel' })
        .success,
    ).toBe(false);
  });
});
