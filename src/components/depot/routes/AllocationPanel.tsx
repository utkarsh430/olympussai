'use client';

import { useMemo } from 'react';
import { EmptyState, ErrorPanel, LoadingBlock } from '@/components/depot/shell/DataStates';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { DepotAllocationState } from '@/hooks/useDepotAllocation';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { moveRows } from '@/lib/depot/routes/allocationGroups';
import {
  DEAD_KM_MEANING,
  RECOMMENDATION_ONLY,
  TRIP_MEANING,
  allocationHeadline,
  paramsSentence,
} from '@/lib/depot/routes/allocationWording';
import type { DepotAllocationResponse } from '@/lib/depot/routes/api';
import { ROUTES_TEXT } from '@/lib/depot/routes/routesPageText';
import type { Coverage } from '@/lib/depot/types';
import { MovesTable } from './MovesTable';

const TITLE_ID = 'allocation-title';

function KmFigure({
  label,
  value,
  coverage,
  hero = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly coverage: Coverage | undefined;
  readonly hero?: boolean;
}) {
  return (
    <div className={`depot-kpi-cell ${hero ? 'col-span-2' : ''}`}>
      <dt className="flex flex-wrap items-center gap-2">
        <span className="depot-label">{label}</span>
        <ProvenanceBadge provenance="modelled" coverage={coverage} />
      </dt>
      <dd
        className={`mt-2 min-w-0 [overflow-wrap:anywhere] ${
          hero ? 'depot-hero-numeral' : 'font-mono text-[20px] tabular-nums text-depot-ink'
        }`}
      >
        {value}
      </dd>
      <dd className="depot-prose text-xs">{ROUTES_TEXT.kmADay}</dd>
    </div>
  );
}

/** The hero: totals before and after, what would move and why the rest would not. */
export function AllocationPanel({ allocation }: { readonly allocation: DepotAllocationResponse }) {
  const h = useMemo(() => allocationHeadline(allocation), [allocation]);
  const rows = useMemo(() => moveRows(allocation.moves), [allocation.moves]);
  return (
    <>
      {h.planned ? (
        <dl className="depot-kpi-grid">
          <KmFigure
            label={ROUTES_TEXT.savedLabel}
            value={h.saving}
            coverage={allocation.savedKmPerDay.coverage}
            hero
          />
          <KmFigure label={ROUTES_TEXT.nowLabel} value={h.now} coverage={allocation.beforeKmPerDay.coverage} />
          <KmFigure
            label={ROUTES_TEXT.afterLabel}
            value={h.after}
            coverage={allocation.afterKmPerDay.coverage}
          />
        </dl>
      ) : (
        <EmptyState>{h.emptyLine}</EmptyState>
      )}
      <div className="mt-3 max-w-3xl space-y-1.5">
        <p className="font-sans text-sm leading-[1.55] text-depot-ink">{h.movesLine}</p>
        {h.stayLine ? <p className="depot-prose">{h.stayLine}</p> : null}
        {h.excludedLine ? <p className="depot-prose">{h.excludedLine}</p> : null}
        <p className="depot-prose">{h.coverageLine}</p>
        <p className="depot-prose">
          <ProvenanceBadge provenance="derived" /> {h.positionsLine} {DEAD_KM_MEANING}
        </p>
        <p className="depot-prose">
          <ProvenanceBadge provenance="modelled" /> {TRIP_MEANING}
        </p>
        <p className="depot-prose">{paramsSentence(allocation.params)}</p>
      </div>
      {rows.length > 0 ? (
        <>
          <h3 className="depot-label mb-2 mt-5">{ROUTES_TEXT.movesTitle}</h3>
          <MovesTable rows={rows} />
        </>
      ) : null}
    </>
  );
}

/** The allocation block with its loading, error and recommendation-only states. */
export function AllocationSection({ state }: { readonly state: DepotAllocationState }) {
  const { data, error, loading, refresh } = state;
  return (
    <section aria-labelledby={TITLE_ID} className="mb-10">
      <h2 id={TITLE_ID} className="depot-section-label">
        {ROUTES_TEXT.allocationTitle}
      </h2>
      <p className="mb-3 font-sans text-sm leading-[1.55] text-depot-ink">{RECOMMENDATION_ONLY}</p>
      {loading ? (
        <LoadingBlock rows={4} rowHeight={48} label="Loading the allocation plan" />
      ) : data ? (
        <AllocationPanel allocation={data} />
      ) : (
        <ErrorPanel message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />
      )}
    </section>
  );
}
