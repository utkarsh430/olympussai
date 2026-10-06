import { describe, expect, it } from 'vitest';
import { answerScopeLabel, answerTableView } from '@/lib/depot/copilot/ui/answerLayout';
import type { CopilotFactView } from '@/lib/depot/copilot/wire';

/*
 * Round 2 (ask, rulings 7 to 9): the scope chip shows the scope the answer used; the
 * evidence table puts units in headers with bare right-aligned numbers, and a column whose
 * figures are generated carries MODELLED (guard X8).
 */
describe('answerScopeLabel', () => {
  it('shows the scope the answer used, not the form', () => {
    expect(answerScopeLabel({ kind: 'network' }, 'KAUSHAMBI')).toBe('Whole network');
    expect(answerScopeLabel({ kind: 'depot', depotId: '7', depotName: 'KAUSHAMBI' }, 'Whole network')).toBe(
      'KAUSHAMBI',
    );
    expect(
      answerScopeLabel(
        {
          kind: 'depots',
          depots: [
            { depotId: '7', depotName: 'KAUSHAMBI' },
            { depotId: '8', depotName: 'GARH' },
          ],
        },
        'Whole network',
      ),
    ).toBe('KAUSHAMBI and GARH');
  });
  it('falls back to the form for a declined question (no answer scope)', () => {
    expect(answerScopeLabel(undefined, 'Whole network')).toBe('Whole network');
  });
});

function fact(id: string, text: string, provenance: CopilotFactView['provenance']): CopilotFactView {
  return { id, label: id, text, provenance };
}

describe('answerTableView', () => {
  const shortBy = {
    columns: ['Depot', 'Short by'],
    rows: [
      ['GARH', '9 buses'],
      ['KHURJA', '1 bus'],
    ],
  };

  it('puts the unit in the header and bare numbers right-aligned in the cells', () => {
    const view = answerTableView(shortBy, []);
    expect(view.columns[1]).toMatchObject({ header: 'Short by', unit: 'buses', align: 'right' });
    expect(view.columns[0]).toMatchObject({ header: 'Depot', unit: null, align: 'left' });
    expect(view.rows).toEqual([
      ['GARH', '9'],
      ['KHURJA', '1'],
    ]);
  });

  it('tags a column MODELLED when its figures rest on generated facts', () => {
    const facts = [
      fact('list.1.name', 'GARH', 'live'),
      fact('list.1.size', '9 buses', 'modelled'),
      fact('list.2.name', 'KHURJA', 'live'),
      fact('list.2.size', '1 bus', 'modelled'),
    ];
    const view = answerTableView(shortBy, facts);
    expect(view.columns[1]?.tag).toBe('modelled');
    expect(view.columns[0]?.tag).toBeNull();
  });

  it('leaves a computed column untagged and keeps a unitless figure as it is', () => {
    const table = { columns: ['Depot', 'Efficiency index'], rows: [['GARH', '37.2']] };
    const view = answerTableView(table, [fact('rank.1.value', '37.2', 'derived')]);
    expect(view.columns[1]).toMatchObject({ unit: null, align: 'right', tag: null });
    expect(view.rows).toEqual([['GARH', '37.2']]);
  });
});
