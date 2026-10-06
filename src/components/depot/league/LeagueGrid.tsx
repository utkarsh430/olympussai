'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import { Pager } from '@/components/depot/shell/LongLists';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { TableOverflowCue, useColumnsToTheRight } from '@/components/depot/shell/TableOverflowCue';
import { groupCounts, groupLabel, groupRows } from '@/components/depot/shell/tableGroups';
import { formatCount } from '@/lib/depot/format';
import { pageRange } from '@/lib/depot/listPaging';
import { sortRows, type SortDirection } from '@/lib/depot/tableSort';
import { frozenStyles, type FrozenKey } from '@/lib/depot/league/leagueColumns';
import { LEAGUE_COLUMNS, type LeagueColumn } from '@/lib/depot/league/leagueGridColumns';
import { PEER_GROUP_LABEL, type LeagueRow } from '@/lib/depot/league/leagueModel';
import type { DeiComponentKey } from '@/lib/depot/score/types';
import { useIndexTrends, type IndexTrends } from '@/components/depot/trends/LeagueTrend';
import { DepotCell, IndexButton, MetricCell, OpenChevron, TrendCell } from './LeagueCells';

/*
 * The league's own table markup, on the shared `depot-table` classes: the shared
 * DataTable freezes one column, the league freezes three. Rank, Depot and Index are one
 * block whose widths and offsets come from `leagueColumns.ts`; every frozen cell has a
 * solid background and its content boxed to the cell. The columns after it are sized
 * and tiered there too, so at every width the table fits its frame and nothing scrolls
 * sideways. Listed together, the peer groups are group rows, not a column. The index
 * cell opens the breakdown; on a phone so does a tap anywhere on the row.
 */

const FROZEN_STYLE: Readonly<Record<FrozenKey, React.CSSProperties>> = frozenStyles();
const FROZEN_CLASS =
  'sticky left-[var(--frozen-left)] w-[var(--frozen-w)] min-w-[var(--frozen-w)] max-w-[var(--frozen-w)] ' +
  'sm:left-[var(--frozen-left-wide)] sm:w-[var(--frozen-w-wide)] sm:min-w-[var(--frozen-w-wide)] ' +
  'sm:max-w-[var(--frozen-w-wide)]';
const FROZEN_INNER = 'overflow-hidden w-[var(--frozen-inner)] sm:w-[var(--frozen-inner-wide)]';

const peerGroupKey = (row: LeagueRow): string =>
  row.peerGroup === null ? 'Not ranked' : PEER_GROUP_LABEL[row.peerGroup];

interface CellProps {
  readonly column: LeagueColumn;
  readonly row: LeagueRow;
  readonly selected: boolean;
  readonly onSelect: (row: LeagueRow) => void;
  readonly trends: IndexTrends;
  readonly windowSamples?: number;
}

function CellContent({ column, row, selected, onSelect, trends, windowSamples }: CellProps) {
  switch (column.key) {
    case 'rank':
      return <>{row.rank ?? '—'}</>;
    case 'depot':
      return <DepotCell row={row} windowSamples={windowSamples} />;
    case 'index':
      return <IndexButton row={row} selected={selected} onSelect={onSelect} />;
    case 'trend':
      return <TrendCell name={row.name} row={trends.get(row.depotId)} />;
    case 'fleet':
      return <>{formatCount(row.fleet)}</>;
    case 'open':
      return <OpenChevron />;
    default:
      return <MetricCell cell={row.components.find((c) => c.key === (column.key as DeiComponentKey))} />;
  }
}

/** A frozen cell's content is boxed to the cell, so a long header or name cannot widen it. */
function Boxed({ column, children }: { readonly column: LeagueColumn; readonly children: React.ReactNode }) {
  if (!column.frozen) return <>{children}</>;
  return <div className={`${FROZEN_INNER} ${column.right ? 'ml-auto text-right' : ''}`}>{children}</div>;
}

function HeaderCell({ column, sorted, onSort }: {
  readonly column: LeagueColumn;
  readonly sorted: SortDirection | null;
  readonly onSort: (key: string) => void;
}) {
  return (
    <Boxed column={column}>
      {column.sortValue ? (
        <button type="button" className="depot-sort-button" onClick={() => onSort(column.key)}>
          {column.header}
          <span aria-hidden className="inline-block w-3 text-holo-glow">
            {sorted === null ? '' : sorted === 'asc' ? '↑' : '↓'}
          </span>
        </button>
      ) : null}
      {column.tag ? (
        <span className="ml-1.5 inline-block align-middle">
          <ProvenanceBadge provenance={column.tag} pill />
        </span>
      ) : null}
      {column.title ? <span className="sr-only">{column.title}</span> : null}
    </Boxed>
  );
}

interface Sort {
  readonly key: string;
  readonly direction: SortDirection;
}

export interface LeagueGridProps {
  readonly rows: readonly LeagueRow[];
  /** Every peer group listed together: print each group once, as a group row. */
  readonly grouped: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (row: LeagueRow) => void;
  readonly page: number;
  readonly onPage: (page: number) => void;
  /** The index window's snapshot count; a depot scored on fewer is marked new. */
  readonly windowSamples?: number;
  /** The selected row's score breakdown: an expanded row directly under that row. */
  readonly expanded?: React.ReactNode;
}

/** A click on the row's own link or button is that control's, not the row's. */
function fromControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest('a, button') !== null;
}

export function LeagueGrid({ rows, grouped, selectedId, onSelect, page, onPage, windowSamples, expanded }: LeagueGridProps) {
  const [sort, setSort] = useState<Sort | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const moreColumns = useColumnsToTheRight(frame, true);
  const trends = useIndexTrends();
  const sortColumn = sort ? LEAGUE_COLUMNS.find((c) => c.key === sort.key) : undefined;
  const sorted = useMemo(() => {
    if (!sort || !sortColumn?.sortValue) return rows;
    const value = sortColumn.sortValue;
    return sortRows(rows, (r) => value(r, trends), sort.direction);
  }, [rows, sort, sortColumn, trends]);
  const counts = useMemo(() => groupCounts(sorted, peerGroupKey), [sorted]);
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
  const renderRow = (row: LeagueRow) => {
    const selected = row.depotId === selectedId;
    return (
      <Fragment key={row.depotId}>
      <tr
        tabIndex={0}
        data-league-row={row.depotId}
        aria-label={`${row.name}${selected ? ', breakdown open' : ''}: Enter shows the score breakdown`}
        onClick={(event) => {
          if (!fromControl(event.target)) onSelect(row);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
          event.preventDefault();
          onSelect(row);
        }}
        className={`group h-9 depot-row-selectable focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-holo-glow ${selected ? 'depot-row-selected' : ''}`}
      >
        {LEAGUE_COLUMNS.map((c) => (
          <td
            key={c.key}
            style={c.frozen ? FROZEN_STYLE[c.frozen] : undefined}
            className={`whitespace-nowrap !py-1.5 ${cellClass(c)} ${
              c.frozen ? `${selected ? 'bg-depot-raised' : 'bg-depot-page'} group-hover:bg-depot-raised` : ''
            }`}
          >
            <Boxed column={c}>
              <CellContent column={c} row={row} selected={selected} onSelect={onSelect} trends={trends} windowSamples={windowSamples} />
            </Boxed>
          </td>
        ))}
      </tr>
      {selected && expanded ? (
        <tr data-testid="league-breakdown-row">
          <td colSpan={LEAGUE_COLUMNS.length} className="!p-0 whitespace-normal">
            {/* Pinned to the frame's left edge, so it stays in view while the table scrolls sideways. */}
            <div className="sticky left-0 w-full max-w-[calc(100vw-2rem)] p-2">{expanded}</div>
          </td>
        </tr>
      ) : null}
      </Fragment>
    );
  };
  return (
    <div>
      <div className="relative min-w-0">
        <div ref={frame} role="region" aria-label="Depot league table" tabIndex={0} className="depot-table-frame !max-h-none">
          <table className="depot-table">
            <caption className="sr-only">Depot league table</caption>
            <thead>
              <tr>
                {LEAGUE_COLUMNS.map((c) => {
                  const active = sort?.key === c.key ? sort.direction : null;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      style={c.frozen ? FROZEN_STYLE[c.frozen] : undefined}
                      aria-sort={!c.sortValue ? undefined : active === null ? 'none' : active === 'asc' ? 'ascending' : 'descending'}
                      className={`${cellClass(c)} ${c.frozen ? '!z-20' : ''}`}
                    >
                      <HeaderCell column={c} sorted={active} onSort={toggle} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grouped
                ? groupRows(visible, peerGroupKey).map((g) => (
                    <Fragment key={`group-${g.key}`}>
                      <tr data-testid="depot-table-group">
                        <th scope="colgroup" colSpan={LEAGUE_COLUMNS.length} className="depot-table-group">
                          {groupLabel(g.key, counts.get(g.key) ?? g.rows.length)}
                        </th>
                      </tr>
                      {g.rows.map(renderRow)}
                    </Fragment>
                  ))
                : visible.map(renderRow)}
            </tbody>
          </table>
        </div>
        {moreColumns ? <TableOverflowCue /> : null}
      </div>
      {sorted.length > visible.length ? <Pager page={range.page} total={sorted.length} onPage={onPage} /> : null}
    </div>
  );
}
