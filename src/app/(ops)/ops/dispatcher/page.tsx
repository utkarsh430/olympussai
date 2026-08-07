import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';
import { getRouteOperationsBoardSnapshot } from '@/lib/controlService/routeBoardData';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { DispatcherDashboard } from '@/components/ops/dispatcher/DispatcherDashboard';

export const dynamic = 'force-dynamic';

export default async function DispatcherPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; routeDirectionId?: string }>;
}) {
  // requireOpsRolePage() in the layout above guarantees a non-null,
  // correct-role session by the time this renders.
  const session = (await getOpsSession())!;
  const { q, routeDirectionId } = await searchParams;

  return (
    <OpsShell title="Dispatcher" email={session.email}>
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
      getOpsFleetSnapshot(),
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
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Dispatcher data is unavailable right now ({message}). Try refreshing the page.
      </p>
    );
  }
}
