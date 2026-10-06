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
  FUEL_ONLY_NOTE,
  INDEX_LIMITS_NOTE,
  INDEX_SEPARATION,
  buildEconomicsRows,
  defaultShowUnranked,
  economicsStatement,
  economicsStatusLine,
  filterEconomicsRows,
  rankingShortfallNotice,
  type EconomicsFilters,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import { ModelledStatement } from '@/components/depot/revenue/ModelledStatement';
import { MIXED_CLASS_NOTE, REVENUE_MODEL_PARAMS } from '@/lib/depot/sim/revenueConfig';
import { EconomicsBreakdown } from './EconomicsBreakdown';
import { EconomicsGrid } from './EconomicsGrid';

const LEAGUE_PATH = '/project/depots/league';
const ROUTES_PATH = '/project/depots/routes';
const LINK_CLASS = 'text-holo-glow underline-offset-2 hover:underline';

/**
 * Depots ranked by the MODELLED Depot Economics Index within peer groups. The
 * selected depot's breakdown opens beside the table from `xl` and below it
 * otherwise. No Depot Efficiency Index value is shown here.
 */
export function EconomicsPage() {
  const { data, error, loading, refresh } = useDepotEconomics();
  const [search, setSearch] = useState('');
  // Null until the reader chooses: then it follows the data (all depots when none is ranked).
  const [showUnrankedChoice, setShowUnrankedChoice] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusPending, setFocusPending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const allRows = useMemo(() => (data ? buildEconomicsRows(data.depots) : []), [data]);
  const filters = useMemo<EconomicsFilters>(
    () => ({ search, showUnranked: showUnrankedChoice ?? defaultShowUnranked(allRows) }),
    [search, showUnrankedChoice, allRows],
  );
  const rows = useMemo(() => filterEconomicsRows(allRows, filters), [allRows, filters]);
  const shortfall = useMemo(() => (data ? rankingShortfallNotice(data.depots) : null), [data]);
  const statement = useMemo(() => economicsStatement(), []);
  const statusLine = useMemo(() => (data ? economicsStatusLine(data.depots) : ''), [data]);
  const select = useCallback((row: EconomicsRow): void => {
    setSelectedId(row.depotId);
    setFocusPending(true);
  }, []);
  // The selection outlives a filter that hides it, so relaxing the filter reopens it.
  const selected = selectedId === null ? null : (rows.find((r) => r.depotId === selectedId) ?? null);
  const selectedHidden = selectedId !== null && selected === null;
  const selectedName = allRows.find((r) => r.depotId === selectedId)?.name ?? 'the depot';

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
      </p>
      {shortfall ? (
        <p className="depot-prose mb-3 max-w-3xl" data-testid="depot-economics-shortfall">
          {shortfall.lead}
          <Link href={ROUTES_PATH} className={LINK_CLASS}>
            {shortfall.linkText}
          </Link>
          {shortfall.tail}
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-depot-muted">
          <span>Search depots</span>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-44 min-w-0 rounded-[3px] border border-depot-line bg-depot-surface px-2 py-1 text-depot-ink"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-depot-muted">
          <input
            type="checkbox"
            checked={filters.showUnranked}
            onChange={(event) => setShowUnrankedChoice(event.target.checked)}
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
          : selectedHidden
            ? `The selected depot, ${selectedName}, is hidden by the filters; change them to see its breakdown again.`
            : 'Select Score on a row to see how its modelled index is made up.'}
      </p>
      <p className="depot-prose mb-2 max-w-3xl text-xs">{INDEX_LIMITS_NOTE}</p>
      <div className={selected ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
        <div className="min-w-0">
          <EconomicsGrid
            rows={rows}
            allRows={allRows}
            filters={filters}
            selectedId={selected?.depotId ?? null}
            onSelect={select}
          />
          <p className="depot-prose mt-2 max-w-3xl text-xs">{FUEL_ONLY_NOTE}</p>
        </div>
        {selected ? (
          <EconomicsBreakdown row={selected} weights={data.weights} headingRef={headingRef} />
        ) : null}
      </div>
      <div className="mt-6">
        <ModelledStatement
          params={REVENUE_MODEL_PARAMS}
          notes={[MIXED_CLASS_NOTE]}
          preface={statement.preface}
          closing={statement.closing}
        />
      </div>
    </>
  );
}
