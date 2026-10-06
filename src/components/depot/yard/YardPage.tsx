'use client';

import { useMemo } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { useDepotParking } from '@/hooks/useDepotParking';
import { capacityViewOf, PLAN_NOTICE } from '@/lib/depot/yard/parkingModel';
import { buildYardModel, DISPLAY_RADIUS_FACTOR, type YardModel } from '@/lib/depot/yard/yardModel';
import { capacityFigure, heldSinceLine, mapCaption } from '@/lib/depot/yard/yardPageModel';
import { YardMap } from './YardMap';
import { ParkingPlanSection } from './ParkingPlanSection';
import { YardMapLegend } from './YardMapLegend';
import { YardRoll } from './YardRoll';
import { YardFigures, YardNotEstablished } from './YardSummary';

function MapSection({ model }: { readonly model: YardModel }) {
  const held = heldSinceLine(model.yard);
  return (
    <section aria-labelledby="yard-map-heading" className="min-w-0">
      <SectionLabel id="yard-map-heading" label="Yard map" note={held ?? undefined} />
      <YardMap model={model} />
      <YardMapLegend caption={mapCaption(model)} />
    </section>
  );
}

/** Definitions and limits, said once, closed by default. */
function HowProduced({
  model,
  capacityTitle,
}: {
  readonly model: YardModel;
  readonly capacityTitle: string;
}) {
  return (
    <details className="border-t border-depot-line pt-3" data-testid="yard-how">
      <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.16em] text-depot-muted">
        How these figures are produced
      </summary>
      <div className="depot-prose mt-2 max-w-[62ch] space-y-2 text-[13px]">
        <p>{model.basis}</p>
        <p>
          The yard circle is inferred from where this depot&apos;s buses park; it is not a surveyed
          boundary. Buses further than {DISPLAY_RADIUS_FACTOR} radii from its centre are not drawn.
          A filled dot is one of this depot&apos;s buses; a ring is a bus from another depot.
        </p>
        <p>
          {capacityTitle} Bays come from the depot master, not a survey, so capacity is MODELLED.
        </p>
        <p>{PLAN_NOTICE}</p>
      </div>
    </details>
  );
}

/** Who is physically in this depot's yard right now, on an inferred yard. */
export function YardPage() {
  const { data, error, loading, refresh, depotId } = useDepotDetailContext();
  const network = useDepotNetworkContext();
  const parking = useDepotParking(depotId);
  const depotNames = useMemo(
    () => new Map((network.data?.depots ?? []).map((depot) => [depot.id, depot.name])),
    [network.data],
  );
  const model = useMemo(() => (data ? buildYardModel(data) : null), [data]);
  const outOfLane = useMemo(
    () =>
      new Set((parking.data?.order?.overflow ?? []).map((bus) => bus.registrationNumber.trim())),
    [parking.data],
  );

  if (!data || !model) {
    if (loading && !error) return <LoadingBlock rows={6} label="Loading the yard" />;
    return (
      <ErrorPanel
        title="Could not load the yard"
        message={error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={refresh}
      />
    );
  }

  const capacity = capacityViewOf(data, parking.data?.capacity.bays.value ?? null);
  const baysPending = !parking.data && parking.loading && !parking.error;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <YardFigures model={model} capacity={capacity} baysPending={baysPending} />
      {model.established ? <MapSection model={model} /> : <YardNotEstablished model={model} />}
      <YardRoll model={model} depotId={depotId} depotNames={depotNames} outOfLane={outOfLane} />
      <ParkingPlanSection depotId={depotId} parking={parking} />
      <HowProduced model={model} capacityTitle={capacityFigure(capacity, baysPending).title} />
    </div>
  );
}
