'use client';

import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { useDepotParking } from '@/hooks/useDepotParking';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import {
  capacityViewOf,
  droppedRowsSentence,
  emptyOrderSentence,
} from '@/lib/depot/yard/parkingModel';
import type { ParkingResponse } from '@/lib/depot/yard/parkingApi';
import { ParkingPlan } from './ParkingPlan';
import { YardCapacity } from './YardCapacity';

/**
 * Yard capacity and the night parking order for one depot. The capacity counts
 * come from the depot detail the page already holds, so a failed parking
 * request leaves them on screen; only the modelled bay count and the lane order
 * come from the parking endpoint, and the plan area shows that failure with
 * retry. Rendered conditionally throughout: no element is hidden by an
 * attribute. Nothing here instructs or dispatches anything.
 */
export function ParkingPlanSection({ depotId }: { readonly depotId: string }) {
  const { data, error, loading, refresh } = useDepotParking(depotId);
  const { data: detail } = useDepotDetailContext();
  const capacity = detail ? capacityViewOf(detail, data?.capacity.bays.value ?? null) : null;
  const baysPending = !data && loading && !error;

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="parking-section">
      {data && (data.stale || error) ? <StaleStrip since={data.feedNow} /> : null}
      {capacity ? <YardCapacity capacity={capacity} baysPending={baysPending} /> : null}
      {data ? (
        <PlanArea depotId={depotId} data={data} />
      ) : baysPending ? (
        <LoadingBlock rows={4} rowHeight={48} label="Loading parking" />
      ) : (
        <ErrorPanel
          title="Parking plan unavailable"
          message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
          onRetry={refresh}
        />
      )}
    </div>
  );
}

function PlanArea({
  depotId,
  data,
}: {
  readonly depotId: string;
  readonly data: ParkingResponse;
}) {
  const dropped = droppedRowsSentence(data.droppedRows);
  if (data.order) {
    return (
      <>
        <ParkingPlan depotId={depotId} order={data.order} operatingDate={data.operatingDate} />
        {dropped ? <p className="depot-prose text-xs">{dropped}</p> : null}
      </>
    );
  }
  return (
    <section aria-labelledby="parking-empty-heading">
      <h2 id="parking-empty-heading" className="depot-section-label">
        Night parking order
      </h2>
      <EmptyState>{emptyOrderSentence(data.state)}</EmptyState>
      {dropped ? <p className="depot-prose mt-2 text-xs">{dropped}</p> : null}
    </section>
  );
}
