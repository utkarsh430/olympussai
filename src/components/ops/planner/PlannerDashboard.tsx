import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { groupByRoute } from '@/lib/ops/fleetView';
import { DataSourceNotice, emptyFleetLabel } from '@/components/ops/DataSourceNotice';
import { FleetRosterGroups } from '@/components/ops/FleetRosterGroups';
import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';

/**
 * Planner dashboard content (AC1/AC2): a route/schedule roster grouped by
 * route, plus a per-vehicle schedule lookup for route/schedule planning.
 * Presentational — see DispatcherDashboard's doc comment for why.
 */
export function PlannerDashboard({ snapshot }: { snapshot: OpsFleetSnapshot }) {
  const groups = groupByRoute(snapshot.buses);

  return (
    <div className="space-y-8">
      <DataSourceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Route roster
        </h2>
        <FleetRosterGroups
          groups={groups}
          totalVehicles={snapshot.buses.length}
          emptyLabel={emptyFleetLabel(snapshot.source, 'No vehicles currently reporting.')}
        />
      </section>

      <section>
        <ScheduleLookupForm title="Vehicle schedule lookup" />
      </section>
    </div>
  );
}
