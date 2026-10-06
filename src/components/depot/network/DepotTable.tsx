'use client';

import { useMemo, useState } from 'react';
import { DataTable, useTableSort, type Column, type TableSort } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { formatCount } from '@/lib/depot/format';
import { pageRange } from '@/lib/depot/listPaging';
import { sortRows } from '@/lib/depot/tableSort';
import { DEPOT_KIND_LABEL, PEER_GROUP_LABEL, RANK_REASON_LABEL } from '@/lib/depot/labels';
import { formatIndex, rankedIndex, type DepotRow } from '@/lib/depot/network/overviewModel';
import { KIND_FILTER_OPTIONS, tableHeading } from '@/lib/depot/network/overviewWords';
import {
  DARK_HEADER_TITLE,
  MIX_BAR_PX,
  NARROW_TABLE_NOTE,
  TABLE_COLUMN_SPEC,
  UNITS_PAGE_ROWS,
  pageOfKey,
  tableColumnKeys,
  unitStateCounts,
  type KindFilter,
  type TableColumnKey,
} from '@/lib/depot/network/unitsTable';
import { StatusMixBar, stateSegments } from './StatusMixBar';
import { useUnitsTier } from './useNarrow';

function ratio(n: number, of: number): number | null {
  return of > 0 ? n / of : null;
}

/** A bare percentage: the header carries the unit. */
function percent(n: number, of: number): string {
  const share = ratio(n, of);
  return share === null ? '—' : String(Math.round(share * 100));
}

function count(pick: (row: DepotRow) => number) {
  return { align: 'right' as const, sortValue: pick, render: (row: DepotRow) => formatCount(pick(row)) };
}

const spec = (key: TableColumnKey) => ({ key, ...TABLE_COLUMN_SPEC[key] });
const states = (row: DepotRow) => unitStateCounts(row.depot);

function IndexCell({ row }: { readonly row: DepotRow }) {
  const index = rankedIndex(row);
  if (index !== null) return <>{formatIndex(index)}</>;
  const reason = row.score ? RANK_REASON_LABEL[row.score.reason] : 'Not scored';
  // `relative` gives the visually-hidden text a containing block inside the table's
  // scroll frame; without it the absolutely positioned span escapes the frame's clipping.
  return (
    <span className="relative text-depot-muted" title={reason}>
      —<span className="sr-only">{`, ${reason}`}</span>
    </span>
  );
}

/**
 * Module-level so the table does not re-sort on every render. The four state counts are
 * the classified states, in the cockpit's words; headers and widths come from
 * `unitsTable.ts`, where their sum is held against the frame.
 */
const COLUMNS: readonly (Column<DepotRow> & { readonly key: TableColumnKey })[] = [
  {
    ...spec('name'),
    sortValue: (row) => row.depot.name,
    // KIND is a muted suffix on a non-depot unit only (critique section 7), never a column.
    render: (row) =>
      row.depot.kind === 'depot' ? (
        row.depot.name
      ) : (
        <>
          {row.depot.name}
          <span className="ml-1.5 text-[11px] text-depot-muted">{DEPOT_KIND_LABEL[row.depot.kind]}</span>
        </>
      ),
    title: (row) =>
      row.depot.kind === 'depot' ? row.depot.name : `${row.depot.name} · ${DEPOT_KIND_LABEL[row.depot.kind]}`,
  },
  {
    ...spec('kind'),
    sortValue: (row) => DEPOT_KIND_LABEL[row.depot.kind],
    render: (row) => <span className="text-depot-muted">{DEPOT_KIND_LABEL[row.depot.kind]}</span>,
  },
  { ...spec('fleet'), ...count((row) => row.depot.fleet) },
  {
    ...spec('reporting'),
    align: 'right',
    sortValue: (row) => ratio(row.depot.reporting, row.depot.fleet),
    render: (row) => percent(row.depot.reporting, row.depot.fleet),
  },
  {
    ...spec('assigned'),
    align: 'right',
    sortValue: (row) => ratio(row.depot.assigned, row.depot.fleet),
    render: (row) => percent(row.depot.assigned, row.depot.fleet),
  },
  { ...spec('onRoad'), ...count((row) => states(row).onRoad) },
  { ...spec('standing'), ...count((row) => states(row).standing) },
  { ...spec('dark'), ...count((row) => states(row).dark), title: () => DARK_HEADER_TITLE },
  { ...spec('offRoad'), ...count((row) => states(row).offRoad) },
  {
    ...spec('mix'),
    render: (row) => (
      <StatusMixBar
        segments={stateSegments(row.depot.states)}
        caption={`State of ${row.depot.fleet} buses`}
        width={MIX_BAR_PX}
      />
    ),
  },
  { ...spec('index'), align: 'right', sortValue: rankedIndex, render: (row) => <IndexCell row={row} /> },
  {
    ...spec('peerGroup'),
    sortValue: (row) => (row.score?.peerGroup ? PEER_GROUP_LABEL[row.score.peerGroup] : null),
    render: (row) => (
      <span className="text-depot-muted">
        {row.score?.peerGroup ? PEER_GROUP_LABEL[row.score.peerGroup] : '—'}
      </span>
    ),
  },
];

const DEFAULT_SORT: TableSort = { key: 'fleet', direction: 'desc' };
const TABLE_ID = 'depot-table-region';
const unitKey = (row: DepotRow): string => row.depot.id;

const COLUMN_BY_KEY: ReadonlyMap<TableColumnKey, Column<DepotRow>> = new Map(
  COLUMNS.map((column) => [column.key, column]),
);

function matchesKind(row: DepotRow, filter: KindFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'depot' ? row.depot.kind === 'depot' : row.depot.kind !== 'depot';
}

export interface DepotTableProps {
  readonly rows: readonly DepotRow[];
  readonly selectedId: string | null;
  readonly onSelect: (depotId: string) => void;
  /** The selection line, drawn under the table's label so it never sits above it. */
  readonly selection?: React.ReactNode;
}

/**
 * Every unit in the feed, largest fleet first, in the page flow: no second scroll axis.
 * Pages of 25 under the shared pager, the only count. The sort ranks every row before the
 * page is cut; a filter or sort change returns to page 1; a unit selected on the map or in
 * a ranked list brings its page into view and stays selected across pages. The columns
 * follow the content width (`useUnitsTier`); what a tier drops is in the selected-unit panel.
 */
export function DepotTable({ rows, selectedId, onSelect, selection }: DepotTableProps) {
  const [filter, setFilter] = useState<KindFilter>('all');
  const tier = useUnitsTier();
  const narrow = tier === 'narrow' || tier === 'phone';
  const visible = useMemo(() => rows.filter((row) => matchesKind(row, filter)), [rows, filter]);
  // Memoised on the inputs, so the table only re-sorts when the column set changes.
  const columns = useMemo(
    () =>
      tableColumnKeys(tier)
        .map((key) => COLUMN_BY_KEY.get(key))
        .filter((column): column is Column<DepotRow> => column !== undefined),
    [tier],
  );
  const tableSort = useTableSort(columns, DEFAULT_SORT);
  const sort = tableSort.sort;
  const sorted = useMemo(() => {
    const sortValue = sort ? columns.find((column) => column.key === sort.key)?.sortValue : undefined;
    return sort && sortValue ? sortRows(visible, sortValue, sort.direction) : visible;
  }, [visible, columns, sort]);
  const [page, setPage] = useState(() => pageOfKey(sorted.map(unitKey), selectedId) ?? 0);
  // A selection made elsewhere (the map, a ranked list) brings its page into view. Adjusted
  // while rendering, so the old page is never painted first.
  const [seenSelection, setSeenSelection] = useState(selectedId);
  if (selectedId !== seenSelection) {
    setSeenSelection(selectedId);
    const target = pageOfKey(sorted.map(unitKey), selectedId);
    if (target !== null && target !== page) setPage(target);
  }
  const range = pageRange(page, sorted.length, UNITS_PAGE_ROWS);
  const shown = sorted.slice(range.start, range.end);
  const pagedSort = {
    ...tableSort,
    setSort: (next: TableSort) => {
      setPage(0);
      tableSort.setSort(next);
    },
  };
  const chooseFilter = (next: KindFilter): void => {
    setFilter(next);
    setPage(0);
  };

  return (
    <section aria-labelledby="depot-table-heading" data-testid="depot-table-section">
      {/* The shared label: one rule, above the label, like every other section. */}
      <SectionLabel
        id="depot-table-heading"
        label={tableHeading(filter)}
        note={narrow ? NARROW_TABLE_NOTE : undefined}
        controls={
          <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
            {KIND_FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => chooseFilter(option.id)}
                className="depot-filter-button"
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />
      {selection}
      <div className="depot-table-flow">
        <DataTable
          id={TABLE_ID}
          tableSort={pagedSort}
          columns={columns}
          rows={shown}
          rowKey={unitKey}
          caption="Units with fleet, reporting, assignment, state, index and peer group"
          initialSort={DEFAULT_SORT}
          onRowSelect={(row) => onSelect(row.depot.id)}
          selectedKey={selectedId ?? undefined}
          emptyMessage="No units of this kind are in the feed."
          fixedRows
          freezeFirstColumn
          overflowCue
        />
      </div>
      {sorted.length > UNITS_PAGE_ROWS ? (
        <Pager page={range.page} total={sorted.length} pageSize={UNITS_PAGE_ROWS} onPage={setPage} />
      ) : null}
    </section>
  );
}
