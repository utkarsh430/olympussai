import type { FleetGroup } from '@/lib/ops/fleetView';
import { FleetStatusTable } from './FleetStatusTable';

const GROUPS_SHOWN = 8;
const ROWS_PER_GROUP = 10;

/**
 * Schedule/roster view (this ticket's AC2, depot and planner dashboards):
 * the current live fleet grouped by depot or by route, each group showing
 * its assigned vehicles. Real backend data (the same live feed as the
 * fleet-status view), reframed as a roster rather than a flat table.
 */
export function FleetRosterGroups({
  groups,
  totalVehicles,
  emptyLabel = 'No vehicles currently reporting.',
}: {
  groups: FleetGroup[];
  totalVehicles: number;
  /**
   * Wording for the zero-groups case. Defaults to the quiet-night reading;
   * callers pass a different one when the roster is empty because the feed is
   * unavailable rather than because the road is (see emptyFleetLabel).
   */
  emptyLabel?: string;
}) {
  if (groups.length === 0) {
    return <p className="text-sm text-ops-muted">{emptyLabel}</p>;
  }

  const shown = groups.slice(0, GROUPS_SHOWN);

  return (
    <div className="space-y-6">
      <p className="text-xs text-ops-faint">
        {totalVehicles} vehicles across {groups.length} groups. Showing the {shown.length} largest.
      </p>
      {shown.map((group) => (
        <div key={group.key}>
          <h3 className="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-ops-muted">
            {group.label} <span className="text-ops-faint">({group.buses.length})</span>
          </h3>
          <FleetStatusTable buses={group.buses.slice(0, ROWS_PER_GROUP)} totalCount={group.buses.length} />
        </div>
      ))}
    </div>
  );
}
