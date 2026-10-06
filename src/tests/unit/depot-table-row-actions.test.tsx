import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';

interface Row {
  readonly id: string;
  readonly group: string;
  readonly why: string | null;
}

const ROWS: readonly Row[] = [
  { id: 'a', group: 'Standing', why: 'Bus off road.' },
  { id: 'b', group: 'Standing', why: null },
];
const COLUMNS: readonly Column<Row>[] = [
  { key: 'id', header: 'Bus', render: (r) => r.id },
  { key: 'link', header: 'Where', render: (r) => <a href={`#${r.id}`}>Go {r.id}</a> },
];
const expand = (r: Row): React.ReactNode | null => (r.why === null ? null : <span>{r.why}</span>);

afterEach(cleanup);

function classes(element: Element | null | undefined): readonly string[] {
  return (element?.getAttribute('class') ?? '').split(/\s+/);
}

const bodyRows = (): HTMLTableRowElement[] => [
  ...document.querySelectorAll<HTMLTableRowElement>('tbody tr'),
];

describe('the expander column', () => {
  it('is the first column, 24px wide, with its header read to screen readers only', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="t" renderExpanded={expand} />);
    const headers = [...document.querySelectorAll('thead th')];
    expect(headers.map((th) => th.textContent)).toEqual(['Details', 'Bus', 'Where']);
    expect(classes(headers[0])).toContain('depot-cell-expander');
    expect((headers[0] as HTMLElement).style.width).toBe('24px');
    expect(classes(bodyRows()[0]?.cells[0])).toContain('depot-cell-expander');
  });

  it('freezes the chevron column and the first data column, the second offset by 24px', () => {
    render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="t" renderExpanded={expand} freezeFirstColumn />,
    );
    for (const row of [document.querySelector('thead tr')!, ...bodyRows()]) {
      const cells = [...row.children] as HTMLElement[];
      expect(cells.slice(0, 2).map((c) => c.style.left)).toEqual(['', '24px']);
      expect(cells.slice(0, 2).every((c) => classes(c).includes('depot-cell-frozen'))).toBe(true);
      expect(classes(cells[1])).toContain('depot-cell-frozen-edge');
      expect(classes(cells[0])).not.toContain('depot-cell-frozen-edge');
      expect(classes(cells[2])).not.toContain('depot-cell-frozen');
    }
  });

  it('freezes only the first column, at 0, when there is no expander', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="t" freezeFirstColumn />);
    const cells = [...(bodyRows()[0]?.cells ?? [])];
    expect(cells[0]?.getAttribute('style')).toBeNull();
    expect(classes(cells[0])).toEqual(expect.arrayContaining(['depot-cell-frozen', 'depot-cell-frozen-edge']));
    expect(classes(cells[1])).not.toContain('depot-cell-frozen');
  });
});

describe('a row with an expander', () => {
  it('is the control: one tab stop, named, toggled by a click anywhere and by Enter or Space', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="t" renderExpanded={expand} />);
    const [row, plain] = bodyRows();
    expect(row?.tabIndex).toBe(0);
    expect(row?.getAttribute('aria-label')).toBe('a, show details');
    expect(row?.getAttribute('aria-expanded')).toBe('false');
    expect(within(row!).getByRole('button', { name: 'Show details' }).tabIndex).toBe(-1);
    expect(plain?.hasAttribute('tabindex')).toBe(false);
    expect(plain?.hasAttribute('aria-label')).toBe(false);

    fireEvent.click(row!.cells[1]!);
    expect(screen.getByTestId('depot-table-expanded').textContent).toBe('Bus off road.');
    expect(bodyRows()[0]?.getAttribute('aria-label')).toBe('a, hide details');
    fireEvent.keyDown(bodyRows()[0]!, { key: 'Enter' });
    expect(screen.queryByTestId('depot-table-expanded')).toBeNull();
    fireEvent.keyDown(bodyRows()[0]!, { key: ' ' });
    expect(screen.getByTestId('depot-table-expanded')).toBeTruthy();
  });

  it('leaves a link inside the row to the link', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="t" renderExpanded={expand} />);
    fireEvent.click(screen.getByRole('link', { name: 'Go a' }));
    expect(screen.queryByTestId('depot-table-expanded')).toBeNull();
  });
});

describe('a row that opens something', () => {
  it('is named, opens on click, Enter and Space, and ends in one muted chevron', () => {
    const onSelect = vi.fn();
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="t" onRowSelect={onSelect} />);
    const row = bodyRows()[0]!;
    expect(row.getAttribute('aria-label')).toBe('a, open');
    expect(classes(row)).toContain('depot-row-selectable');
    const chevrons = row.querySelectorAll('.depot-row-chevron');
    expect(chevrons).toHaveLength(1);
    expect(row.cells[row.cells.length - 1]?.contains(chevrons[0]!)).toBe(true);
    expect(chevrons[0]?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(row.cells[0]!);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it('takes its name from rowLabel when the page gives one', () => {
    render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="t" onRowSelect={() => {}} rowLabel={(r) => `Bus ${r.id}`} />,
    );
    expect(bodyRows()[0]?.getAttribute('aria-label')).toBe('Bus a, open');
  });
});

describe('the group row', () => {
  it('prints a third part after the count when the grouping has an aside', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        caption="t"
        group={{ key: (r) => r.group, aside: () => '1 listed' }}
      />,
    );
    expect(screen.getByTestId('depot-table-group').textContent).toBe('Standing · 2 · 1 listed');
  });
});
