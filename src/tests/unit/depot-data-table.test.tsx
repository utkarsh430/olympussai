import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataTable, useTableSort, type Column } from '@/components/depot/shell/DataTable';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

interface Row {
  readonly id: string;
  readonly n: number;
  readonly label: string;
}

const ROWS: readonly Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: `r${i + 1}`,
  n: i + 1,
  label: `L${30 - i}`,
}));

const N: Column<Row> = { key: 'n', header: 'N', sortValue: (r) => r.n, render: (r) => `n${r.n}` };
const LABEL: Column<Row> = {
  key: 'label',
  header: 'Label',
  sortValue: (r) => r.label,
  render: (r) => r.label,
};
const BOTH: readonly Column<Row>[] = [N, LABEL];
const ONLY_N: readonly Column<Row>[] = [N];
const DEFAULT = { key: 'n', direction: 'desc' } as const;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function bodyTexts(): string[] {
  return Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');
}

function click(el: Element | null): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

function out(id: string): string | null | undefined {
  return container.querySelector(`[data-testid="${id}"]`)?.textContent;
}

describe('DataTable maxRows', () => {
  it('caps after its own sort, so the cap shows the top of the sorted order', () => {
    act(() =>
      root.render(
        <DataTable
          columns={BOTH}
          rows={ROWS}
          rowKey={(r) => r.id}
          caption="t"
          initialSort={DEFAULT}
          maxRows={3}
        />,
      ),
    );
    expect(bodyTexts()).toEqual(['n30L1', 'n29L2', 'n28L3']);
  });

  it('keeps the selected row visible after the capped rows and says it is outside them', () => {
    act(() =>
      root.render(
        <DataTable
          columns={BOTH}
          rows={ROWS}
          rowKey={(r) => r.id}
          caption="t"
          initialSort={DEFAULT}
          maxRows={3}
          selectedKey="r1"
          onRowSelect={() => undefined}
        />,
      ),
    );
    const texts = bodyTexts();
    expect(texts).toHaveLength(5);
    expect(texts[3]).toBe('Selected row, outside the first 3');
    expect(texts[4]).toBe('n1L30');
    expect(container.querySelector('tr[aria-selected="true"]')?.textContent).toBe('n1L30');
  });

  it('adds no extra row when the selected row is inside the cap', () => {
    act(() =>
      root.render(
        <DataTable
          columns={BOTH}
          rows={ROWS}
          rowKey={(r) => r.id}
          caption="t"
          initialSort={DEFAULT}
          maxRows={3}
          selectedKey="r30"
        />,
      ),
    );
    expect(bodyTexts()).toHaveLength(3);
  });

  it('puts the id on the scroll region so a toggle can name it in aria-controls', () => {
    act(() =>
      root.render(<DataTable columns={BOTH} rows={ROWS} rowKey={(r) => r.id} caption="t" id="x" />),
    );
    expect(container.querySelector('#x')?.getAttribute('role')).toBe('region');
  });
});

function Host() {
  const [wide, setWide] = useState(true);
  const columns = wide ? BOTH : ONLY_N;
  const tableSort = useTableSort(columns, DEFAULT);
  return (
    <>
      <button type="button" data-testid="toggle" onClick={() => setWide((w) => !w)}>
        toggle
      </button>
      <output data-testid="sort">
        {tableSort.sort ? `${tableSort.sort.key}:${tableSort.sort.direction}` : 'none'}
      </output>
      <output data-testid="default">{String(tableSort.isDefault)}</output>
      <DataTable
        columns={columns}
        rows={ROWS}
        rowKey={(r) => r.id}
        caption="t"
        initialSort={DEFAULT}
        tableSort={tableSort}
        maxRows={2}
      />
    </>
  );
}

describe('useTableSort', () => {
  it('returns to the default sort when the sorted column is no longer among the columns', () => {
    act(() => root.render(<Host />));
    expect(out('default')).toBe('true');
    click(container.querySelectorAll('thead button')[1] ?? null); // sort by Label
    expect(out('sort')).toBe('label:asc');
    expect(out('default')).toBe('false');
    expect(bodyTexts()[0]).toBe('n30L1');

    click(container.querySelector('[data-testid="toggle"]')); // Label column drops
    expect(out('sort')).toBe('n:desc');
    expect(out('default')).toBe('true');
    expect(bodyTexts()).toEqual(['n30', 'n29']);

    click(container.querySelector('[data-testid="toggle"]')); // column returns: no stale sort
    expect(out('sort')).toBe('n:desc');
    expect(out('default')).toBe('true');
  });
});
