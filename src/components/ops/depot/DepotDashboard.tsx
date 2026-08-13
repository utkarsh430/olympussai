import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { groupByDepot, deriveStandbyAvailability } from '@/lib/ops/fleetView';
import { scopeLabel, type OpsFleetScope } from '@/lib/ops/depotScope';
import type { RouteOperationsBoardSnapshot } from '@/lib/controlService/routeBoardData';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import { DataSourceNotice, emptyFleetLabel } from '@/components/ops/DataSourceNotice';
import { FleetRosterGroups } from '@/components/ops/FleetRosterGroups';
import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';
import { RouteOperationsBoard } from '@/components/ops/RouteOperationsBoard';
import { KillSwitchBanner } from '@/components/ops/KillSwitchBanner';
import { BreakdownReportsPanel } from '@/components/ops/BreakdownReportsPanel';

/**
 * Depot dashboard content (AC1/AC2 plus this ticket's route operations
 * board): a vehicle roster, the same departure-order / headway-countdown /
 * standby-availability board dispatcher sees, and a per-vehicle schedule
 * lookup. Presentational — see DispatcherDashboard's doc comment for why.
 *
 * `snapshot` and `routeBoard` ARRIVE ALREADY SCOPED. This component performs
 * no narrowing of its own and must never start: the depot boundary is an
 * authorization boundary enforced server-side in the page
 * (db/migrations/20260812150000__ops_depot_ownership.sql), and a filter
 * applied here as well would create a second, weaker place it appears to be
 * decided — the kind of arrangement where removing the "redundant" UI filter
 * silently reopens the hole. `scope` is taken only to LABEL what the operator
 * is looking at.
 */
export function DepotDashboard({
  snapshot,
  routeBoard,
  activeKillSwitches,
  scope,
}: {
  snapshot: OpsFleetSnapshot;
  routeBoard: RouteOperationsBoardSnapshot;
  activeKillSwitches: KillSwitchRecord[];
  scope: OpsFleetScope;
}) {
  const groups = groupByDepot(snapshot.buses);
  const standby = deriveStandbyAvailability(snapshot.buses);
  const depotLabel = scopeLabel(scope);

  return (
    <div className="space-y-8">
      <DataSourceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />
      <KillSwitchBanner activeKillSwitches={activeKillSwitches} routeDirectionId={routeBoard.selectedRouteDirectionId} />

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Vehicle roster · {depotLabel}
        </h2>
        <FleetRosterGroups
          groups={groups}
          totalVehicles={snapshot.buses.length}
          emptyLabel={emptyFleetLabel(
            snapshot.source,
            `No vehicles from ${depotLabel} are currently reporting.`,
          )}
        />
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Route operations board
        </h2>
        <RouteOperationsBoard snapshot={routeBoard} standby={standby} depotLabel={depotLabel} />
      </section>

      <section>
        <ScheduleLookupForm title="Vehicle schedule lookup" />
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Breakdown reports
        </h2>
        <BreakdownReportsPanel scope="fleet" />
      </section>
    </div>
  );
}
