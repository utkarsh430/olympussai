'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
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
  buildLeagueRows,
  filterLeagueRows,
  selectedRowIn,
  showsPeerGroupColumn,
  type LeagueFilters as Filters,
  type LeagueRow,
} from '@/lib/depot/league/leagueModel';
import { computedStamp, leagueStatusLine } from '@/lib/depot/league/leagueWording';
import { scoreWindowSentence, scoreWindowShort } from '@/lib/depot/score/windowWords';
import { MIN_FLEET_FOR_RANK } from '@/lib/depot/score/config';
import type { PeerGroupId } from '@/lib/depot/score/types';
import { LEAGUE_HOW_PRODUCED } from '@/lib/depot/network/howProduced';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { LeagueFilters } from './LeagueFilters';
import { LeagueGrid } from './LeagueGrid';
import { ScoreBreakdown } from './ScoreBreakdown';

const PEER_GROUP_DISPLAY_ORDER: readonly PeerGroupId[] = ['small', 'medium', 'large', 'all'];

/**
 * Depots ranked within peer groups. The selected depot's breakdown opens beside the
 * table only from `2xl` (1536px), where the table keeps its frozen block and four
 * metric columns; below that it opens under the table, so it never squeezes it.
 */
export function LeagueTable() {
  const { data, error, loading, refresh } = useDepotNetworkContext();
  const [filters, setFilters] = useState<Filters>(DEFAULT_LEAGUE_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusPending, setFocusPending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const allRows = useMemo(() => (data ? buildLeagueRows(data.depots, data.scores) : []), [data]);
  const rows = useMemo(() => filterLeagueRows(allRows, filters), [allRows, filters]);
  const peerGroups = useMemo(
    () => PEER_GROUP_DISPLAY_ORDER.filter((g) => allRows.some((r) => r.peerGroup === g)),
    [allRows],
  );
  const statusLine = useMemo(
    () => (data ? leagueStatusLine(data.depots, data.scores, MIN_FLEET_FOR_RANK) : ''),
    [data],
  );
  const select = useCallback((row: LeagueRow): void => {
    setSelectedId(row.depotId);
    setFocusPending(true);
  }, []);
  // The selection outlives a filter that hides it, so relaxing the filter reopens it.
  const selected = selectedRowIn(rows, selectedId);

  // Move focus to the breakdown heading so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (!focusPending || selected === null || headingRef.current === null) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    headingRef.current.focus({ preventScroll: true });
    headingRef.current.scrollIntoView({
      block: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    setFocusPending(false);
  }, [focusPending, selected]);

  if (loading) return <LoadingBlock rows={10} label="Loading the league table" />;
  if (!data) {
    return (
      <ErrorPanel
        title="Could not load the league"
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }
  if (allRows.length === 0) {
    return (
      <EmptyState>The live feed returned no depots, so there is nothing to rank yet.</EmptyState>
    );
  }

  const filtered =
    filters.peerGroup !== 'any' || filters.search.trim() !== '' || filters.showUnranked;
  return (
    <>
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <LeagueFilters filters={filters} peerGroups={peerGroups} onChange={setFilters} />
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="depot-prose min-w-0 text-xs" role="status">
          {`${scoreWindowSentence(data.scoreWindow, data.feedNow)} ${statusLine}. `}
          {filtered ? `${formatCount(rows.length)} rows shown with these filters. ` : ''}
          {selected
            ? `Score breakdown showing for ${selected.name}.`
            : 'Select Score on a row to see how its index is made up.'}
        </p>
        <span className="font-mono text-[11px] tabular-nums text-depot-faint">
          {computedStamp(data.feedNow)}
        </span>
      </div>
      <p className="depot-prose mb-2 text-xs lg:hidden">
        This narrow view shows Rank, Depot, Index, Schedule coverage and Device integrity. Select
        Score on a row for the other measures.
      </p>
      <div className={selected ? 'grid gap-4 2xl:grid-cols-[minmax(0,1fr)_28rem]' : ''}>
        <div className="min-w-0">
          <LeagueGrid
            rows={rows}
            showPeerGroup={showsPeerGroupColumn(filters)}
            selectedId={selected?.depotId ?? null}
            onSelect={select}
            indexWindow={scoreWindowShort(data.scoreWindow, data.feedNow)}
          />
        </div>
        {selected ? (
          <ScoreBreakdown row={selected} feedNow={data.feedNow} headingRef={headingRef} />
        ) : null}
      </div>
      <HowProduced paragraphs={LEAGUE_HOW_PRODUCED} className="mt-10" />
    </>
  );
}
