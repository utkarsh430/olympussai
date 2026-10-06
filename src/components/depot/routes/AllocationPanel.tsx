'use client';

import { useMemo, type ReactNode } from 'react';
import { ErrorPanel, LoadingBlock } from '@/components/depot/shell/DataStates';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { DepotAllocationState } from '@/hooks/useDepotAllocation';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { moveRows, type UnmovedGroup } from '@/lib/depot/routes/allocationGroups';
import {
  RECOMMENDATION_ONLY,
  allocationHeadline,
  paramsSentence,
  planHeadline,
} from '@/lib/depot/routes/allocationWording';
import type { DepotAllocationResponse } from '@/lib/depot/routes/api';
import { ROUTES_TEXT } from '@/lib/depot/routes/routesPageText';
import { MovesTable } from './MovesTable';
import { ProfileCoverage } from './ProfileCoverage';
import { UnmovedRoutes } from './UnmovedRoutes';

const TITLE_ID = 'allocation-title';

export interface AllocationPanelProps {
  readonly allocation: DepotAllocationResponse;
  readonly groups: readonly UnmovedGroup[];
}

/** The trip definition and the pending-profiles sentence, beside the plan's figures. */
function PlanBasis({ allocation }: { readonly allocation: DepotAllocationResponse }) {
  return (
    <div className="mb-3 max-w-3xl space-y-1">
      <p className="depot-prose text-[13px]">{allocation.tripDefinition}</p>
      {allocation.profilesPendingNote !== null ? (
        <p className="depot-prose text-[13px]" role="status">
          {allocation.profilesPendingNote}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The plan as one panel: a headline sentence (the thresholds in its `title`), the figure
 * band and the recommended moves when something is planned, the unmoved, outside-the-plan
 * and unprofiled routes as collapsed rows with counts. When nothing can be planned it draws
 * nothing: the loader row above it carries the sentence (see the section).
 */
export function AllocationPanel({ allocation, groups }: AllocationPanelProps) {
  const h = useMemo(() => allocationHeadline(allocation), [allocation]);
  const rows = useMemo(() => moveRows(allocation.moves), [allocation.moves]);
  // Nothing planned: the section is the loader's one row (its sentence says why).
  if (!h.planned) return null;
  return (
    <>
      <p
        className="mb-3 max-w-3xl font-sans text-sm leading-[1.55] text-depot-ink"
        title={paramsSentence(allocation.params)}
        data-testid="allocation-headline"
      >
        {planHeadline(allocation)}
      </p>
      <FigureBand label="Dead kilometres a day, modelled">
        <Figure label={ROUTES_TEXT.savedLabel} value={h.saving} caption={ROUTES_TEXT.kmADay} />
        <Figure label={ROUTES_TEXT.nowLabel} value={h.now} caption={ROUTES_TEXT.kmADay} />
        <Figure label={ROUTES_TEXT.afterLabel} value={h.after} caption={ROUTES_TEXT.kmADay} />
      </FigureBand>
      <PlanBasis allocation={allocation} />
      {rows.length > 0 ? (
        <>
          <h3 className="depot-label mb-2 mt-5">{ROUTES_TEXT.movesTitle}</h3>
          <MovesTable rows={rows} />
        </>
      ) : null}
      <UnmovedRoutes groups={groups} />
      <div className="mt-3 border-t border-depot-line">
        <ProfileCoverage profiled={allocation.coverage.profiled} />
      </div>
    </>
  );
}

export interface AllocationSectionProps {
  readonly state: DepotAllocationState;
  readonly groups: readonly UnmovedGroup[];
  readonly loader: ReactNode;
}

/**
 * The plan section: its label (MODELLED, recommendation only), the route-details loader's
 * row, then the plan, its loading footprint or its error. The loader keeps one position in
 * every state, so a plan that fills mid-run never unmounts (and so cancels) it.
 */
export function AllocationSection({ state, groups, loader }: AllocationSectionProps) {
  const { data, error, loading, refresh } = state;
  return (
    <section aria-labelledby={TITLE_ID} className="mb-8 min-w-0">
      <SectionLabel id={TITLE_ID} label={ROUTES_TEXT.allocationTitle} tag="modelled" note={RECOMMENDATION_ONLY} />
      {loader}
      {loading ? (
        <LoadingBlock rows={3} rowHeight={48} label="Loading the allocation plan" />
      ) : data ? (
        <AllocationPanel allocation={data} groups={groups} />
      ) : (
        <ErrorPanel
          title="Allocation plan unavailable"
          message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
          onRetry={refresh}
        />
      )}
    </section>
  );
}
