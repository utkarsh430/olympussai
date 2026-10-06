'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorPanel, StaleNotice } from '@/components/depot/shell/DataStates';
import { Checkbox, FilterRow, SearchField } from '@/components/depot/shell/Controls';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { rowActionName } from '@/components/depot/shell/tableLayout';
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

type FocusTarget = { readonly kind: 'breakdown' } | { readonly kind: 'row'; readonly name: string };

/** The depot's row in the table, found by the name the shared row carries when closed. */
function rowElement(table: HTMLElement | null, name: string): HTMLElement | null {
  const label = rowActionName(name, { kind: 'expand', open: false });
  const rows = table?.querySelectorAll<HTMLElement>('tr[aria-expanded]') ?? [];
  return [...rows].find((row) => row.getAttribute('aria-label') === label) ?? null;
}

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
 * header lives here so its provenance line can carry the modelled day. A
 * depot's breakdown opens as the expanded row directly under its row; focus moves
 * into it and returns to the row when it closes. No Depot Efficiency Index value
 * is shown here.
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const breakdownRef = useRef<HTMLElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

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
  const openChange = useCallback(
    (next: string | null): void => {
      const closing = next === null ? openId : null;
      setOpenId(next);
      if (next !== null) setFocusTarget({ kind: 'breakdown' });
      else if (closing !== null) {
        const name = allRows.find((r) => r.depotId === closing)?.name;
        if (name !== undefined) setFocusTarget({ kind: 'row', name });
      }
    },
    [openId, allRows],
  );
  // The open row outlives a filter that hides it, so relaxing the filter reopens it.
  const open = openId === null ? null : (rows.find((r) => r.depotId === openId) ?? null);
  const openHidden = openId !== null && open === null;
  const openName = allRows.find((r) => r.depotId === openId)?.name ?? 'the depot';
  const noneRanked = !allRows.some((r) => r.ranked);

  // Focus moves into the breakdown when it opens and back to its row when it closes.
  useEffect(() => {
    if (focusTarget === null) return;
    setFocusTarget(null);
    if (focusTarget.kind === 'row') {
      rowElement(tableRef.current, focusTarget.name)?.focus();
      return;
    }
    const panel = breakdownRef.current;
    if (panel === null) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [focusTarget]);

  return (
    <div className="depot-stack min-w-0">
      {data.stale || error ? <StaleNotice since={data.feedNow} /> : null}
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
        <div className="mb-3">
          <FilterRow label="Filter depots">
            <SearchField
              label="Search depots"
              value={filters.search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Checkbox
              label="Show unranked"
              checked={filters.showUnranked}
              onChange={(event) => setShowUnrankedChoice(event.target.checked)}
            />
          </FilterRow>
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
          {open
            ? `${breakdownButtonName(open.name)} is showing.`
            : openHidden
              ? `The open depot, ${openName}, is hidden by the filters; change them to see its breakdown again.`
              : 'Open a depot’s row to see how its economics index is made up.'}
        </p>
        <div ref={tableRef} className="min-w-0">
          <EconomicsGrid
            rows={rows}
            allRows={allRows}
            filters={filters}
            openId={openId}
            onOpenChange={openChange}
            renderBreakdown={(row) => (
              <EconomicsBreakdown
                row={row}
                weights={data.weights}
                headingRef={breakdownRef}
                onClose={() => openChange(null)}
              />
            )}
          />
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
