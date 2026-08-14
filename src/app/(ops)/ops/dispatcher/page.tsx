import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert } from '@/components/ops/ui';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';
import { OPS_FLEET_SCOPE_ALL } from '@/lib/ops/depotScope';
import { getRouteOperationsBoardSnapshot } from '@/lib/controlService/routeBoardData';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { DispatcherDashboard } from '@/components/ops/dispatcher/DispatcherDashboard';

export const dynamic = 'force-dynamic';

export default async function DispatcherPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; routeDirectionId?: string }>;
}) {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('dispatcher', '/ops/dispatcher');
  const { q, routeDirectionId } = await searchParams;

  return (
    <OpsShell title="Dispatcher" email={session.email} role="dispatcher" variant="wide">
      <DashboardBody query={q ?? ''} routeDirectionId={routeDirectionId} />
    </OpsShell>
  );
}

/**
 * Isolated so a data-source failure never takes down the guard/nav chrome
 * around it (this ticket's AC4) — getOpsFleetSnapshot/
 * getRouteOperationsBoardSnapshot themselves never throw, but this extra
 * boundary is defensive against any future regression in that guarantee.
 * The kill-switch banner read is best-effort (defaults to "none active" on
 * a repo error) — it is purely informational; the authoritative halt is
 * enforced server-side at command-creation time regardless of whether this
 * banner could be fetched.
 */
async function DashboardBody({ query, routeDirectionId }: { query: string; routeDirectionId?: string }) {
  try {
    const [snapshot, routeBoard, activeKillSwitches] = await Promise.all([
      getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL),
      getRouteOperationsBoardSnapshot(routeDirectionId),
      getOpsRepo()
        .listKillSwitches(true)
        .catch(() => []),
    ]);
    return (
      <DispatcherDashboard snapshot={snapshot} query={query} routeBoard={routeBoard} activeKillSwitches={activeKillSwitches} />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <OpsAlert tone="error">
        Dispatcher data is unavailable right now ({message}). Try refreshing the page.
      </OpsAlert>
    );
  }
}
