'use client';

import { useMemo, useState } from 'react';
import { sortRows, type SortDirection, type SortValue } from '@/lib/depot/tableSort';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly align?: 'left' | 'right';
  /** Makes the column sortable. Return null for "unknown"; nulls sort last. */
  readonly sortValue?: (row: T) => SortValue;
  readonly render: (row: T) => React.ReactNode;
  readonly width?: number | string;
}

export interface TableSort {
  readonly key: string;
  readonly direction: SortDirection;
}

export interface DataTableProps<T> {
  /** Define at module level or memoise: a new array each render re-sorts every render. */
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  /** Screen-reader name for the table and its scroll region. */
  readonly caption: string;
  readonly initialSort?: TableSort;
  /** Makes rows selectable by click and by Enter / Space. */
  readonly onRowSelect?: (row: T) => void;
  readonly selectedKey?: string;
  /** Shown inside the table frame, under the header, when there are no rows. */
  readonly emptyMessage?: string;
  /** Id of the scroll region, so a toggle elsewhere can name it in `aria-controls`. */
  readonly id?: string;
  /**
   * Shows only the first N rows of the sorted order. A selected row beyond the
   * cap is kept, after the capped rows, and marked in words.
   */
  readonly maxRows?: number;
  /** Lifted sort state, for a parent that must say what order the rows are in. */
  readonly tableSort?: TableSortState;
}

export interface TableSortState {
  /** The sort in force; null when the table is unsorted. */
  readonly sort: TableSort | null;
  /** True when `sort` is the default the table started with. */
  readonly isDefault: boolean;
  readonly setSort: (next: TableSort) => void;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;
const SELECT_KEYS: ReadonlySet<string> = new Set(['Enter', ' ']);

function nextSort(current: TableSort | null, key: string): TableSort {
  if (current?.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: 'asc' };
}

function sortable(columns: readonly Column<unknown>[], sort: TableSort | null): boolean {
  return sort !== null && columns.some((c) => c.key === sort.key && c.sortValue !== undefined);
}

/**
 * Sort state that returns to the default when the sorted column leaves the
 * column set (a filter drops it, or the viewport does), so the table never sits
 * in an order that no header shows.
 */
export function useTableSort<T>(
  columns: readonly Column<T>[],
  initialSort?: TableSort,
): TableSortState {
  const [chosen, setChosen] = useState<TableSort | null>(null);
  const cols = columns as readonly Column<unknown>[];
  const chosenValid = sortable(cols, chosen);
  if (chosen !== null && !chosenValid) setChosen(null);
  const fallback = sortable(cols, initialSort ?? null) ? (initialSort ?? null) : null;
  const sort = chosenValid ? chosen : fallback;
  return { sort, isDefault: !chosenValid, setSort: setChosen };
}

/**
 * Typed, sortable, accessible table. Real table markup; sortable headers are
 * buttons with `aria-sort` on the `<th>`; the header sticks while the frame
 * scrolls, and the frame (not the page) scrolls sideways. The scroll frame is
 * focusable so keyboard users can scroll it.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  initialSort,
  onRowSelect,
  selectedKey,
  emptyMessage,
  id,
  maxRows,
  tableSort,
}: DataTableProps<T>) {
  const own = useTableSort(columns, initialSort);
  const { sort, setSort } = tableSort ?? own;

  const sortColumn = sort ? columns.find((column) => column.key === sort.key) : undefined;
  const sortedRows = useMemo(() => {
    if (!sort || !sortColumn?.sortValue) return rows;
    return sortRows(rows, sortColumn.sortValue, sort.direction);
  }, [rows, sort, sortColumn]);
  const capped = maxRows !== undefined && sortedRows.length > maxRows;
  const visibleRows = capped ? sortedRows.slice(0, maxRows) : sortedRows;
  const outsideRow = capped
    ? sortedRows.slice(maxRows).find((row) => rowKey(row) === selectedKey)
    : undefined;

  const selectable = onRowSelect !== undefined;

  const renderRow = (row: T) => {
    const key = rowKey(row);
    const selected = selectable ? key === selectedKey : undefined;
    return (
      <tr
        key={key}
        aria-selected={selected}
        tabIndex={selectable ? 0 : undefined}
        onClick={selectable ? () => onRowSelect(row) : undefined}
        onKeyDown={
          selectable
            ? (event) => {
                // Ignore keys that bubble up from a link or button inside the row.
                if (event.target !== event.currentTarget) return;
                if (!SELECT_KEYS.has(event.key)) return;
                event.preventDefault();
                onRowSelect(row);
              }
            : undefined
        }
        className={
          selectable ? `depot-row-selectable ${selected ? 'depot-row-selected' : ''}` : undefined
        }
      >
        {columns.map((column) => (
          <td
            key={column.key}
            className={column.align === 'right' ? 'depot-align-right' : undefined}
          >
            {column.render(row)}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div
      id={id}
      role="region"
      aria-label={caption}
      tabIndex={0}
      data-testid="depot-table"
      className="depot-table-frame"
    >
      <table className="depot-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = column.sortValue && sort?.key === column.key ? sort : null;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sortValue ? (active ? ARIA_SORT[active.direction] : 'none') : undefined
                  }
                  className={column.align === 'right' ? 'depot-align-right' : undefined}
                  style={column.width !== undefined ? { width: column.width } : undefined}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className="depot-sort-button"
                      onClick={() => setSort(nextSort(sort, column.key))}
                    >
                      {column.header}
                      <span aria-hidden className="inline-block w-3 text-holo-glow">
                        {active ? (active.direction === 'asc' ? '↑' : '↓') : ''}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 && emptyMessage ? (
            <tr>
              <td colSpan={columns.length} className="depot-prose !py-6">
                {emptyMessage}
              </td>
            </tr>
          ) : null}
          {visibleRows.map(renderRow)}
          {outsideRow !== undefined ? (
            <>
              <tr>
                <td colSpan={columns.length} className="depot-prose !py-2">
                  Selected row, outside the first {maxRows}
                </td>
              </tr>
              {renderRow(outsideRow)}
            </>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
