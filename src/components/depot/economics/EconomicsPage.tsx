'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorPanel, StaleStrip } from '@/components/depot/shell/DataStates';
import { Checkbox } from '@/components/depot/shell/Controls';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { useDepotEconomics } from '@/hooks/useDepotEconomics';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import type { ProvenanceDescription } from '@/lib/depot/provenanceLine';
import {
  ECONOMICS_SIGN_NOTE,
  ECONOMICS_TABLE_NOTE,
  FUEL_ONLY_NOTE,
  INDEX_LIMITS_NOTE,
  INDEX_SEPARATION,
  buildEconomicsRows,
  defaultShowUnranked,
  economicsBand,
  economicsDaySentence,
  economicsDisclosure,
  filterEconomicsRows,
  lengthCoverageLine,
  notRankedPanel,
  rankingShortfallNotice,
  type EconomicsFilters,
  type EconomicsRow,
} from '@/lib/depot/revenue/economicsPageModel';
import type { EconomicsResponse } from '@/lib/depot/revenue/api';
import { modelledStatement } from '@/lib/depot/revenue/revenuePageModel';
import { REVENUE_MODEL_PARAMS } from '@/lib/depot/sim/revenueConfig';
import { EconomicsBreakdown } from './EconomicsBreakdown';
import { EconomicsGrid } from './EconomicsGrid';
import { breakdownButtonName } from '@/lib/depot/revenue/economicsLayout';

const LEAGUE_PATH = '/project/depots/league';
const ROUTES_PATH = '/project/depots/routes';
const SOURCES_PATH = '/project/depots/sources';
const HOW_ID = 'economics-how';
const REPLACED_BY = 'each of the fuel issue, odometer, ticketing and route master feeds';

/** The page's provenance line: MODELLED in every state, with the dated day once it is known. */
export function economicsProvenance(operatingDate: string | null): ProvenanceDescription {
  return operatingDate === null
    ? { default: 'modelled', replacedBy: REPLACED_BY }
    : {
        default: 'modelled',
        replacedBy: REPLACED_BY,
        modelledDay: economicsDaySentence(operatingDate),
      };
}

/**
 * Depots ranked by the MODELLED Depot Economics Index within peer groups. The
 * header lives here so its provenance line can carry the modelled day. The
 * selected depot's breakdown opens beside the table from `2xl` and below it
 * otherwise. No Depot Efficiency Index value is shown here.
 */
export function EconomicsPage() {
  const { data, error, loading, refresh } = useDepotEconomics();
  return (
    <>
      <PageHeader
        title="Economics"
        description="Depots ranked on earnings, fuel cost and load factor within peer groups."
        provenanceLine={economicsProvenance(data?.operatingDate ?? null)}
      />
      {loading ? (
        <StatePanel kind="loading" rows={10} sentence="Loading the economics ranking" />
      ) : !data ? (
        <ErrorPanel
          title="Could not load the economics ranking"
          message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
          onRetry={refresh}
        />
      ) : data.depots.length === 0 ? (
        <StatePanel
          kind="empty"
          sentence="The live feed returned no depots, so there is nothing to rank yet."
        />
      ) : (
        <EconomicsBody data={data} error={error} />
      )}
    </>
  );
}

function EconomicsBody({
  data,
  error,
}: {
  readonly data: EconomicsResponse;
  readonly error: string | null;
}) {
  const [search, setSearch] = useState('');
  // Null until the reader chooses: then it follows the data (all depots when none is ranked).
  const [showUnrankedChoice, setShowUnrankedChoice] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusPending, setFocusPending] = useState(false);
  const breakdownRef = useRef<HTMLElement>(null);

  const allRows = useMemo(
    () => buildEconomicsRows(data.depots, data.operatingDate),
    [data.depots, data.operatingDate],
  );
  const filters = useMemo<EconomicsFilters>(
    () => ({ search, showUnranked: showUnrankedChoice ?? defaultShowUnranked(allRows) }),
    [search, showUnrankedChoice, allRows],
  );
  const rows = useMemo(() => filterEconomicsRows(allRows, filters), [allRows, filters]);
  const panel = useMemo(() => notRankedPanel(data.depots), [data.depots]);
  const band = useMemo(() => economicsBand(data.depots), [data.depots]);
  const disclosure = useMemo(
    () =>
      economicsDisclosure(modelledStatement(REVENUE_MODEL_PARAMS), lengthCoverageLine(data.depots)),
    [data.depots],
  );
  const shortfall = useMemo(() => rankingShortfallNotice(data.depots), [data.depots]);
  const select = useCallback((row: EconomicsRow): void => {
    setSelectedId(row.depotId);
    setFocusPending(true);
  }, []);
  // The selection outlives a filter that hides it, so relaxing the filter reopens it.
  const selected =
    selectedId === null ? null : (rows.find((r) => r.depotId === selectedId) ?? null);
  const selectedHidden = selectedId !== null && selected === null;
  const selectedName = allRows.find((r) => r.depotId === selectedId)?.name ?? 'the depot';
  const noneRanked = !allRows.some((r) => r.ranked);

  // Move focus to the breakdown so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (!focusPending || selected === null || breakdownRef.current === null) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    breakdownRef.current.focus({ preventScroll: true });
    breakdownRef.current.scrollIntoView({
      block: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    setFocusPending(false);
  }, [focusPending, selected]);

  return (
    <div className="depot-stack min-w-0">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      {panel ? (
        <StatePanel
          kind="not-ranked"
          sentence={panel.sentence}
          remedy={panel.remedy}
          testId="depot-economics-shortfall"
          howLink={{ label: 'How depots are ranked', targetId: HOW_ID }}
          action={
            <Link href={ROUTES_PATH} className="depot-link">
              Open a route on the Routes page ›
            </Link>
          }
        />
      ) : (
        <FigureBand label="Ranking">
          {band.map((f) => (
            <Figure key={f.label} label={f.label} value={f.value} caption={f.caption} />
          ))}
        </FigureBand>
      )}
      <section aria-labelledby="economics-ranking-title" className="min-w-0">
        <SectionLabel
          id="economics-ranking-title"
          label={noneRanked ? 'Unranked depots' : 'Depots'}
          tag="modelled"
          note={ECONOMICS_TABLE_NOTE}
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
        {/* One line above the header row: what the signed suffix in each cell means. */}
        <p
          className="depot-note mb-2 truncate"
          title={ECONOMICS_SIGN_NOTE}
          data-testid="depot-economics-table-caption"
        >
          {ECONOMICS_SIGN_NOTE}
        </p>
        <p className="sr-only" role="status">
          {selected
            ? `${breakdownButtonName(selected.name)} is showing.`
            : selectedHidden
              ? `The selected depot, ${selectedName}, is hidden by the filters; change them to see its breakdown again.`
              : 'Select a depot’s economics index to see how it is made up.'}
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
            <EconomicsBreakdown row={selected} weights={data.weights} headingRef={breakdownRef} />
          ) : null}
        </div>
      </section>
      <HowProduced id={HOW_ID} paragraphs={disclosure}>
        <p className="depot-prose">
          {INDEX_SEPARATION.lead}
          <Link href={LEAGUE_PATH} className="depot-link">
            {INDEX_SEPARATION.linkText}
          </Link>
          {INDEX_SEPARATION.tail}
        </p>
        <p className="depot-prose">{INDEX_LIMITS_NOTE}</p>
        <p className="depot-prose">{FUEL_ONLY_NOTE}</p>
        {shortfall ? (
          <p className="depot-prose">
            {shortfall.lead}
            <Link href={ROUTES_PATH} className="depot-link">
              {shortfall.linkText}
            </Link>
            {shortfall.tail}
          </p>
        ) : null}
        <p className="depot-prose">
          The fields each feed must provide are listed on the{' '}
          <Link href={SOURCES_PATH} className="depot-link">
            Data sources page
          </Link>
          .
        </p>
      </HowProduced>
    </div>
  );
}
