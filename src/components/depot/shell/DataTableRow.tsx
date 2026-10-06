'use client';

import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { ExpandToggle, expandedRowId, type ExpandedRows } from './RowExpander';
import { rowActionName, rowNameText } from './tableLayout';
import type { Column } from './DataTable';

/** The expander column's key: its cell is the chevron, not a page's render. */
export const EXPAND_KEY = '__expand';

const SELECT_KEYS: ReadonlySet<string> = new Set(['Enter', ' ']);
const INTERACTIVE = 'a, button, input, select, textarea, summary, label';

/** Which leading columns stay in place, and where each sticks. */
export interface FrozenColumns {
  readonly count: number;
  readonly lefts: readonly number[];
}

/** Class and inline offset for the cell at `index`, the same for header and body cells. */
export function cellLayout<T>(
  column: Column<T>,
  index: number,
  frozen: FrozenColumns,
): { readonly className: string | undefined; readonly style: React.CSSProperties | undefined } {
  const isFrozen = index < frozen.count;
  const names = [
    column.align === 'right' ? 'depot-align-right' : '',
    column.key === EXPAND_KEY ? 'depot-cell-expander' : '',
    isFrozen ? 'depot-cell-frozen' : '',
    isFrozen && index === frozen.count - 1 ? 'depot-cell-frozen-edge' : '',
  ].filter(Boolean);
  return {
    className: names.length > 0 ? names.join(' ') : undefined,
    // The CSS class sticks a frozen cell at left 0; only a later frozen column needs an offset.
    style: isFrozen && (frozen.lefts[index] ?? 0) > 0 ? { left: `${frozen.lefts[index]}px` } : undefined,
  };
}

export interface DataTableRowProps<T> {
  readonly row: T;
  readonly rowKey: string;
  readonly tableKey: string;
  readonly columns: readonly Column<T>[];
  readonly frozen: FrozenColumns;
  readonly fixedRows: boolean;
  readonly onRowSelect?: (row: T) => void;
  readonly selected?: boolean;
  readonly expanded: ExpandedRows;
  readonly renderExpanded?: (row: T) => React.ReactNode | null;
  readonly expandLabel?: (row: T) => string;
  readonly rowLabel?: (row: T) => string;
}

/** True when a click began on a link or control inside the row: that control handles it. */
function fromInnerControl(event: React.SyntheticEvent): boolean {
  const target = event.target as Element;
  const control = target.closest?.(INTERACTIVE);
  return control !== null && control !== undefined && event.currentTarget.contains(control);
}

/**
 * One body row (design critique round 5): a row that opens something is itself the
 * control. With `onRowSelect` it opens on click, Enter or Space and ends in one muted
 * chevron shown on hover and focus; with an expander (and no `onRowSelect`) the same
 * click and keys open its detail beneath, and the chevron in the first column shows the
 * state. Either way the row takes focus once and carries a name (`rowActionName`).
 */
export function DataTableRow<T>(props: DataTableRowProps<T>) {
  const { row, rowKey: key, tableKey, columns, frozen, fixedRows, onRowSelect, selected } = props;
  const { expanded, renderExpanded, expandLabel, rowLabel } = props;
  const content = renderExpanded ? renderExpanded(row) : null;
  const expandable = content !== null && content !== undefined;
  const open = expandable && expanded.isOpen(key);
  const selectable = onRowSelect !== undefined;
  const rowIsExpander = expandable && !selectable;
  const first = columns.find((column) => column.key !== EXPAND_KEY);
  const name = rowLabel?.(row) ?? rowNameText(first?.render(row), first?.title?.(row), key);
  const act = (): void => (selectable ? onRowSelect(row) : expanded.toggle(key));
  const interactive = selectable || rowIsExpander;

  return (
    <Fragment>
      <tr
        aria-selected={selectable ? selected : undefined}
        aria-label={
          interactive
            ? rowActionName(name, selectable ? { kind: 'open' } : { kind: 'expand', open })
            : undefined
        }
        aria-expanded={rowIsExpander ? open : undefined}
        aria-controls={rowIsExpander && open ? expandedRowId(tableKey, key) : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={
          interactive
            ? (event) => {
                if (!selectable && fromInnerControl(event)) return;
                act();
              }
            : undefined
        }
        onKeyDown={
          interactive
            ? (event) => {
                // Ignore keys that bubble up from a link or button inside the row.
                if (event.target !== event.currentTarget) return;
                if (!SELECT_KEYS.has(event.key)) return;
                event.preventDefault();
                act();
              }
            : undefined
        }
        className={
          interactive ? `depot-row-selectable ${selected ? 'depot-row-selected' : ''}` : undefined
        }
      >
        {columns.map((column, index) => {
          const layout = cellLayout(column, index, frozen);
          const last = index === columns.length - 1;
          if (column.key === EXPAND_KEY) {
            return (
              <td key={column.key} className={layout.className} style={layout.style}>
                {expandable ? (
                  <ExpandToggle
                    open={open}
                    controls={expandedRowId(tableKey, key)}
                    label={expandLabel?.(row) ?? 'Show details'}
                    onToggle={() => expanded.toggle(key)}
                    tabIndex={rowIsExpander ? -1 : undefined}
                  />
                ) : null}
              </td>
            );
          }
          const cell = column.render(row);
          const title = fixedRows
            ? (column.title?.(row) ?? (typeof cell === 'string' ? cell : undefined))
            : undefined;
          return (
            <td key={column.key} title={title} className={layout.className} style={layout.style}>
              {cell}
              {selectable && last ? (
                <ChevronRight aria-hidden className="depot-row-chevron" />
              ) : null}
            </td>
          );
        })}
      </tr>
      {open ? (
        <tr data-testid="depot-table-expanded">
          <td
            id={expandedRowId(tableKey, key)}
            colSpan={columns.length}
            className="!h-auto !max-w-none !whitespace-normal !py-3"
          >
            <div className="depot-prose max-w-[62ch]">{content}</div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
