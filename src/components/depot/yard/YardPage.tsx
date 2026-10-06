'use client';

import { useMemo } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { formatCount } from '@/lib/depot/format';
import { buildYardModel } from '@/lib/depot/yard/yardModel';
import { YardMap } from './YardMap';
import { YardMapLegend } from './YardMapLegend';
import { YardRoll } from './YardRoll';
import { YardSummary } from './YardSummary';

/** Who is physically in this depot's yard right now, on an inferred yard. */
export function YardPage() {
  const { data, error, loading, refresh, depotId } = useDepotDetailContext();
  const model = useMemo(() => (data ? buildYardModel(data) : null), [data]);

  if (!data || !model) {
    if (error) return <ErrorPanel message={error} onRetry={refresh} />;
    return loading ? <LoadingBlock rows={6} label="Loading the yard" /> : null;
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
            {model.beyondCount === 0
              ? 'Every bus with a position is drawn.'
              : `${formatCount(model.beyondCount)} ${model.beyondCount === 1 ? 'bus' : 'buses'} with a position lie beyond the map's range and ${model.beyondCount === 1 ? 'is' : 'are'} not shown; see Away from the yard below.`}
          </p>
          <div className="mt-3">
            <YardMapLegend showVisitors={model.points.some((p) => p.relation === 'visiting')} />
          </div>
        </section>
      ) : null}
      <YardRoll model={model} depotId={depotId} />
    </div>
  );
}
