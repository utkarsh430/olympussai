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
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;
const SELECT_KEYS: ReadonlySet<string> = new Set(['Enter', ' ']);

function nextSort(current: TableSort | null, key: string): TableSort {
  if (current?.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: 'asc' };
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
}: DataTableProps<T>) {
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null);

  const sortColumn = sort ? columns.find((column) => column.key === sort.key) : undefined;
  const visibleRows = useMemo(() => {
    if (!sort || !sortColumn?.sortValue) return rows;
    return sortRows(rows, sortColumn.sortValue, sort.direction);
  }, [rows, sort, sortColumn]);

  const selectable = onRowSelect !== undefined;

  return (
    <div
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
                      onClick={() => setSort((current) => nextSort(current, column.key))}
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
          {visibleRows.map((row) => {
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
                  selectable
                    ? `depot-row-selectable ${selected ? 'depot-row-selected' : ''}`
                    : undefined
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
          })}
        </tbody>
      </table>
    </div>
  );
}
