'use client';

import { ErrorPanel, LoadingBlock, StaleNotice } from '@/components/depot/shell/DataStates';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { DepotParkingState } from '@/hooks/useDepotParking';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { droppedRowsSentence, emptyOrderSentence } from '@/lib/depot/yard/parkingModel';
import type { ParkingResponse } from '@/lib/depot/yard/parkingApi';
import { ParkingPlan } from './ParkingPlan';

/**
 * The night parking order for one depot. The parking request is made once by the
 * yard page (its bay count also feeds the capacity figure) and handed in here, so a
 * failed request shows here with retry while the figures above keep the live counts.
 * Rendered conditionally throughout. Nothing here instructs or dispatches anything.
 */
export function ParkingPlanSection({
  depotId,
  parking,
}: {
  readonly depotId: string;
  readonly parking: DepotParkingState;
}) {
  const { data, error, loading, refresh } = parking;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="parking-section">
      {data && (data.stale || error) ? <StaleNotice since={data.feedNow} /> : null}
      {data ? (
        <PlanArea depotId={depotId} data={data} />
      ) : loading && !error ? (
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

function PlanArea({ depotId, data }: { readonly depotId: string; readonly data: ParkingResponse }) {
  const dropped = droppedRowsSentence(data.droppedRows);
  return (
    <>
      {data.order ? (
        <ParkingPlan depotId={depotId} order={data.order} operatingDate={data.operatingDate} />
      ) : (
        <section aria-labelledby="parking-empty-heading">
          <SectionLabel id="parking-empty-heading" label="Night parking order" tag="modelled" />
          <StatePanel
            kind={data.state === 'no_yard' ? 'not-established' : 'empty'}
            compact
            sentence={emptyOrderSentence(data.state)}
            testId="depot-empty"
          />
        </section>
      )}
      {dropped ? <p className="depot-note">{dropped}</p> : null}
    </>
  );
}
