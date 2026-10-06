'use client';

import { useMemo, useRef, useState } from 'react';
import { Pager } from '@/components/depot/shell/LongLists';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { TableOverflowCue, useColumnsToTheRight } from '@/components/depot/shell/TableOverflowCue';
import { formatCount } from '@/lib/depot/format';
import {
  LEAGUE_COMPONENT_ORDER,
  NARROW_COMPONENTS,
  frozenStyles,
  type FrozenKey,
} from '@/lib/depot/league/leagueColumns';
import { PEER_GROUP_LABEL, type LeagueRow } from '@/lib/depot/league/leagueModel';
import { pageRange } from '@/lib/depot/listPaging';
import { DEI_COMPONENTS } from '@/lib/depot/score/config';
import type { DeiComponentKey, PeerGroupId } from '@/lib/depot/score/types';
import { sortRows, type SortDirection, type SortValue } from '@/lib/depot/tableSort';
import { DepotCell, IndexCell, MetricCell } from './LeagueCells';
import * as trend from '@/components/depot/trends/LeagueTrend';

/*
 * The league's own table markup, on the shared `depot-table` classes: the shared
 * DataTable freezes one column, the league freezes three. Rank, Depot and Index are one
 * block whose widths and offsets come from `leagueColumns.ts`; every frozen cell has a
 * solid background and its content boxed to the cell, so nothing shows between or
 * behind the block while the rest scrolls inside the frame. Below `lg` the set is the
 * block plus schedule coverage and device integrity; the breakdown of a selected depot
 * carries the other measures. The table sits in the page flow, 25 rows a page, so its
 * last row is never hidden under anything and the end of the list is visible.
 */

const PEER_GROUP_SORT: Readonly<Record<PeerGroupId, number>> = { small: 0, medium: 1, large: 2, all: 3 };
const FROZEN_STYLE: Readonly<Record<FrozenKey, React.CSSProperties>> = frozenStyles();
const FROZEN_CLASS =
  'sticky left-[var(--frozen-left)] w-[var(--frozen-w)] min-w-[var(--frozen-w)] max-w-[var(--frozen-w)] ' +
  'sm:left-[var(--frozen-left-wide)] sm:w-[var(--frozen-w-wide)] sm:min-w-[var(--frozen-w-wide)] ' +
  'sm:max-w-[var(--frozen-w-wide)]';
const FROZEN_INNER = 'overflow-hidden w-[var(--frozen-inner)] sm:w-[var(--frozen-inner-wide)]';
const WIDE_ONLY = 'hidden lg:table-cell';
const COMPONENT_BY_KEY = new Map(DEI_COMPONENTS.map((c) => [c.key, c]));

interface LeagueColumn {
  readonly key: string;
  readonly header: string;
  readonly title?: string;
  readonly frozen?: FrozenKey;
  readonly className: string;
  readonly right?: boolean;
  readonly sortValue: (row: LeagueRow) => SortValue;
}

function componentOf(row: LeagueRow, key: DeiComponentKey) {
  return row.components.find((c) => c.key === key);
}

function metricColumn(key: DeiComponentKey): LeagueColumn {
  const c = COMPONENT_BY_KEY.get(key);
  const label = c?.label ?? key;
  return {
    key,
    header: label,
    title: `${label}: the depot's value and its difference from the peer median. ${
      c?.higherIsBetter ? 'Higher is better.' : 'Lower is better.'
    }`,
    className: NARROW_COMPONENTS.has(key) ? '' : WIDE_ONLY,
    right: true,
    sortValue: (r) => componentOf(r, key)?.value ?? null,
  };
}

function columnsFor(showPeerGroup: boolean, trends: trend.IndexTrends): readonly LeagueColumn[] {
  return [
    { key: 'rank', header: 'Rank', frozen: 'rank', className: 'z-[5]', right: true, sortValue: (r) => r.rank },
    { key: 'depot', header: 'Depot', frozen: 'depot', className: 'z-[5]', sortValue: (r) => r.name },
    {
      key: 'index',
      header: 'Index',
      title: 'Efficiency index, 0 to 100. A typical peer scores 50; the tick on the bar marks 50.',
      frozen: 'index',
      className: 'z-[5] border-r border-r-depot-line',
      sortValue: (r) => r.index,
    },
    ...LEAGUE_COMPONENT_ORDER.map(metricColumn),
    { key: 'trend', header: trend.INDEX_TREND_HEADER, title: trend.INDEX_TREND_TITLE,
      className: WIDE_ONLY, sortValue: (r) => trends.get(r.depotId)?.fourWeeks ?? null },
    ...(showPeerGroup
      ? [{
          key: 'peerGroup',
          header: 'Peer group',
          className: WIDE_ONLY,
          sortValue: (r: LeagueRow) => (r.peerGroup === null ? null : PEER_GROUP_SORT[r.peerGroup]),
        }]
      : []),
    { key: 'fleet', header: 'Fleet (buses)', className: WIDE_ONLY, right: true, sortValue: (r) => r.fleet },
  ];
}

function cellContent(column: LeagueColumn, row: LeagueRow, selected: boolean, onSelect: (row: LeagueRow) => void, trends: trend.IndexTrends) {
  switch (column.key) {
    case 'trend':
      return <trend.IndexTrendCell name={row.name} row={trends.get(row.depotId)} />;
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

/** A frozen cell's content is boxed to the cell, so a long header or name cannot widen it. */
function Boxed({ column, children }: { readonly column: LeagueColumn; readonly children: React.ReactNode }) {
  if (!column.frozen) return <>{children}</>;
  return <div className={`${FROZEN_INNER} ${column.right ? 'ml-auto text-right' : ''}`}>{children}</div>;
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
  /** The index's window for its header: "last 20 min". */
  readonly indexWindow?: string;
}

export function LeagueGrid({ rows, showPeerGroup, selectedId, onSelect, indexWindow }: LeagueGridProps) {
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const moreColumns = useColumnsToTheRight(frame, true);
  const trends = trend.useIndexTrends();
  const columns = useMemo(() => columnsFor(showPeerGroup, trends), [showPeerGroup, trends]);
  const sortColumn = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const sorted = useMemo(
    () => (sort && sortColumn ? sortRows(rows, sortColumn.sortValue, sort.direction) : rows),
    [rows, sort, sortColumn],
  );
  const range = pageRange(page, sorted.length);
  const visible = sorted.slice(range.start, range.end);
  const toggle = (key: string): void =>
    setSort((s) => ({ key, direction: s?.key === key && s.direction === 'asc' ? 'desc' : 'asc' }));

  if (rows.length === 0) {
    return (
      <StatePanel
        kind="empty"
        rows={6}
        sentence="No depots match these filters."
        remedy="Try a different peer group, clear the search, or turn on Show unranked."
      />
    );
  }

  const cellClass = (c: LeagueColumn): string =>
    `${c.className} ${c.frozen ? FROZEN_CLASS : ''} ${c.right ? 'depot-align-right' : ''}`;
  return (
    <div>
      <div className="relative min-w-0">
        <div
          ref={frame}
          role="region"
          aria-label="Depot league table"
          tabIndex={0}
          className="depot-table-frame !max-h-none"
        >
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
                      style={c.frozen ? FROZEN_STYLE[c.frozen] : undefined}
                      aria-sort={active === null ? 'none' : active === 'asc' ? 'ascending' : 'descending'}
                      className={`${cellClass(c)} ${c.frozen ? '!z-20' : ''}`}
                    >
                      <Boxed column={c}>
                        <button type="button" className="depot-sort-button" onClick={() => toggle(c.key)}>
                          {c.header}
                          <span aria-hidden className="inline-block w-3 text-holo-glow">
                            {active === null ? '' : active === 'asc' ? '↑' : '↓'}
                          </span>
                        </button>
                        {c.key === 'index' && indexWindow ? (
                          <span className="block text-depot-faint">{`· ${indexWindow}`}</span>
                        ) : null}
                        {c.title ? <span className="sr-only">{c.title}</span> : null}
                      </Boxed>
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
                    onClick={() => onSelect(row)}
                    className={`group h-9 depot-row-selectable ${selected ? 'depot-row-selected' : ''}`}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        style={c.frozen ? FROZEN_STYLE[c.frozen] : undefined}
                        className={`whitespace-nowrap !py-1.5 ${cellClass(c)} ${
                          c.frozen
                            ? `${selected ? 'bg-depot-raised' : 'bg-depot-page'} group-hover:bg-depot-raised`
                            : ''
                        }`}
                      >
                        <Boxed column={c}>{cellContent(c, row, selected, onSelect, trends)}</Boxed>
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
      {sorted.length > visible.length ? (
        <Pager page={range.page} total={sorted.length} onPage={setPage} />
      ) : null}
    </div>
  );
}
