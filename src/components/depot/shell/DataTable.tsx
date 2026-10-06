'use client';

import { Fragment, useId, useMemo, useRef, useState } from 'react';
import { sortRows, type SortDirection, type SortValue } from '@/lib/depot/tableSort';
import { useExpandedRows } from './RowExpander';
import { cellLayout, DataTableRow, EXPAND_KEY, type FrozenColumns } from './DataTableRow';
import { EXPANDER_WIDTH_PX, frozenColumnCount, frozenLefts } from './tableLayout';
import { TableOverflowCue, useColumnsToTheRight } from './TableOverflowCue';
import type { Provenance } from '@/lib/depot/types';
import { ProvenanceBadge } from './ProvenanceBadge';
import { groupCounts, groupLabel, groupRows, type TableGrouping } from './tableGroups';

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
  /**
   * Makes rows selectable by click and by Enter / Space; each such row ends in one muted
   * chevron on hover and focus, so no boxed per-row button is needed.
   */
  readonly onRowSelect?: (row: T) => void;
  /**
   * What a row that is its own control is called ("Bus UP13CT7020"); the accessible name
   * adds what Enter does. The first column's text, or the row key, by default.
   */
  readonly rowLabel?: (row: T) => string;
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
  /**
   * Freeze the first column while the frame scrolls sideways (a wide table); with an
   * expander, the 24px chevron column and the first data column both stay.
   */
  readonly freezeFirstColumn?: boolean;
  /** Fade the right edge and say "more columns" while columns are hidden to the right. */
  readonly overflowCue?: boolean;
  /**
   * A row expander: a chevron in a 24px FIRST column, and the whole row as the control
   * (click, Enter or Space), opens this content in a full-width row beneath. Return null
   * for a row with nothing to show. One row open at a time unless `multipleExpanded`.
   */
  readonly renderExpanded?: (row: T) => React.ReactNode | null;
  /** The expander button's accessible name for a row; "Show details" by default. */
  readonly expandLabel?: (row: T) => string;
  readonly multipleExpanded?: boolean;
  /** A row that is open on first render (a link that lands on one row's detail). */
  readonly initialExpandedKey?: string;
  /**
   * With `onExpandedChange`: the page holds which one row is open (null for none), so a
   * control elsewhere on the page can open a row. The table reports the wish to change it.
   */
  readonly expandedKey?: string | null;
  readonly onExpandedChange?: (key: string | null) => void;
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

/** A group row's words: the page's own label, or "<group> · <count>" and the optional aside. */
function groupRowText<T>(group: TableGrouping<T>, key: string, count: number): string {
  if (group.label) return group.label(key, count);
  return groupLabel(key, count, group.aside?.(key, count));
}

/** A header's label, then its unit ("EARNINGS ₹/KM") in the faint tone. */
function HeaderText<T>({ column }: { readonly column: Column<T> }) {
  if (!column.unit) return <>{column.header}</>;
  return (
    <>
      {column.header} <span className="text-depot-faint">{column.unit}</span>
    </>
  );
}
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
  expandedKey,
  onExpandedChange,
  group,
  rowLabel,
}: DataTableProps<T>) {
  const autoId = useId();
  const expanded = useExpandedRows(
    multipleExpanded,
    initialExpandedKey,
    onExpandedChange ? { key: expandedKey ?? null, onChange: onExpandedChange } : undefined,
  );
  const tableKey = id ?? autoId;
  const shownColumns = useMemo<readonly Column<T>[]>(() => {
    if (!renderExpanded) return columns;
    // Its cell is drawn by DataTableRow; this entry gives the header and the column count.
    const expander: Column<T> = {
      key: EXPAND_KEY,
      header: 'Details',
      width: EXPANDER_WIDTH_PX,
      render: () => null,
    };
    return [expander, ...columns];
  }, [columns, renderExpanded]);
  const hasExpander = renderExpanded !== undefined;
  const frozen: FrozenColumns = freezeFirstColumn
    ? { count: frozenColumnCount(hasExpander), lefts: frozenLefts(hasExpander) }
    : { count: 0, lefts: [] };
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
    return (
      <DataTableRow
        key={key}
        row={row}
        rowKey={key}
        tableKey={tableKey}
        columns={shownColumns}
        frozen={frozen}
        fixedRows={fixedRows}
        onRowSelect={onRowSelect}
        selected={selectable ? key === selectedKey : undefined}
        expanded={expanded}
        renderExpanded={renderExpanded}
        expandLabel={expandLabel}
        rowLabel={rowLabel}
      />
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
            {shownColumns.map((column, index) => {
              const active = column.sortValue && sort?.key === column.key ? sort : null;
              const layout = cellLayout(column, index, frozen);
              const width = column.width;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sortValue ? (active ? ARIA_SORT[active.direction] : 'none') : undefined
                  }
                  className={layout.className}
                  style={width === undefined && !layout.style ? undefined : { ...layout.style, width }}
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
                    <span className="depot-tag-row ml-1.5 inline-flex align-top">
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
                      {groupRowText(group, g.key, counts.get(g.key) ?? g.rows.length)}
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
