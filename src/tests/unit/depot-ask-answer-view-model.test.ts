import { describe, expect, it } from 'vitest';
import { answerScopeLabel, answerTableView, scopeMismatchLine } from '@/lib/depot/copilot/ui/answerLayout';

/*
 * The scope chip shows the scope the answer used; the
 * evidence table puts units in headers with bare right-aligned numbers, and a column whose
 * figures are generated carries MODELLED.
 */
describe('answerScopeLabel', () => {
  it('shows the scope the answer used, not the form', () => {
    expect(answerScopeLabel({ kind: 'network' }, 'KAUSHAMBI')).toBe('Headquarters');
    expect(answerScopeLabel({ kind: 'depot', depotId: '7', depotName: 'KAUSHAMBI' }, 'Headquarters')).toBe(
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
        'Headquarters',
      ),
    ).toBe('KAUSHAMBI and GARH');
  });
  it('falls back to the form for a declined question (no answer scope)', () => {
    expect(answerScopeLabel(undefined, 'Headquarters')).toBe('Headquarters');
  });
});


describe('answerTableView', () => {
  const shortBy = {
    columns: ['Depot', 'Short by'],
    rows: [
      ['GARH', '9 buses'],
      ['KHURJA', '1 bus'],
    ],
  };

  it('puts the unit in the header and bare numbers right-aligned in the cells', () => {
    const view = answerTableView(shortBy);
    expect(view.columns[1]).toMatchObject({ header: 'Short by', unit: 'buses', align: 'right' });
    expect(view.columns[0]).toMatchObject({ header: 'Depot', unit: null, align: 'left' });
    expect(view.rows).toEqual([
      ['GARH', '9'],
      ['KHURJA', '1'],
    ]);
  });

  it('tags a column from the response provenance, whatever the answer text cites', () => {
    // The text cited only the count and the total: no row fact was sent, yet the column
    // the server marks modelled still carries the tag.
    const view = answerTableView({ ...shortBy, provenance: [null, 'modelled'] });
    expect(view.columns[1]?.tag).toBe('modelled');
    expect(view.columns[0]?.tag).toBeNull();
  });

  it('never tags a column by matching its cells to the facts the text used', () => {
    const view = answerTableView({ ...shortBy, provenance: [null, 'derived'] });
    expect(view.columns.map((c) => c.tag)).toEqual([null, null]);
  });

  it('leaves a computed column untagged and keeps a unitless figure as it is', () => {
    const table = {
      columns: ['Depot', 'Efficiency index'],
      rows: [['GARH', '37.2']],
      provenance: [null, 'derived'] as const,
    };
    const view = answerTableView(table);
    expect(view.columns[1]).toMatchObject({ unit: null, align: 'right', tag: null });
    expect(view.rows).toEqual([['GARH', '37.2']]);
  });
});

describe('scopeMismatchLine', () => {
  const network = { depotId: null, label: 'Headquarters' };
  it('says so when the answer was about a depot while the form is on headquarters', () => {
    expect(
      scopeMismatchLine({ kind: 'depot', depotId: '49', depotName: 'KAUSHAMBI' }, network),
    ).toBe('The last answer was about KAUSHAMBI; the form is set to headquarters.');
  });
  it('is silent when the answer and the form agree', () => {
    expect(scopeMismatchLine({ kind: 'network' }, network)).toBeNull();
    expect(
      scopeMismatchLine(
        { kind: 'depot', depotId: '49', depotName: 'KAUSHAMBI' },
        { depotId: '49', label: 'KAUSHAMBI' },
      ),
    ).toBeNull();
    expect(scopeMismatchLine(undefined, network)).toBeNull();
  });
  it('names headquarters when the form is on a depot', () => {
    expect(scopeMismatchLine({ kind: 'network' }, { depotId: '8', label: 'GARH' })).toBe(
      'The last answer was about headquarters; the form is set to GARH.',
    );
  });
});
