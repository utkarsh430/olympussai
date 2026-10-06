'use client';

import { Fragment, useId, useMemo, useRef, useState } from 'react';
import { sortRows, type SortDirection, type SortValue } from '@/lib/depot/tableSort';
import { ExpandToggle, expandedRowId, useExpandedRows } from './RowExpander';
import { TableOverflowCue, useColumnsToTheRight } from './TableOverflowCue';
import type { Provenance } from '@/lib/depot/types';
import { ProvenanceBadge } from './ProvenanceBadge';
import { groupCounts, groupLabel, groupRows, type TableGrouping } from './tableGroups';

const EXPAND_KEY = '__expand';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly align?: 'left' | 'right';
  /** Makes the column sortable. Return null for "unknown"; nulls sort last. */
  readonly sortValue?: (row: T) => SortValue;
  readonly render: (row: T) => React.ReactNode;
  readonly width?: number | string;
  /** Full text for a cell that may truncate (`fixedRows`); a string `render` result is used when absent. */
  readonly title?: (row: T) => string | undefined;
  /** Shown after the header ("EARNINGS ₹/KM"), so cells carry bare numbers. */
  readonly unit?: string;
  /**
   * Only when this column's provenance differs from the page's provenance line: a pill in
   * the header cell, after the label. Never a tag in a cell.
   */
  readonly tag?: Provenance;
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
  /** Rulings table rows: a constant 36px, cells never wrap (truncated, full text in `title`). */
  readonly fixedRows?: boolean;
  /** Freeze the first column while the frame scrolls sideways (a wide table). */
  readonly freezeFirstColumn?: boolean;
  /** Fade the right edge and say "more columns" while columns are hidden to the right. */
  readonly overflowCue?: boolean;
  /**
   * A row expander: a disclosure button in its own narrow column (after the first, so a
   * frozen first column still names the row) opens this content in a full-width row
   * beneath. Return null for a row with nothing to show. One row open at a time unless
   * `multipleExpanded`.
   */
  readonly renderExpanded?: (row: T) => React.ReactNode | null;
  /** The expander button's accessible name for a row; "Show details" by default. */
  readonly expandLabel?: (row: T) => string;
  readonly multipleExpanded?: boolean;
  /** A row that is open on first render (a link that lands on one row's detail). */
  readonly initialExpandedKey?: string;
  /**
   * Print a repeated column (peer group, status, severity) once, as a group row with its
   * count, instead of on every row; drop that column from `columns`. Groups follow the
   * sorted order (the group of the first row comes first).
   */
  readonly group?: TableGrouping<T>;
}

export interface TableSortState {
  /** The sort in force; null when the table is unsorted. */
  readonly sort: TableSort | null;
  /** True when `sort` is the default the table started with. */
  readonly isDefault: boolean;
  readonly setSort: (next: TableSort) => void;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

/** A header's label, then its unit ("EARNINGS ₹/KM") in the faint tone. */
function HeaderText<T>({ column }: { readonly column: Column<T> }) {
  if (!column.unit) return <>{column.header}</>;
  return (
    <>
      {column.header} <span className="text-depot-faint">{column.unit}</span>
    </>
  );
}
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
  fixedRows = false,
  freezeFirstColumn = false,
  overflowCue = false,
  renderExpanded,
  expandLabel,
  multipleExpanded = false,
  initialExpandedKey,
  group,
}: DataTableProps<T>) {
  const autoId = useId();
  const expanded = useExpandedRows(multipleExpanded, initialExpandedKey);
  const tableKey = id ?? autoId;
  const shownColumns = useMemo<readonly Column<T>[]>(() => {
    if (!renderExpanded) return columns;
    const expander: Column<T> = {
      key: EXPAND_KEY,
      header: 'Details',
      width: '2.25rem',
      render: (row) => {
        if (renderExpanded(row) === null) return null;
        const key = rowKey(row);
        return (
          <ExpandToggle
            open={expanded.isOpen(key)}
            controls={expandedRowId(tableKey, key)}
            label={expandLabel?.(row) ?? 'Show details'}
            onToggle={() => expanded.toggle(key)}
          />
        );
      },
    };
    return [...columns.slice(0, 1), expander, ...columns.slice(1)];
  }, [columns, renderExpanded, expandLabel, expanded, rowKey, tableKey]);
  const frame = useRef<HTMLDivElement>(null);
  const moreColumns = useColumnsToTheRight(frame, overflowCue);
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
  const counts = useMemo(
    () => (group ? groupCounts(sortedRows, group.key) : null),
    [group, sortedRows],
  );

  const renderRow = (row: T) => {
    const key = rowKey(row);
    const selected = selectable ? key === selectedKey : undefined;
    const detail = renderExpanded && expanded.isOpen(key) ? renderExpanded(row) : null;
    return (
      <Fragment key={key}>
        <tr
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
          {shownColumns.map((column) => {
            const content = column.render(row);
            const title = fixedRows
              ? (column.title?.(row) ?? (typeof content === 'string' ? content : undefined))
              : undefined;
            return (
              <td
                key={column.key}
                title={title}
                className={column.align === 'right' ? 'depot-align-right' : undefined}
              >
                {content}
              </td>
            );
          })}
        </tr>
        {detail === null ? null : (
          <tr data-testid="depot-table-expanded">
            <td
              id={expandedRowId(tableKey, key)}
              colSpan={shownColumns.length}
              className="!h-auto !max-w-none !whitespace-normal !py-3"
            >
              <div className="depot-prose max-w-[62ch]">{detail}</div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const tableClass = [
    'depot-table',
    fixedRows ? 'depot-table-fixed' : '',
    freezeFirstColumn ? 'depot-table-frozen' : '',
  ].join(' ');
  const scroller = (
    <div
      ref={frame}
      id={id}
      role="region"
      aria-label={caption}
      tabIndex={0}
      data-testid="depot-table"
      className="depot-table-frame"
    >
      <table className={tableClass.trim()}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {shownColumns.map((column) => {
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
                      <HeaderText column={column} />
                      <span aria-hidden className="inline-block w-3 text-holo-glow">
                        {active ? (active.direction === 'asc' ? '↑' : '↓') : ''}
                      </span>
                    </button>
                  ) : column.key === EXPAND_KEY ? (
                    <span className="sr-only">{column.header}</span>
                  ) : (
                    <HeaderText column={column} />
                  )}
                  {column.tag ? (
                    <span className="ml-1.5 inline-block align-middle">
                      <ProvenanceBadge provenance={column.tag} pill />
                    </span>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 && emptyMessage ? (
            <tr>
              <td colSpan={shownColumns.length} className="depot-prose !py-6">
                {emptyMessage}
              </td>
            </tr>
          ) : null}
          {group && counts
            ? groupRows(visibleRows, group.key).map((g) => (
                <Fragment key={`group-${g.key}`}>
                  <tr data-testid="depot-table-group">
                    <th scope="colgroup" colSpan={shownColumns.length} className="depot-table-group">
                      {(group.label ?? groupLabel)(g.key, counts.get(g.key) ?? g.rows.length)}
                    </th>
                  </tr>
                  {g.rows.map(renderRow)}
                </Fragment>
              ))
            : visibleRows.map(renderRow)}
          {outsideRow !== undefined ? (
            <>
              <tr>
                <td colSpan={shownColumns.length} className="depot-prose !py-2">
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
  if (!overflowCue) return scroller;
  // The cue sits on a non-scrolling wrapper so it stays at the frame's right edge.
  return (
    <div className="relative min-w-0">
      {scroller}
      {moreColumns ? <TableOverflowCue /> : null}
    </div>
  );
}
