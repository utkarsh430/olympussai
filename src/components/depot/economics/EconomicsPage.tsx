'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, ErrorPanel, StaleStrip } from '@/components/depot/shell/DataStates';
import { Checkbox } from '@/components/depot/shell/Controls';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { useDepotEconomics } from '@/hooks/useDepotEconomics';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import {
  FUEL_ONLY_NOTE,
  INDEX_LIMITS_NOTE,
  INDEX_SEPARATION,
  buildEconomicsRows,
  defaultShowUnranked,
  economicsDisclosure,
  economicsStatusLine,
  economicsStatusRows,
  notRankedPanel,
  filterEconomicsRows,
  lengthCoverageLine,
  type EconomicsFilters,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import { HowProduced } from '@/components/depot/revenue/HowProduced';
import { modelledStatement } from '@/lib/depot/revenue/revenuePageModel';
import { REVENUE_MODEL_PARAMS } from '@/lib/depot/sim/revenueConfig';
import { EconomicsBreakdown } from './EconomicsBreakdown';
import { EconomicsGrid } from './EconomicsGrid';

const LEAGUE_PATH = '/project/depots/league';
const LINK_CLASS = 'text-holo-glow underline-offset-2 hover:underline';

/**
 * Depots ranked by the MODELLED Depot Economics Index within peer groups. The
 * selected depot's breakdown opens beside the table from `2xl` and below it
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
  const panel = useMemo(() => (data ? notRankedPanel(data.depots) : null), [data]);
  const statusRows = useMemo(() => (data ? economicsStatusRows(data.depots) : []), [data]);
  const statusLine = useMemo(() => (data ? economicsStatusLine(data.depots) : ''), [data]);
  const disclosure = useMemo(
    () =>
      data
        ? economicsDisclosure(data.depots, modelledStatement(REVENUE_MODEL_PARAMS), lengthCoverageLine(data.depots))
        : [],
    [data],
  );
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

  if (loading) return <StatePanel kind="loading" rows={10} sentence="Loading the economics ranking" />;
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
    <div className="flex min-w-0 flex-col gap-4">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <ul aria-label={statusLine} className="flex flex-col gap-1" data-testid="depot-economics-status">
        {statusRows.map((row) => (
          <li key={row.text} className="flex min-w-0 items-baseline gap-3">
            <span className="w-12 shrink-0 text-right font-mono text-lg tabular-nums text-depot-ink">
              {row.figure}
            </span>
            <span className="min-w-0 font-sans text-[13px] text-depot-muted">{row.text}</span>
          </li>
        ))}
      </ul>
      <div className="flex max-w-3xl flex-col gap-1">
        <p className="depot-prose">
          {INDEX_SEPARATION.lead}
          <Link href={LEAGUE_PATH} className={LINK_CLASS}>
            {INDEX_SEPARATION.linkText}
          </Link>
          {INDEX_SEPARATION.tail}
        </p>
        <p className="depot-prose">{INDEX_LIMITS_NOTE}</p>
        <p className="depot-prose">{FUEL_ONLY_NOTE}</p>
      </div>
      {panel ? (
        <StatePanel kind="not-ranked" sentence={panel.sentence} remedy={panel.remedy} testId="depot-economics-shortfall" />
      ) : null}
      <section aria-labelledby="economics-ranking-title" className="min-w-0">
        <SectionLabel
          id="economics-ranking-title"
          label={panel && !allRows.some((r) => r.ranked) ? 'Unranked depots' : 'Depots'}
          count={rows.length}
          note="Ranked within peer groups of similar fleet size"
        />
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
          <Checkbox
            label="Show unranked"
            checked={filters.showUnranked}
            onChange={(event) => setShowUnrankedChoice(event.target.checked)}
          />
        </div>
        <p className="sr-only" role="status">
          {selected
            ? `Economics breakdown showing for ${selected.name}.`
            : selectedHidden
              ? `The selected depot, ${selectedName}, is hidden by the filters; change them to see its breakdown again.`
              : 'Select Score on a row to see how its index is made up.'}
        </p>
        <div className={selected ? 'grid gap-4 2xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
          <div className="min-w-0">
            <EconomicsGrid
              rows={rows}
              allRows={allRows}
              filters={filters}
              selectedId={selected?.depotId ?? null}
              onSelect={select}
            />
          </div>
          {selected ? (
            <EconomicsBreakdown row={selected} weights={data.weights} headingRef={headingRef} />
          ) : null}
        </div>
      </section>
      <HowProduced paragraphs={disclosure} />
    </div>
  );
}
