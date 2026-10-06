'use client';

import { useMemo } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { formatCount } from '@/lib/depot/format';
import { buildYardModel } from '@/lib/depot/yard/yardModel';
import { YardMap } from './YardMap';
import { YardMapLegend } from './YardMapLegend';
import { YardRoll } from './YardRoll';
import { YardSummary } from './YardSummary';

/** Who is physically in this depot's yard right now, on an inferred yard. */
export function YardPage() {
  const { data, error, loading, refresh, depotId } = useDepotDetailContext();
  const network = useDepotNetworkContext();
  const depotNames = useMemo(
    () => new Map((network.data?.depots ?? []).map((depot) => [depot.id, depot.name])),
    [network.data],
  );
  const model = useMemo(() => (data ? buildYardModel(data) : null), [data]);

  if (!data || !model) {
    if (loading && !error) return <LoadingBlock rows={6} label="Loading the yard" />;
    return <ErrorPanel message={error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={refresh} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <YardSummary model={model} />
      {model.established ? (
        <section aria-labelledby="yard-map-heading" className="min-w-0">
          <h2 id="yard-map-heading" className="depot-section-label">
            Yard map
          </h2>
          <YardMap model={model} />
          <p className="mt-2 text-[11px] text-depot-muted" data-testid="yard-map-note">
            {formatCount(model.points.length)} {model.points.length === 1 ? 'bus' : 'buses'} drawn
            {model.beyondCount === 0
              ? '; every bus with a position is drawn.'
              : `; ${formatCount(model.beyondCount)} more with a position lie beyond the map's range and ${model.beyondCount === 1 ? 'is' : 'are'} not shown, see Away from the yard below.`}
          </p>
          <div className="mt-3">
            <YardMapLegend
              visitorsDrawn={model.visitorsDrawn}
              visitorsWithoutPosition={model.visitorsWithoutPosition}
            />
          </div>
        </section>
      ) : null}
      <YardRoll model={model} depotId={depotId} depotNames={depotNames} />
    </div>
  );
}
