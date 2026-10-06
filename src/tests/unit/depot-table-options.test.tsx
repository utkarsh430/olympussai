import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { hasColumnsToTheRight } from '@/lib/depot/tableOverflow';

afterEach(cleanup);

interface Row {
  readonly id: string;
  readonly name: string;
  readonly km: number;
}

const COLUMNS: readonly Column<Row>[] = [
  { key: 'name', header: 'Depot', render: (r) => r.name, sortValue: (r) => r.name },
  { key: 'km', header: 'Distance (km)', align: 'right', render: (r) => <b>{r.km}</b> },
];
const ROWS: readonly Row[] = [
  { id: 'a', name: 'A very long depot name that truncates', km: 12 },
  { id: 'b', name: 'B', km: 3 },
];

describe('hasColumnsToTheRight', () => {
  it('is true only while the frame can still scroll right', () => {
    expect(hasColumnsToTheRight({ scrollLeft: 0, clientWidth: 500, scrollWidth: 900 })).toBe(true);
    expect(hasColumnsToTheRight({ scrollLeft: 400, clientWidth: 500, scrollWidth: 900 })).toBe(false);
    expect(hasColumnsToTheRight({ scrollLeft: 0, clientWidth: 500, scrollWidth: 501 })).toBe(false);
  });
});

describe('DataTable options', () => {
  it('changes nothing by default', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="Depots" />);
    const table = screen.getByRole('table');
    expect(table.className).toBe('depot-table');
    expect(screen.getAllByRole('cell')[0]?.getAttribute('title')).toBeNull();
    expect(screen.queryByTestId('depot-table-more-columns')).toBeNull();
  });

  it('applies fixed rows with the full text in title, and the frozen column', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        caption="Depots"
        fixedRows
        freezeFirstColumn
        maxRows={1}
      />,
    );
    expect(screen.getByRole('table').className).toBe('depot-table depot-table-fixed depot-table-frozen');
    const [first, second] = screen.getAllByRole('cell');
    expect(first?.getAttribute('title')).toBe('A very long depot name that truncates');
    expect(second?.getAttribute('title')).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('keeps sorting working with the options on', () => {
    render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="Depots" fixedRows />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Depot/ }));
    fireEvent.click(screen.getByRole('button', { name: /Depot/ }));
    expect(screen.getAllByRole('cell')[0]?.textContent).toBe('B');
  });

  it('shows "more columns" while the frame can scroll right and removes it at the end', () => {
    render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="Depots" overflowCue />,
    );
    const frame = screen.getByTestId('depot-table');
    Object.defineProperty(frame, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(frame, 'scrollWidth', { value: 700, configurable: true });
    act(() => {
      fireEvent.scroll(frame);
    });
    const cue = screen.getByTestId('depot-table-more-columns');
    expect(cue.textContent).toBe('more columns');
    // The words sit at the header's edge, never over a body row's values.
    expect(cue.className).toContain('items-start');
    expect(cue.className).not.toContain('items-end');
    act(() => {
      frame.scrollLeft = 400;
      fireEvent.scroll(frame);
    });
    expect(screen.queryByTestId('depot-table-more-columns')).toBeNull();
  });
});
