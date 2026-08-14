import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import { filterFleet } from '@/lib/ops/fleetView';
import { DataSourceNotice, emptyFleetLabel } from '@/components/ops/DataSourceNotice';
import { FleetSearchForm } from '@/components/ops/FleetSearchForm';
import { FleetStatusTable } from '@/components/ops/FleetStatusTable';
import { OpsSection } from '@/components/ops/ui';

const DEFAULT_ROW_LIMIT = 25;

/**
 * The statewide fleet roster, as the console's Fleet tab.
 *
 * This is what remained of the old ControlRoomDashboard once the map, the
 * engine, the approval queue and the kill switches moved into the console
 * around it: the searchable roster, which is still the fastest way to answer
 * "where is UP25FT4823" and the only view that lists a vehicle that has
 * stopped reporting a position at all — a bus the map cannot draw.
 *
 * It stays a SERVER component and is handed to the client console as a node.
 * The roster is thousands of rows filtered server-side by `?q=`; making it
 * client-side would mean shipping the statewide list into the page payload to
 * filter in the browser, which is both slower and a habit that has to stay
 * broken on the depot-scoped dashboards next door.
 *
 * The search form is a plain GET, so it re-requests this page. `tab` and
 * `routeDirectionId` ride along as hidden fields so a search does not throw
 * the operator back to the Decisions tab or reset the corridor.
 */
export function ControlRoomFleetPanel({
  snapshot,
  query,
  routeDirectionId,
}: {
  snapshot: OpsFleetSnapshot;
  query: string;
  routeDirectionId: string | null;
}) {
  const filtered = filterFleet(snapshot.buses, query);
  const rows = query ? filtered : filtered.slice(0, DEFAULT_ROW_LIMIT);

  return (
    <OpsSection title="Live fleet status">
      <DataSourceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />

      <FleetSearchForm query={query} resultCount={rows.length} totalCount={snapshot.buses.length}>
        <input type="hidden" name="tab" value="fleet" />
        {routeDirectionId !== null && (
          <input type="hidden" name="routeDirectionId" value={routeDirectionId} />
        )}
      </FleetSearchForm>

      <FleetStatusTable
        buses={rows}
        totalCount={snapshot.buses.length}
        emptyLabel={emptyFleetLabel(snapshot.source, 'No vehicles match.')}
      />
    </OpsSection>
  );
}
