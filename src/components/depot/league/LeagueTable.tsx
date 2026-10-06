'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import {
  DEFAULT_LEAGUE_FILTERS,
  buildLeagueRows,
  filterLeagueRows,
  selectedRowIn,
  showsPeerGroupColumn,
  type LeagueFilters as Filters,
  type LeagueRow,
} from '@/lib/depot/league/leagueModel';
import { leagueSectionNote } from '@/lib/depot/league/leagueWording';
import type { PeerGroupId } from '@/lib/depot/score/types';
import { LEAGUE_HOW_PRODUCED } from '@/lib/depot/network/howProduced';
import { LeagueFilters } from './LeagueFilters';
import { LeagueGrid } from './LeagueGrid';
import { ScoreBreakdown } from './ScoreBreakdown';

const PEER_GROUP_DISPLAY_ORDER: readonly PeerGroupId[] = ['small', 'medium', 'large', 'all'];
export const EMPTY_FEED_SENTENCE = 'The feed returned no depots, so there is nothing to rank yet.';

/**
 * Depots ranked within peer groups. Above the table: the header and its provenance line
 * (which carries the index window), then the filter row and one section note. The
 * selected depot's breakdown opens as an expanded row directly under its row.
 */
export function LeagueTable() {
  const { data, error, loading, refresh } = useDepotNetworkContext();
  const [filters, setFilters] = useState<Filters>(DEFAULT_LEAGUE_FILTERS);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusPending, setFocusPending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const allRows = useMemo(() => (data ? buildLeagueRows(data.depots, data.scores) : []), [data]);
  const rows = useMemo(() => filterLeagueRows(allRows, filters), [allRows, filters]);
  const peerGroups = useMemo(
    () => PEER_GROUP_DISPLAY_ORDER.filter((g) => allRows.some((r) => r.peerGroup === g)),
    [allRows],
  );
  const note = useMemo(() => (data ? leagueSectionNote(data.depots, data.scores) : ''), [data]);
  const changeFilters = useCallback((next: Filters): void => {
    setFilters(next);
    setPage(0);
  }, []);
  // The row or its index cell opens the breakdown under it; activating it again closes it and
  // returns focus to the row.
  const select = useCallback(
    (row: LeagueRow): void => {
      if (selectedId !== row.depotId) {
        setSelectedId(row.depotId);
        setFocusPending(true);
        return;
      }
      setSelectedId(null);
      Array.from(document.querySelectorAll<HTMLElement>('[data-league-row]'))
        .find((el) => el.getAttribute('data-league-row') === row.depotId)
        ?.focus();
    },
    [selectedId],
  );
  // The selection outlives a filter that hides it, so relaxing the filter reopens it.
  const selected = selectedRowIn(rows, selectedId);

  // Move focus to the breakdown heading so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (!focusPending || selected === null || headingRef.current === null) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    headingRef.current.focus({ preventScroll: true });
    headingRef.current.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    setFocusPending(false);
  }, [focusPending, selected]);

  if (loading) return <LoadingBlock rows={10} label="Loading the league table" />;
  if (!data) {
    return (
      <ErrorPanel title="Could not load the league" message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />
    );
  }
  if (allRows.length === 0) {
    return (
      <StatePanel kind="no-data" rows={10} sentence={EMPTY_FEED_SENTENCE}
        remedy="Depots are ranked as soon as the feed reports buses with a home depot." />
    );
  }

  return (
    <>
      {data.stale || error ? <StaleNotice since={data.feedNow} /> : null}
      <div className="depot-stack">
        <section aria-labelledby="league-ranked">
          <SectionLabel id="league-ranked" label="Ranked depots" note={note} />
          <LeagueFilters filters={filters} peerGroups={peerGroups} onChange={changeFilters} />
          <div className="min-w-0">
              <LeagueGrid
                rows={rows}
                grouped={showsPeerGroupColumn(filters)}
                selectedId={selected?.depotId ?? null}
                onSelect={select}
                page={page}
                onPage={setPage}
                windowSamples={data.scoreWindow?.samples}
                expanded={
                  selected ? (
                    <ScoreBreakdown row={selected} headingRef={headingRef} onClose={() => select(selected)} />
                  ) : null
                }
              />
          </div>
        </section>
        <HowProduced paragraphs={LEAGUE_HOW_PRODUCED} />
      </div>
    </>
  );
}
