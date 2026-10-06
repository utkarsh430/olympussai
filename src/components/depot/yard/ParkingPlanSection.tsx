'use client';

import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { useDepotParking } from '@/hooks/useDepotParking';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { emptyOrderSentence } from '@/lib/depot/yard/parkingModel';
import { ParkingPlan } from './ParkingPlan';
import { YardCapacity } from './YardCapacity';

/**
 * Yard capacity and tonight's parking order for one depot, fetched from the
 * parking view. Rendered conditionally throughout: no element is hidden by an
 * attribute. Nothing here instructs or dispatches anything.
 */
export function ParkingPlanSection({ depotId }: { readonly depotId: string }) {
  const { data, error, loading, refresh } = useDepotParking(depotId);

  if (!data) {
    if (loading && !error) return <LoadingBlock rows={4} rowHeight={48} label="Loading parking" />;
    return <ErrorPanel message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="parking-section">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <YardCapacity capacity={data.capacity} />
      {data.order ? (
        <ParkingPlan depotId={depotId} order={data.order} operatingDate={data.operatingDate} />
      ) : (
        <section aria-labelledby="parking-empty-heading">
          <h2 id="parking-empty-heading" className="depot-section-label">
            Night parking order
          </h2>
          <EmptyState>{emptyOrderSentence(data.state)}</EmptyState>
        </section>
      )}
    </div>
  );
}
