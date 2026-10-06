'use client';

import { useMemo, useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { EconomicsRow } from '@/lib/depot/revenue/economicsPageModel';
import { sortRows, type SortDirection } from '@/lib/depot/tableSort';
import { COLUMNS, content } from './EconomicsCells';

/* The economics table, on the shared `depot-table` classes; its cells are in EconomicsCells. */

interface Sort {
  readonly key: string;
  readonly direction: SortDirection;
}

export interface EconomicsGridProps {
  readonly rows: readonly EconomicsRow[];
  readonly selectedId: string | null;
  readonly onSelect: (row: EconomicsRow) => void;
}

export function EconomicsGrid({ rows, selectedId, onSelect }: EconomicsGridProps) {
  const [sort, setSort] = useState<Sort | null>(null);
  const visible = useMemo(() => {
    const column = sort ? COLUMNS.find((c) => c.key === sort.key) : undefined;
    return sort && column ? sortRows(rows, column.sortValue, sort.direction) : rows;
  }, [rows, sort]);
  const toggle = (key: string): void =>
    setSort((s) => ({ key, direction: s?.key === key && s.direction === 'asc' ? 'desc' : 'asc' }));

  return (
    <div
      role="region"
      aria-label="Depot economics ranking, modelled"
      tabIndex={0}
      className="depot-table-frame"
    >
      <table className="depot-table">
        <caption className="px-2 py-2 text-left">
          <span className="depot-label mr-2">Depot Economics Index ranking within peer groups</span>
          <ProvenanceBadge provenance="modelled" />
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((c) => {
              const active = sort?.key === c.key ? sort.direction : null;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active === null ? 'none' : active === 'asc' ? 'ascending' : 'descending'}
                  className={`${c.className} ${c.className.includes('sticky') ? '!z-20' : ''} ${c.right ? 'depot-align-right' : ''}`}
                >
                  <button type="button" className="depot-sort-button" onClick={() => toggle(c.key)}>
                    {c.header}
                    {c.modelledTag ? <span className="ml-1 text-alert-amber">MODELLED</span> : null}
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
          {visible.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className="depot-prose !py-6">
                No depots match. Turn on Show unranked or clear the search.
              </td>
            </tr>
          ) : null}
          {visible.map((row) => {
            const selected = row.depotId === selectedId;
            return (
              <tr
                key={row.depotId}
                aria-selected={selected}
                className={`group depot-row-selectable ${selected ? 'depot-row-selected' : ''}`}
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
  );
}
