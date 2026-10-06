'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/hooks/useDepotDetail';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import { useDepotDuties } from '@/hooks/useDepotDuties';
import {
  COST_SENTENCE,
  MODEL_NOTICE,
  buildBoardRows,
  emptyDutiesSentence,
  routesWithoutDutySentence,
  spareSentence,
  summarySentence,
} from '@/lib/depot/duties/dutyBoardModel';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { DutyBoard } from './DutyBoard';

const LOADING_BOARD_HEIGHT_PX = 420;

/** Footprint of the board: the notice, the summary line, then the chart frame. */
function DutiesLoading() {
  return (
    <div data-testid="duties-loading" className="space-y-4">
      <LoadingBlock rows={2} rowHeight={20} label="Loading the duty board" />
      <LoadingBlock rows={1} rowHeight={LOADING_BOARD_HEIGHT_PX} label="Loading the timeline" />
    </div>
  );
}

function UnknownDepot({ depotId }: { readonly depotId: string }) {
  return (
    <div data-testid="duties-unknown">
      <EmptyState>
        No depot has the id {depotId} in the current feed.{' '}
        <Link href={DEPOTS_ROOT} className="depot-link">
          Back to the network overview
        </Link>
      </EmptyState>
    </div>
  );
}

/**
 * The day's modelled duties for one depot with the buses the matching proposes
 * for them. Duties are MODELLED; buses and their states are live. Nothing here
 * assigns or dispatches anything.
 */
export function DutyPage({ depotId }: { readonly depotId: string }) {
  const { data, error, loading, refresh } = useDepotDuties(depotId);
  const rows = useMemo(() => (data ? buildBoardRows(data.duties) : []), [data]);

  if (!data) {
    if (error === DEPOT_NOT_FOUND_MESSAGE) return <UnknownDepot depotId={depotId} />;
    if (loading || !error) return <DutiesLoading />;
    return <ErrorPanel message={error || DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />;
  }

  const withoutDuty = routesWithoutDutySentence(data.routesWithoutDuty);
  return (
    <div data-testid="duties-page" className="space-y-4">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <p className="depot-prose" data-testid="duties-notice">
        {MODEL_NOTICE}
      </p>
      {rows.length === 0 ? (
        <EmptyState>{emptyDutiesSentence(data)}</EmptyState>
      ) : (
        <>
          <p className="depot-prose" role="status" data-testid="duties-summary">
            {summarySentence(data.counts)}
          </p>
          <DutyBoard depotId={depotId} rows={rows} feedNow={data.feedNow} />
          <p className="depot-prose text-xs" data-testid="duties-cost">
            {COST_SENTENCE}
          </p>
          <p className="depot-prose text-xs" data-testid="duties-spare">
            {spareSentence(data.spareBuses)}
          </p>
        </>
      )}
      {withoutDuty === null ? null : (
        <p className="depot-prose text-xs" data-testid="duties-routes-without">
          {withoutDuty}
        </p>
      )}
    </div>
  );
}
