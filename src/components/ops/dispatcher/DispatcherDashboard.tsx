import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { filterFleet, deriveStandbyAvailability } from '@/lib/ops/fleetView';
import type { RouteOperationsBoardSnapshot } from '@/lib/controlService/routeBoardData';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import { DataSourceNotice, emptyFleetLabel } from '@/components/ops/DataSourceNotice';
import { FleetSearchForm } from '@/components/ops/FleetSearchForm';
import { FleetStatusTable } from '@/components/ops/FleetStatusTable';
import { RouteOperationsBoard } from '@/components/ops/RouteOperationsBoard';
import { KillSwitchBanner } from '@/components/ops/KillSwitchBanner';
import { ApprovalQueuePanel } from '@/components/ops/ApprovalQueuePanel';
import { BreakdownReportsPanel } from '@/components/ops/BreakdownReportsPanel';
import { DispatcherActionForm } from './DispatcherActionForm';

const DEFAULT_ROW_LIMIT = 25;

/**
 * Dispatcher dashboard content (this ticket's AC1/AC2/AC3). Presentational
 * — takes already-fetched data as props so it can be unit-tested directly
 * (src/tests/unit/opsDashboards.test.tsx) without a Next.js server request
 * context, and rendered from the Server Component page
 * (src/app/(ops)/ops/dispatcher/page.tsx) with real fetched data.
 */
export function DispatcherDashboard({
  snapshot,
  query,
  routeBoard,
  activeKillSwitches,
}: {
  snapshot: OpsFleetSnapshot;
  query: string;
  routeBoard: RouteOperationsBoardSnapshot;
  activeKillSwitches: KillSwitchRecord[];
}) {
  const filtered = filterFleet(snapshot.buses, query);
  const rows = query ? filtered : filtered.slice(0, DEFAULT_ROW_LIMIT);
  const standby = deriveStandbyAvailability(snapshot.buses);

  return (
    <div className="space-y-8">
      <DataSourceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />
      <KillSwitchBanner activeKillSwitches={activeKillSwitches} routeDirectionId={routeBoard.selectedRouteDirectionId} />

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Live fleet status
        </h2>
        <FleetSearchForm query={query} resultCount={rows.length} totalCount={snapshot.buses.length} />
        <FleetStatusTable
          buses={rows}
          totalCount={snapshot.buses.length}
          emptyLabel={emptyFleetLabel(snapshot.source, 'No vehicles match.')}
        />
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Route operations board
        </h2>
        <RouteOperationsBoard snapshot={routeBoard} standby={standby} />
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Approval queue
        </h2>
        <ApprovalQueuePanel canDecide={false} />
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Breakdown reports
        </h2>
        <BreakdownReportsPanel scope="fleet" />
      </section>

      <section>
        <DispatcherActionForm />
      </section>
    </div>
  );
}
