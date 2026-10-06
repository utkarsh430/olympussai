'use client';

import { useMemo, useRef, useState } from 'react';
import { TableOverflowCue, useColumnsToTheRight } from '@/components/depot/shell/TableOverflowCue';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import {
  emptyRowText,
  type EconomicsFilters,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import { sortRows, type SortDirection } from '@/lib/depot/tableSort';
import { COLUMNS, content } from './EconomicsCells';

/* The economics table, on the shared `depot-table` classes; its cells are in EconomicsCells. */

interface Sort {
  readonly key: string;
  readonly direction: SortDirection;
}

export interface EconomicsGridProps {
  readonly rows: readonly EconomicsRow[];
  /** Every row before filtering, and the filters, so an empty table can say why. */
  readonly allRows: readonly EconomicsRow[];
  readonly filters: EconomicsFilters;
  readonly selectedId: string | null;
  readonly onSelect: (row: EconomicsRow) => void;
}

export function EconomicsGrid({
  rows,
  allRows,
  filters,
  selectedId,
  onSelect,
}: EconomicsGridProps) {
  const [sort, setSort] = useState<Sort | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const moreColumns = useColumnsToTheRight(frame, true);
  const visible = useMemo(() => {
    const column = sort ? COLUMNS.find((c) => c.key === sort.key) : undefined;
    return sort && column ? sortRows(rows, column.sortValue, sort.direction) : rows;
  }, [rows, sort]);
  const toggle = (key: string): void =>
    setSort((s) => ({ key, direction: s?.key === key && s.direction === 'asc' ? 'desc' : 'asc' }));

  if (visible.length === 0) {
    return <StatePanel kind="empty" sentence={emptyRowText(allRows, filters)} />;
  }
  return (
    <div className="relative min-w-0">
      <div
        ref={frame}
        role="region"
        aria-label="Depot economics ranking"
        tabIndex={0}
        className="depot-table-frame"
      >
        <table className="depot-table depot-table-fixed">
          <caption className="sr-only">Depot Economics Index ranking within peer groups</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = sort?.key === c.key ? sort.direction : null;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      active === null ? 'none' : active === 'asc' ? 'ascending' : 'descending'
                    }
                    className={`${c.className} ${c.className.includes('sticky') ? '!z-20' : ''} ${c.right ? 'depot-align-right' : ''}`}
                  >
                    <button
                      type="button"
                      className="depot-sort-button"
                      onClick={() => toggle(c.key)}
                    >
                      {c.header}
                      <span aria-hidden className="inline-block w-3 text-holo-glow">
                        {active === null ? '' : active === 'asc' ? '↑' : '↓'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const selected = row.depotId === selectedId;
              return (
                <tr
                  key={row.depotId}
                  className={`depot-row-selectable group ${selected ? 'depot-row-selected' : ''}`}
                >
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={`whitespace-nowrap ${c.className} ${c.right ? 'depot-align-right' : ''} ${
                        c.className.includes('sticky')
                          ? `${selected ? 'bg-depot-raised' : 'bg-depot-page'} group-hover:bg-depot-raised`
                          : ''
                      }`}
                    >
                      {content(c, row, selected, onSelect)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {moreColumns ? <TableOverflowCue /> : null}
    </div>
  );
}
