import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { groupCounts, groupRows } from '@/components/depot/shell/tableGroups';

afterEach(cleanup);

interface Row {
  readonly id: string;
  readonly group: string;
  readonly score: number;
}

const ROWS: readonly Row[] = [
  { id: 'PRAYAG', group: 'Small fleets', score: 72 },
  { id: 'MEERUT', group: 'Large fleets', score: 60 },
  { id: 'DHAMPUR', group: 'Small fleets', score: 70 },
];

const COLUMNS: readonly Column<Row>[] = [
  { key: 'id', header: 'Depot', render: (row) => row.id },
  { key: 'score', header: 'Score', sortValue: (row) => row.score, render: (row) => row.score },
];

describe('groupRows', () => {
  it('keeps first-appearance group order and the rows own order', () => {
    const groups = groupRows(ROWS, (row) => row.group);
    expect(groups.map((g) => g.key)).toEqual(['Small fleets', 'Large fleets']);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(['PRAYAG', 'DHAMPUR']);
  });

  it('counts every row of a group', () => {
    expect(groupCounts(ROWS, (row) => row.group).get('Small fleets')).toBe(2);
  });
});

describe('DataTable group option', () => {
  function table(maxRows?: number): void {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        caption="Depots"
        maxRows={maxRows}
        group={{ key: (row) => row.group }}
      />,
    );
  }

  it('prints the repeated value once as a group row with its count', () => {
    table();
    const groups = screen.getAllByTestId('depot-table-group');
    expect(groups.map((row) => row.textContent)).toEqual(['Small fleets · 2', 'Large fleets · 1']);
    const order = screen.getAllByRole('row').map((row) => row.textContent);
    expect(order.slice(1)).toEqual(['Small fleets · 2', 'PRAYAG72', 'DHAMPUR70', 'Large fleets · 1', 'MEERUT60']);
  });

  it('regroups when the sort changes', () => {
    table();
    fireEvent.click(screen.getByRole('button', { name: /Score/ }));
    const order = screen.getAllByRole('row').map((row) => row.textContent);
    expect(order.slice(1)).toEqual(['Large fleets · 1', 'MEERUT60', 'Small fleets · 2', 'DHAMPUR70', 'PRAYAG72']);
  });

  it('counts the whole group even when the table is capped', () => {
    table(1);
    expect(screen.getAllByTestId('depot-table-group').map((row) => row.textContent)).toEqual([
      'Small fleets · 2',
    ]);
  });
});
