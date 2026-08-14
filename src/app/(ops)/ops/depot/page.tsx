import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert, OpsSection } from '@/components/ops/ui';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';
import { getOpsMapSnapshot } from '@/lib/ops/mapData';
import { getDepotConsoleSnapshot } from '@/lib/controlService/depotConsoleData';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { resolveOpsFleetScope } from '@/lib/ops/depotAccess';
import { scopeLabel, type OpsFleetScope } from '@/lib/ops/depotScope';
import { groupByRoute, deriveStandbyAvailability } from '@/lib/ops/fleetView';
import { emptyFleetLabel } from '@/components/ops/DataSourceNotice';
import { FleetRosterGroups } from '@/components/ops/FleetRosterGroups';
import { BreakdownReportsPanel } from '@/components/ops/BreakdownReportsPanel';
import { DepotConsole } from '@/components/ops/depot/DepotConsole';
import { DepotNotAssignedNotice } from '@/components/ops/depot/DepotNotAssignedNotice';
// From the plain tab module, NOT from DepotConsole. That component carries
// 'use client', and a value imported out of it here would be a
// client-reference proxy rather than a function — a hard 500 on every render
// that typecheck, lint, build and unit tests all pass. See depotTabs.ts, and
// scripts/lib/clientBoundary.ts for the check that fails the build on it.
import { isDepotTab, type DepotTabId } from '@/components/ops/depot/depotTabs';

export const dynamic = 'force-dynamic';

export default async function DepotPage({
  searchParams,
}: {
  searchParams: Promise<{ routeDirectionId?: string; tab?: string }>;
}) {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('depot', '/ops/depot');
  const { routeDirectionId, tab } = await searchParams;

  return (
    <DashboardBody
      email={session.email}
      userId={session.sub}
      routeDirectionId={routeDirectionId}
      // A `tab` that is not one of the console's own falls back rather than
      // rendering an empty rail, so a stale bookmark degrades to the default
      // view instead of a blank panel.
      tab={isDepotTab(tab) ? tab : 'running'}
    />
  );
}

/**
 * See src/app/(ops)/ops/dispatcher/page.tsx's DashboardBody for why this
 * boundary exists (and why the kill-switch read is best-effort).
 *
 * DEPOT SCOPING HAPPENS HERE, BEFORE ANY DATA IS FETCHED. The scope comes
 * from the operator's own ops_users row (resolveOpsFleetScope) and is passed
 * into every read below, so an operator with no depot assigned never causes a
 * statewide fetch at all — they get the refusal notice instead. This page must
 * never call getOpsFleetSnapshot with OPS_FLEET_SCOPE_ALL: the whole point of
 * the boundary is that no depot-role render can reach it.
 *
 * WHY THE CONSOLE READ IS SEQUENCED RATHER THAN PARALLEL. The map's incident
 * overlay is per-corridor, and WHICH corridor this depot opens on is itself
 * derived from the depot's own vehicles (getDepotConsoleSnapshot). So the
 * corridor has to be resolved before the map read can ask for the right one.
 * That costs no extra upstream call: getOpsFleetSnapshot is TTL-cached, so
 * getOpsMapSnapshot's internal call to it re-uses this render's own snapshot.
 */
async function DashboardBody({
  email,
  userId,
  routeDirectionId,
  tab,
}: {
  email: string;
  userId: string;
  routeDirectionId?: string;
  tab: DepotTabId;
}) {
  let scope: OpsFleetScope;
  try {
    // The role is pinned to the literal 'depot' rather than passed through
    // from the session: requireOpsRolePage('depot') above has already
    // refused anything else, and hardcoding it means this page cannot ask
    // for a statewide scope even if the guard were later widened.
    const resolution = await resolveOpsFleetScope({ sub: userId, role: 'depot' });
    if (!resolution.ok) {
      return (
        <OpsShell title="Depot" email={email} role="depot">
          <DepotNotAssignedNotice reason={resolution.reason} />
        </OpsShell>
      );
    }
    scope = resolution.scope;
  } catch (error) {
    // The ops datastore could not be read, so this render cannot establish
    // which depot the operator owns. That is a refusal, never a fallback to
    // the statewide fleet.
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <OpsShell title="Depot" email={email} role="depot">
        <OpsAlert tone="error">
          Your depot assignment could not be read right now ({message}), so no vehicles can be shown. Try refreshing the
          page.
        </OpsAlert>
      </OpsShell>
    );
  }

  const depotLabel = scopeLabel(scope);

  try {
    const [fleet, activeKillSwitches] = await Promise.all([
      getOpsFleetSnapshot(scope),
      getOpsRepo()
        .listKillSwitches(true)
        .catch(() => []),
    ]);

    // Corridors, running order and headway — all derived from THIS depot's
    // fleet. The unfiltered statewide vehicle-state list this reads lives and
    // dies inside that module; see its header.
    const consoleSnapshot = await getDepotConsoleSnapshot({
      scope,
      scopedFleet: fleet.buses,
      requestedRouteDirectionId: routeDirectionId,
    });

    // The map seed and its incident overlay, for the corridor just resolved.
    // Narrowed by the same scope, with mixed-depot incidents redacted to this
    // depot's own members.
    const map = await getOpsMapSnapshot(scope, {
      routeDirectionId: consoleSnapshot.selectedCorridor?.routeDirectionId,
    });

    return (
      <DepotConsole
        email={email}
        depotLabel={depotLabel}
        fleet={fleet}
        console={consoleSnapshot}
        mapVehicles={map.vehicles}
        incidents={map.incidents}
        standby={deriveStandbyAvailability(fleet.buses)}
        activeKillSwitches={activeKillSwitches}
        initialTab={tab}
        rosterPanel={
          <OpsSection
            title={`Vehicle roster · ${depotLabel}`}
            description="Every vehicle this depot has reporting, grouped by the route it is running. Grouping by depot would produce one group on this surface, which is the boundary working."
          >
            <FleetRosterGroups
              groups={groupByRoute(fleet.buses)}
              totalVehicles={fleet.buses.length}
              emptyLabel={emptyFleetLabel(
                fleet.source,
                `No vehicles from ${depotLabel} are currently reporting.`,
              )}
            />
          </OpsSection>
        }
        reportsPanel={
          <OpsSection
            title="Breakdown reports"
            description="Filed by drivers from the vehicle console."
          >
            <BreakdownReportsPanel scope="fleet" />
          </OpsSection>
        }
      />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <OpsShell title="Depot" email={email} role="depot">
        <OpsAlert tone="error">
          Depot data is unavailable right now ({message}). Try refreshing the page.
        </OpsAlert>
      </OpsShell>
    );
  }
}
