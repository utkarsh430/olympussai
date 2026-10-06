'use client';

import { useMemo } from 'react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { HowProduced as ClosingDisclosure } from '@/components/depot/shell/HowProduced';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/useDepotNetwork';
import { useDepotParking } from '@/hooks/useDepotParking';
import { capacityViewOf, PLAN_NOTICE } from '@/lib/depot/yard/parkingModel';
import { buildYardModel, DISPLAY_RADIUS_FACTOR, type YardModel } from '@/lib/depot/yard/yardModel';
import { capacityFigure, heldSinceLine, mapCaption } from '@/lib/depot/yard/yardPageModel';
import { YardMap } from './YardMap';
import { ParkingPlanSection } from './ParkingPlanSection';
import { YardMapKey, YardMapNote } from './YardMapLegend';
import { YardRoll } from './YardRoll';
import { HOW_ID, YardFigures, YardNotEstablished } from './YardSummary';

interface MapSectionProps {
  readonly model: YardModel;
  /** The feed's clock: a yard held since an earlier day says that day. */
  readonly feedNow: string | null;
}

function MapSection({ model, feedNow }: MapSectionProps) {
  const held = heldSinceLine(model.yard, feedNow);
  return (
    <section aria-labelledby="yard-map-heading" className="min-w-0">
      <SectionLabel id="yard-map-heading" label="Yard map" note={held ?? undefined} />
      {/* relative: the key is placed inside the map's bottom-left from 640px. */}
      <div className="relative min-w-0" data-testid="yard-map-wrap">
        <YardMap model={model} />
        <YardMapKey />
      </div>
      <YardMapNote caption={mapCaption(model)} />
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
    <ClosingDisclosure testId="yard-how" id={HOW_ID}>
        <p className="depot-prose">{model.basis}</p>
        {model.rule ? <p className="depot-prose">{model.rule}</p> : null}
        <p className="depot-prose">
          The yard circle is inferred from where this depot&apos;s buses park; it is not a surveyed
          boundary. Buses further than {DISPLAY_RADIUS_FACTOR} radii from its centre are not drawn.
          A filled dot is one of this depot&apos;s buses; a ring is a bus from another depot.
        </p>
        <p className="depot-prose">
          {capacityTitle} Bays come from the depot master, not a survey, so capacity is MODELLED.
        </p>
        <p className="depot-prose">{PLAN_NOTICE}</p>
    </ClosingDisclosure>
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
    <div className="depot-stack min-w-0">
      {data.stale || error ? <StaleStrip since={data.feedNow} /> : null}
      <YardFigures model={model} capacity={capacity} baysPending={baysPending} />
      {model.established ? (
        <MapSection model={model} feedNow={data.feedNow} />
      ) : (
        <YardNotEstablished model={model} snapshotsSeen={data.yardSnapshotsSeen} />
      )}
      <YardRoll model={model} depotId={depotId} depotNames={depotNames} />
      <ParkingPlanSection depotId={depotId} parking={parking} />
      <HowProduced model={model} capacityTitle={capacityFigure(capacity, baysPending).title} />
    </div>
  );
}
