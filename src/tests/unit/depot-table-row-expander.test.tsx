import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';

interface Row {
  readonly id: string;
  readonly n: number;
  readonly why: string | null;
}

const ROWS: readonly Row[] = [
  { id: 'a', n: 2, why: 'No bus of the class.' },
  { id: 'b', n: 1, why: null },
  { id: 'c', n: 3, why: 'Bus off road.' },
];
const COLUMNS: readonly Column<Row>[] = [
  { key: 'id', header: 'Duty', render: (r) => r.id },
  { key: 'n', header: 'N', render: (r) => String(r.n), sortValue: (r) => r.n },
];
const expand = (r: Row) => (r.why === null ? null : <p>{r.why}</p>);

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;
let container: HTMLElement;

async function mount(node: React.ReactNode): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
}

const toggles = (): HTMLButtonElement[] => [
  ...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'),
];
const expandedRows = (): string[] =>
  [...container.querySelectorAll('[data-testid="depot-table-expanded"]')].map(
    (r) => r.textContent ?? '',
  );

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

describe('DataTable row expander', () => {
  it('opens the row named by initialExpandedKey on first render, so a link can land on an open row', async () => {
    await mount(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        caption="Duties"
        renderExpanded={expand}
        initialExpandedKey="c"
      />,
    );
    expect(expandedRows()).toEqual(['Bus off road.']);
    const open = toggles().filter((b) => b.getAttribute('aria-expanded') === 'true');
    expect(open).toHaveLength(1);
  });

  it('puts the disclosure column first, with a button only where there is content', async () => {
    await mount(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        caption="t"
        renderExpanded={expand}
        fixedRows
        freezeFirstColumn
      />,
    );
    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['Details', 'Duty', 'N']);
    expect(toggles()).toHaveLength(2);
    expect(toggles().every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(expandedRows()).toEqual([]);
  });

  it('opens one row at a time in a full-width row beneath, controlled by its button', async () => {
    await mount(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        caption="t"
        renderExpanded={expand}
      />,
    );
    await act(async () => toggles()[0]?.click());
    expect(expandedRows()).toEqual(['No bus of the class.']);
    const cell = document.getElementById(toggles()[0]?.getAttribute('aria-controls') ?? '');
    expect(cell?.getAttribute('colspan')).toBe('3');
    await act(async () => toggles()[1]?.click());
    expect(expandedRows()).toEqual(['Bus off road.']);
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => toggles()[1]?.click());
    expect(expandedRows()).toEqual([]);
  });

  it('keeps several open when told, and follows the sort', async () => {
    await mount(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        caption="t"
        renderExpanded={expand}
        multipleExpanded
        initialSort={{ key: 'n', direction: 'desc' }}
      />,
    );
    await act(async () => toggles().forEach((b) => b.click()));
    expect(expandedRows()).toEqual(['Bus off road.', 'No bus of the class.']);
  });

  it('does not select the row when its button is pressed, and respects maxRows', async () => {
    const onSelect = vi.fn();
    await mount(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        caption="t"
        renderExpanded={expand}
        onRowSelect={onSelect}
        maxRows={1}
      />,
    );
    expect(toggles()).toHaveLength(1);
    await act(async () => toggles()[0]?.click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(expandedRows()).toEqual(['No bus of the class.']);
  });
});
