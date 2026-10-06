'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { useDepotEconomics } from '@/hooks/useDepotEconomics';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { formatCount } from '@/lib/depot/format';
import {
  DEFAULT_ECONOMICS_FILTERS,
  INDEX_SEPARATION,
  buildEconomicsRows,
  economicsStatusLine,
  filterEconomicsRows,
  type EconomicsFilters,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import { EconomicsBreakdown } from './EconomicsBreakdown';
import { EconomicsGrid } from './EconomicsGrid';

const LEAGUE_PATH = '/project/depots/league';
const SOURCES_PATH = '/project/depots/sources';
const LINK_CLASS = 'text-holo-glow underline-offset-2 hover:underline';

/**
 * Depots ranked by the MODELLED Depot Economics Index within peer groups. The
 * selected depot's breakdown opens beside the table from `xl` and below it
 * otherwise. No Depot Efficiency Index value is shown here.
 */
export function EconomicsPage() {
  const { data, error, loading, refresh } = useDepotEconomics();
  const [filters, setFilters] = useState<EconomicsFilters>(DEFAULT_ECONOMICS_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusPending, setFocusPending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const allRows = useMemo(() => (data ? buildEconomicsRows(data.depots) : []), [data]);
  const rows = useMemo(() => filterEconomicsRows(allRows, filters), [allRows, filters]);
  const statusLine = useMemo(() => (data ? economicsStatusLine(data.depots) : ''), [data]);
  const select = useCallback((row: EconomicsRow): void => {
    setSelectedId(row.depotId);
    setFocusPending(true);
  }, []);
  // The selection outlives a filter that hides it, so relaxing the filter reopens it.
  const selected = selectedId === null ? null : (rows.find((r) => r.depotId === selectedId) ?? null);

  // Move focus to the breakdown heading so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (!focusPending || selected === null || headingRef.current === null) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    headingRef.current.focus({ preventScroll: true });
    headingRef.current.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    setFocusPending(false);
  }, [focusPending, selected]);

  if (loading) return <LoadingBlock rows={10} label="Loading the economics ranking" />;
  if (!data) {
    return (
      <ErrorPanel
        title="Could not load the economics ranking"
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }
  if (allRows.length === 0) {
    return <EmptyState>The live feed returned no depots, so there is nothing to rank yet.</EmptyState>;
  }

  return (
    <>
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <p className="depot-prose mb-3 max-w-3xl">
        {INDEX_SEPARATION.lead}
        <Link href={LEAGUE_PATH} className={LINK_CLASS}>
          {INDEX_SEPARATION.linkText}
        </Link>
        {INDEX_SEPARATION.tail}
        {' The fields a ticketing feed and a route master must provide are on the '}
        <Link href={SOURCES_PATH} className={LINK_CLASS}>
          Data sources page
        </Link>
        .
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-depot-muted">
          <span>Search depots</span>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            className="w-44 min-w-0 rounded-[3px] border border-depot-line bg-depot-surface px-2 py-1 text-depot-ink"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-depot-muted">
          <input
            type="checkbox"
            checked={filters.showUnranked}
            onChange={(event) => setFilters({ ...filters, showUnranked: event.target.checked })}
          />
          <span>Show unranked</span>
        </label>
      </div>
      <p className="depot-prose mb-2 text-xs" role="status">
        {`${statusLine}. `}
        {filters.showUnranked || filters.search.trim() !== ''
          ? `${formatCount(rows.length)} rows shown with these filters. `
          : ''}
        {selected
          ? `Economics breakdown showing for ${selected.name}.`
          : 'Select Score on a row to see how its modelled index is made up.'}
      </p>
      <div className={selected ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
        <div className="min-w-0">
          <EconomicsGrid rows={rows} selectedId={selected?.depotId ?? null} onSelect={select} />
        </div>
        {selected ? (
          <EconomicsBreakdown row={selected} weights={data.weights} headingRef={headingRef} />
        ) : null}
      </div>
    </>
  );
}
