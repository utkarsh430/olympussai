import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { groupByDepot } from '@/lib/ops/fleetView';
import { DataSourceNotice } from '@/components/ops/DataSourceNotice';
import { FleetRosterGroups } from '@/components/ops/FleetRosterGroups';
import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';

/**
 * Depot dashboard content (AC1/AC2): a vehicle roster grouped by depot,
 * plus a per-vehicle schedule lookup. Presentational — see
 * DispatcherDashboard's doc comment for why.
 */
export function DepotDashboard({ snapshot }: { snapshot: OpsFleetSnapshot }) {
  const groups = groupByDepot(snapshot.buses);

  return (
    <div className="space-y-8">
      <DataSourceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Vehicle roster by depot
        </h2>
        <FleetRosterGroups groups={groups} totalVehicles={snapshot.buses.length} />
      </section>

      <section>
        <ScheduleLookupForm title="Vehicle schedule lookup" />
      </section>
    </div>
  );
}
