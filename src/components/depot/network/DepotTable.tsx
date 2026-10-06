'use client';

import { useMemo, useState } from 'react';
import {
  DataTable,
  useTableSort,
  type Column,
  type TableSort,
} from '@/components/depot/shell/DataTable';
import { formatCount, formatShare } from '@/lib/depot/format';
import { DEPOT_KIND_LABEL, PEER_GROUP_LABEL, RANK_REASON_LABEL } from '@/lib/depot/labels';
import { formatIndex, rankedIndex, type DepotRow } from '@/lib/depot/network/overviewModel';
import {
  KIND_FILTER_OPTIONS,
  TABLE_ROW_CAP,
  TABLE_TOGGLE_LABEL,
  tableCap,
  tableCapLine,
  tableColumnKeys,
  tableHeading,
  type KindFilter,
  type TableColumnKey,
} from '@/lib/depot/network/overviewWords';
import { StatusMixBar, statusSegments } from './StatusMixBar';
import { useNarrow } from './useNarrow';

function ratio(n: number, of: number): number | null {
  return of > 0 ? n / of : null;
}

function count(pick: (row: DepotRow) => number) {
  return {
    align: 'right' as const,
    sortValue: pick,
    render: (row: DepotRow) => formatCount(pick(row)),
  };
}

/** Module-level so the table does not re-sort on every render. */
const COLUMNS: readonly (Column<DepotRow> & { readonly key: TableColumnKey })[] = [
  {
    key: 'name',
    header: 'Unit',
    sortValue: (row) => row.depot.name,
    render: (row) => <span className="whitespace-nowrap">{row.depot.name}</span>,
  },
  {
    key: 'kind',
    header: 'Kind',
    sortValue: (row) => DEPOT_KIND_LABEL[row.depot.kind],
    render: (row) => (
      <span className="whitespace-nowrap text-depot-muted">{DEPOT_KIND_LABEL[row.depot.kind]}</span>
    ),
  },
  { key: 'fleet', header: 'Fleet', ...count((row) => row.depot.fleet) },
  { key: 'onRoad', header: 'On road', ...count((row) => row.depot.status.live) },
  { key: 'stationary', header: 'Stationary', ...count((row) => row.depot.status.stationary) },
  { key: 'noSignal', header: 'No signal', ...count((row) => row.depot.status.noSignal) },
  {
    key: 'maintenance',
    header: 'Maintenance',
    ...count((row) => row.depot.status.underMaintenance),
  },
  {
    key: 'mix',
    header: 'Status mix',
    render: (row) => (
      <StatusMixBar
        segments={statusSegments(row.depot.status)}
        caption={`Status of ${row.depot.fleet} buses`}
      />
    ),
  },
  {
    key: 'reporting',
    header: 'Reporting',
    align: 'right',
    sortValue: (row) => ratio(row.depot.reporting, row.depot.fleet),
    render: (row) => formatShare(row.depot.reporting, row.depot.fleet),
  },
  {
    key: 'assigned',
    header: 'Assigned',
    align: 'right',
    sortValue: (row) => ratio(row.depot.assigned, row.depot.fleet),
    render: (row) => formatShare(row.depot.assigned, row.depot.fleet),
  },
  {
    key: 'index',
    header: 'Index',
    align: 'right',
    sortValue: rankedIndex,
    render: (row) => {
      const index = rankedIndex(row);
      if (index !== null) return formatIndex(index);
      const reason = row.score ? RANK_REASON_LABEL[row.score.reason] : 'Not scored';
      // `relative` gives the visually-hidden text a containing block inside the
      // table's scroll frame; without it the absolutely positioned span escapes
      // the frame's clipping and widens the page.
      return (
        <span className="relative text-depot-muted" title={reason}>
          —<span className="sr-only">{`, ${reason}`}</span>
        </span>
      );
    },
  },
  {
    key: 'peerGroup',
    header: 'Peer group',
    sortValue: (row) => (row.score?.peerGroup ? PEER_GROUP_LABEL[row.score.peerGroup] : null),
    render: (row) => (
      <span className="whitespace-nowrap text-depot-muted">
        {row.score?.peerGroup ? PEER_GROUP_LABEL[row.score.peerGroup] : '—'}
      </span>
    ),
  },
];

const DEFAULT_SORT: TableSort = { key: 'fleet', direction: 'desc' };
const TABLE_ID = 'depot-table-region';

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
}

/**
 * Every unit in the feed, largest fleet first, in the page flow: no second
 * scroll axis. The first 25 rows show until the toggle; the table applies the
 * cap after its own sort, so sorting always ranks every row, and a selected row
 * beyond the cap is kept. The sort lives here so the line under the table says
 * the order truly in force: it returns to the default when its column drops out
 * (a filter, or a width under 900px). Selecting a row selects the same unit as
 * the map and the ranked lists.
 */
export function DepotTable({ rows, selectedId, onSelect }: DepotTableProps) {
  const [filter, setFilter] = useState<KindFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const narrow = useNarrow();
  const visible = useMemo(() => rows.filter((row) => matchesKind(row, filter)), [rows, filter]);
  // Memoised on the inputs, so the table only re-sorts when the column set changes.
  const columns = useMemo(
    () =>
      tableColumnKeys(filter, narrow)
        .map((key) => COLUMN_BY_KEY.get(key))
        .filter((column): column is Column<DepotRow> => column !== undefined),
    [filter, narrow],
  );
  const cap = tableCap(visible.length, expanded);
  const tableSort = useTableSort(columns, DEFAULT_SORT);
  const sortedColumn = columns.find((column) => column.key === tableSort.sort?.key);
  const sortDescription =
    tableSort.sort && sortedColumn
      ? { label: sortedColumn.header, direction: tableSort.sort.direction }
      : null;

  return (
    <section aria-labelledby="depot-table-heading" data-testid="depot-table-section">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h2 id="depot-table-heading" className="depot-section-label !mb-0">
          {tableHeading(filter, visible.length)}
        </h2>
        <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
          {KIND_FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              className="depot-filter-button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="depot-table-flow">
        <DataTable
          id={TABLE_ID}
          maxRows={cap.capped ? TABLE_ROW_CAP : undefined}
          tableSort={tableSort}
          columns={columns}
          rows={visible}
          rowKey={(row) => row.depot.id}
          caption="Units with fleet, reporting, assignment, status, index and peer group"
          initialSort={DEFAULT_SORT}
          onRowSelect={(row) => onSelect(row.depot.id)}
          selectedKey={selectedId ?? undefined}
          emptyMessage="No units of this kind are in the feed."
        />
      </div>
      {cap.toggle ? (
        <p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-depot-muted">
          {cap.capped ? (
            <span>
              {tableCapLine(TABLE_ROW_CAP, visible.length, sortDescription, tableSort.isDefault)}
            </span>
          ) : null}
          <button
            type="button"
            aria-expanded={!cap.capped}
            aria-controls={TABLE_ID}
            onClick={() => setExpanded((open) => !open)}
            className="depot-filter-button"
          >
            {TABLE_TOGGLE_LABEL}
          </button>
        </p>
      ) : null}
    </section>
  );
}
