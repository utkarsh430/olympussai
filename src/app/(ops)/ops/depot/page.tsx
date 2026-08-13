import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';
import { getRouteOperationsBoardSnapshot } from '@/lib/controlService/routeBoardData';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { resolveOpsFleetScope } from '@/lib/ops/depotAccess';
import { filterVehicleStatesToScope, type OpsFleetScope } from '@/lib/ops/depotScope';
import { DepotDashboard } from '@/components/ops/depot/DepotDashboard';
import { DepotNotAssignedNotice } from '@/components/ops/depot/DepotNotAssignedNotice';

export const dynamic = 'force-dynamic';

export default async function DepotPage({
  searchParams,
}: {
  searchParams: Promise<{ routeDirectionId?: string }>;
}) {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('depot', '/ops/depot');
  const { routeDirectionId } = await searchParams;

  return (
    <OpsShell title="Depot" email={session.email}>
      <DashboardBody userId={session.sub} routeDirectionId={routeDirectionId} />
    </OpsShell>
  );
}

/**
 * See src/app/(ops)/ops/dispatcher/page.tsx's DashboardBody for why this
 * boundary exists (and why the kill-switch read is best-effort).
 *
 * DEPOT SCOPING HAPPENS HERE, BEFORE ANY DATA IS FETCHED. The scope comes
 * from the operator's own ops_users row (resolveOpsFleetScope) and is passed
 * into the fleet read, so an operator with no depot assigned never causes a
 * statewide fetch at all — they get the refusal notice instead. This page
 * must never call getOpsFleetSnapshot with OPS_FLEET_SCOPE_ALL: the whole
 * point of the boundary is that no depot-role render can reach it.
 */
async function DashboardBody({ userId, routeDirectionId }: { userId: string; routeDirectionId?: string }) {
  let scope: OpsFleetScope;
  try {
    // The role is pinned to the literal 'depot' rather than passed through
    // from the session: requireOpsRolePage('depot') above has already
    // refused anything else, and hardcoding it means this page cannot ask
    // for a statewide scope even if the guard were later widened.
    const resolution = await resolveOpsFleetScope({ sub: userId, role: 'depot' });
    if (!resolution.ok) {
      return <DepotNotAssignedNotice reason={resolution.reason} />;
    }
    scope = resolution.scope;
  } catch (error) {
    // The ops datastore could not be read, so this render cannot establish
    // which depot the operator owns. That is a refusal, never a fallback to
    // the statewide fleet.
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Your depot assignment could not be read right now ({message}), so no vehicles can be shown. Try refreshing the page.
      </p>
    );
  }

  try {
    const [snapshot, routeBoard, activeKillSwitches] = await Promise.all([
      getOpsFleetSnapshot(scope),
      getRouteOperationsBoardSnapshot(routeDirectionId),
      getOpsRepo()
        .listKillSwitches(true)
        .catch(() => []),
    ]);
    // The control-service board reports every vehicle on the selected
    // route-direction, from every depot. Narrowed here, server-side, against
    // the already-scoped live fleet — see filterVehicleStatesToScope for why
    // that intersection is the only depot signal available without joining
    // the two datastores.
    //
    // The route-direction LIST itself is left statewide on purpose, and that
    // is a deliberate, reviewable choice rather than an oversight: a
    // route-direction is shared reference data (a corridor is not owned by a
    // depot, and buses from many depots run the same road), control-service
    // records no depot on it, and the board only loads vehicle states for the
    // one selected route-direction — so deciding which corridors a depot
    // "touches" would mean fanning out a fetch per route-direction on every
    // render, or adding a depot dimension to control-service. Vehicles, which
    // are what the boundary is about, are scoped.
    const scopedRouteBoard = {
      ...routeBoard,
      vehicles: filterVehicleStatesToScope(routeBoard.vehicles, scope, snapshot.buses),
    };

    return (
      <DepotDashboard
        snapshot={snapshot}
        routeBoard={scopedRouteBoard}
        activeKillSwitches={activeKillSwitches}
        scope={scope}
      />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Depot data is unavailable right now ({message}). Try refreshing the page.
      </p>
    );
  }
}
