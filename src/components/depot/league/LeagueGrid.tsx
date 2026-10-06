'use client';

import { useMemo, useState } from 'react';
import { formatCount } from '@/lib/depot/format';
import { PEER_GROUP_LABEL, type LeagueRow } from '@/lib/depot/league/leagueModel';
import { DEI_COMPONENTS } from '@/lib/depot/score/config';
import type { DeiComponentKey, PeerGroupId } from '@/lib/depot/score/types';
import { sortRows, type SortDirection, type SortValue } from '@/lib/depot/tableSort';
import { DepotCell, IndexCell, MetricCell } from './LeagueCells';

/*
 * The league's own table markup, on the shared `depot-table` classes: the
 * shared DataTable cannot freeze columns or drop them by width. Rank, Depot
 * and Index stay put while the rest scrolls sideways inside the frame. Below
 * `lg` the set is deliberately reduced to Rank, Depot, Index and On-road
 * share; the breakdown of a selected depot carries the other measures.
 */

const PEER_GROUP_SORT: Readonly<Record<PeerGroupId, number>> = { small: 0, medium: 1, large: 2, all: 3 };
/** Sticky offsets add up the frozen widths before each column. */
const FROZEN = {
  rank: 'sticky left-0 z-[5] w-14 min-w-14',
  depot: 'sticky left-14 z-[5] w-52 min-w-52 max-w-52',
  index: 'sticky left-[16.5rem] z-[5] border-r border-r-depot-line lg:w-36 lg:min-w-36',
} as const;
const WIDE_ONLY = 'hidden lg:table-cell';
const ALWAYS_SHOWN: ReadonlySet<DeiComponentKey> = new Set(['onRoad']);

interface LeagueColumn {
  readonly key: string;
  readonly header: string;
  readonly title?: string;
  readonly className: string;
  readonly right?: boolean;
  readonly sortValue: (row: LeagueRow) => SortValue;
}

function componentOf(row: LeagueRow, key: DeiComponentKey) {
  return row.components.find((c) => c.key === key);
}

function columnsFor(showPeerGroup: boolean): readonly LeagueColumn[] {
  return [
    { key: 'rank', header: 'Rank', className: FROZEN.rank, right: true, sortValue: (r) => r.rank },
    { key: 'depot', header: 'Depot', className: FROZEN.depot, sortValue: (r) => r.name },
    {
      key: 'index',
      header: 'Index',
      title: 'Efficiency index, 0 to 100. A typical peer scores 50; the tick on the bar marks 50.',
      className: FROZEN.index,
      sortValue: (r) => r.index,
    },
    ...(showPeerGroup
      ? [{
          key: 'peerGroup',
          header: 'Peer group',
          className: WIDE_ONLY,
          sortValue: (r: LeagueRow) => (r.peerGroup === null ? null : PEER_GROUP_SORT[r.peerGroup]),
        }]
      : []),
    ...DEI_COMPONENTS.map((c) => ({
      key: c.key,
      header: c.label,
      title: `${c.label}: the depot's value and its difference from the peer median. ${
        c.higherIsBetter ? 'Higher is better.' : 'Lower is better.'
      }`,
      className: ALWAYS_SHOWN.has(c.key) ? '' : WIDE_ONLY,
      right: true,
      sortValue: (r: LeagueRow) => componentOf(r, c.key)?.value ?? null,
    })),
    { key: 'fleet', header: 'Fleet', className: WIDE_ONLY, right: true, sortValue: (r) => r.fleet },
  ];
}

function cellContent(column: LeagueColumn, row: LeagueRow, selected: boolean, onSelect: (row: LeagueRow) => void) {
  switch (column.key) {
    case 'rank':
      return row.rank ?? '—';
    case 'depot':
      return <DepotCell row={row} selected={selected} onSelect={onSelect} />;
    case 'index':
      return <IndexCell row={row} />;
    case 'peerGroup':
      return row.peerGroup === null ? '—' : PEER_GROUP_LABEL[row.peerGroup];
    case 'fleet':
      return formatCount(row.fleet);
    default:
      return <MetricCell cell={componentOf(row, column.key as DeiComponentKey)} />;
  }
}

interface Sort {
  readonly key: string;
  readonly direction: SortDirection;
}

export interface LeagueGridProps {
  readonly rows: readonly LeagueRow[];
  readonly showPeerGroup: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (row: LeagueRow) => void;
}

export function LeagueGrid({ rows, showPeerGroup, selectedId, onSelect }: LeagueGridProps) {
  const [sort, setSort] = useState<Sort | null>(null);
  const columns = useMemo(() => columnsFor(showPeerGroup), [showPeerGroup]);
  const sortColumn = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const visible = useMemo(
    () => (sort && sortColumn ? sortRows(rows, sortColumn.sortValue, sort.direction) : rows),
    [rows, sort, sortColumn],
  );
  const toggle = (key: string): void =>
    setSort((s) => ({ key, direction: s?.key === key && s.direction === 'asc' ? 'desc' : 'asc' }));

  return (
    <div role="region" aria-label="Depot league table" tabIndex={0} className="depot-table-frame">
      <table className="depot-table">
        <caption className="sr-only">Depot league table</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key ? sort.direction : null;
              return (
                <th
                  key={c.key}
                  scope="col"
                  title={c.title}
                  aria-sort={active === null ? 'none' : active === 'asc' ? 'ascending' : 'descending'}
                  className={`${c.className} ${c.className.includes('sticky') ? '!z-20' : ''} ${c.right ? 'depot-align-right' : ''}`}
                >
                  <button type="button" className="depot-sort-button" onClick={() => toggle(c.key)}>
                    {c.header}
                    <span aria-hidden className="inline-block w-3 text-holo-glow">
                      {active === null ? '' : active === 'asc' ? '↑' : '↓'}
                    </span>
                  </button>
                  {c.title ? <span className="sr-only">{c.title}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="depot-prose !py-6">
                No depots match these filters. Try a different peer group or turn on Show unranked.
              </td>
            </tr>
          ) : null}
          {visible.map((row) => {
            const selected = row.depotId === selectedId;
            return (
              <tr
                key={row.depotId}
                aria-selected={selected}
                onClick={() => onSelect(row)}
                className={`group depot-row-selectable ${selected ? 'depot-row-selected' : ''}`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`whitespace-nowrap ${c.className} ${c.right ? 'depot-align-right' : ''} ${
                      c.className.includes('sticky')
                        ? `${selected ? 'bg-depot-raised' : 'bg-depot-page'} group-hover:bg-depot-raised`
                        : ''
                    }`}
                  >
                    {cellContent(c, row, selected, onSelect)}
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
