'use client';

import { useMemo, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { formatCount } from '@/lib/depot/format';
import {
  DEFAULT_LEAGUE_FILTERS,
  PEER_GROUP_LABEL,
  buildLeagueRows,
  filterLeagueRows,
  describeDifference,
  type DifferenceDirection,
  formatRate,
  unrankedSentence,
  type LeagueFilters as Filters,
  type LeagueRow,
} from '@/lib/depot/league/leagueModel';
import { DEI_COMPONENTS } from '@/lib/depot/score/config';
import type { DeiComponentKey, PeerGroupId } from '@/lib/depot/score/types';
import { IndexBar } from './IndexBar';
import { LeagueFilters } from './LeagueFilters';
import { ScoreBreakdown } from './ScoreBreakdown';

const PEER_GROUP_SORT: Readonly<Record<PeerGroupId, number>> = {
  small: 0,
  medium: 1,
  large: 2,
  all: 3,
};
/** Colour only reinforces the wording beside it. */
const DIRECTION_TONE: Readonly<Record<DifferenceDirection, string>> = {
  better: 'text-alert-green',
  worse: 'text-alert-amber',
  level: 'text-depot-faint',
  unknown: 'text-depot-faint',
};
const PEER_GROUP_DISPLAY_ORDER: readonly PeerGroupId[] = ['small', 'medium', 'large', 'all'];

function componentOf(row: LeagueRow, key: DeiComponentKey) {
  return row.components.find((c) => c.key === key);
}

/** One rate column: the value, and under it the difference from the peer median. */
function rateColumn(key: DeiComponentKey): Column<LeagueRow> {
  const label = DEI_COMPONENTS.find((c) => c.key === key)?.label ?? key;
  return {
    key,
    header: label,
    align: 'right',
    sortValue: (row) => componentOf(row, key)?.value ?? null,
    render: (row) => {
      const cell = componentOf(row, key);
      if (!cell) return '—';
      const difference = describeDifference(cell.deltaPoints, cell.higherIsBetter);
      return (
        <span className="inline-flex flex-col items-end leading-tight">
          <span>{formatRate(cell.value)}</span>
          <span className={`text-[11px] ${DIRECTION_TONE[difference.direction]}`}>
            {difference.text}
          </span>
        </span>
      );
    },
  };
}

function buildColumns(onSelect: (row: LeagueRow) => void, selectedId: string | null) {
  const columns: readonly Column<LeagueRow>[] = [
    {
      key: 'rank',
      header: 'Rank',
      align: 'right',
      sortValue: (row) => row.rank,
      render: (row) => (row.rank === null ? '—' : row.rank),
    },
    {
      key: 'depot',
      header: 'Depot',
      sortValue: (row) => row.name,
      render: (row) => (
        <span className="flex min-w-[10rem] flex-col items-start gap-0.5">
          <button
            type="button"
            aria-pressed={row.depotId === selectedId}
            className="text-left text-holo-glow underline-offset-2 hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(row);
            }}
          >
            {row.name}
          </button>
          {row.ranked ? null : (
            <span className="depot-prose max-w-xs text-xs">{unrankedSentence(row)}</span>
          )}
        </span>
      ),
    },
    {
      key: 'peerGroup',
      header: 'Peer group',
      sortValue: (row) => (row.peerGroup === null ? null : PEER_GROUP_SORT[row.peerGroup]),
      render: (row) => (row.peerGroup === null ? '—' : PEER_GROUP_LABEL[row.peerGroup]),
    },
    {
      key: 'index',
      header: 'Index',
      sortValue: (row) => row.index,
      width: 140,
      render: (row) =>
        row.index === null ? (
          '—'
        ) : (
          <span className="flex items-center gap-2">
            <span className="w-10 text-right">{row.index.toFixed(1)}</span>
            <IndexBar value={row.index} />
          </span>
        ),
    },
    ...DEI_COMPONENTS.map((c) => rateColumn(c.key)),
    {
      key: 'fleet',
      header: 'Fleet',
      align: 'right',
      sortValue: (row) => row.fleet,
      render: (row) => formatCount(row.fleet),
    },
  ];
  return columns;
}

/** Depots ranked within peer groups, with the breakdown of the selected depot below. */
export function LeagueTable() {
  const { data, error, loading, refresh } = useDepotNetworkContext();
  const [filters, setFilters] = useState<Filters>(DEFAULT_LEAGUE_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allRows = useMemo(
    () => (data ? buildLeagueRows(data.depots, data.scores) : []),
    [data],
  );
  const rows = useMemo(() => filterLeagueRows(allRows, filters), [allRows, filters]);
  const peerGroups = useMemo(
    () => PEER_GROUP_DISPLAY_ORDER.filter((g) => allRows.some((r) => r.peerGroup === g)),
    [allRows],
  );
  const columns = useMemo(
    () => buildColumns((row) => setSelectedId(row.depotId), selectedId),
    [selectedId],
  );
  const selected = allRows.find((row) => row.depotId === selectedId) ?? null;

  if (loading) return <LoadingBlock rows={10} label="Loading the league table" />;
  if (!data) {
    return <ErrorPanel message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />;
  }
  if (allRows.length === 0) {
    return <EmptyState>The live feed returned no depots, so there is nothing to rank yet.</EmptyState>;
  }

  return (
    <>
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <LeagueFilters filters={filters} peerGroups={peerGroups} onChange={setFilters} />
      <p className="depot-prose mb-2 text-xs" role="status">
        {`Showing ${formatCount(rows.length)} of ${formatCount(allRows.length)} depots. `}
        Select a depot to see how its score is made up.
      </p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.depotId}
        caption="Depot league table"
        onRowSelect={(row) => setSelectedId(row.depotId)}
        selectedKey={selectedId ?? undefined}
        emptyMessage="No depots match these filters. Try a different peer group or turn on Show unranked."
      />
      {selected ? <ScoreBreakdown row={selected} /> : null}
    </>
  );
}
