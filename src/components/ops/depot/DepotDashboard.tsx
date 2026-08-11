import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { groupByDepot, deriveStandbyAvailability } from '@/lib/ops/fleetView';
import type { RouteOperationsBoardSnapshot } from '@/lib/controlService/routeBoardData';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import { DataSourceNotice, emptyFleetLabel } from '@/components/ops/DataSourceNotice';
import { FleetRosterGroups } from '@/components/ops/FleetRosterGroups';
import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';
import { RouteOperationsBoard } from '@/components/ops/RouteOperationsBoard';
import { KillSwitchBanner } from '@/components/ops/KillSwitchBanner';

/**
 * Depot dashboard content (AC1/AC2 plus this ticket's route operations
 * board): a vehicle roster grouped by depot, the same departure-order /
 * headway-countdown / standby-availability board dispatcher sees, and a
 * per-vehicle schedule lookup. Presentational — see DispatcherDashboard's
 * doc comment for why.
 */
export function DepotDashboard({
  snapshot,
  routeBoard,
  activeKillSwitches,
}: {
  snapshot: OpsFleetSnapshot;
  routeBoard: RouteOperationsBoardSnapshot;
  activeKillSwitches: KillSwitchRecord[];
}) {
  const groups = groupByDepot(snapshot.buses);
  const standby = deriveStandbyAvailability(snapshot.buses);

  return (
    <div className="space-y-8">
      <DataSourceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />
      <KillSwitchBanner activeKillSwitches={activeKillSwitches} routeDirectionId={routeBoard.selectedRouteDirectionId} />

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Vehicle roster by depot
        </h2>
        <FleetRosterGroups
          groups={groups}
          totalVehicles={snapshot.buses.length}
          emptyLabel={emptyFleetLabel(snapshot.source, 'No vehicles currently reporting.')}
        />
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Route operations board
        </h2>
        <RouteOperationsBoard snapshot={routeBoard} standby={standby} depotLabel="all depots" />
      </section>

      <section>
        <ScheduleLookupForm title="Vehicle schedule lookup" />
      </section>
    </div>
  );
}
