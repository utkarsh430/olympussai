import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert } from '@/components/ops/ui';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';
import { OPS_FLEET_SCOPE_ALL } from '@/lib/ops/depotScope';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { ControlRoomDashboard } from '@/components/ops/control-room/ControlRoomDashboard';

export const dynamic = 'force-dynamic';

export default async function ControlRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('control_room', '/ops/control-room');
  const { q } = await searchParams;

  return (
    <OpsShell title="Control Room" email={session.email} role="control_room" variant="wide">
      <DashboardBody query={q ?? ''} />
    </OpsShell>
  );
}

/**
 * See src/app/(ops)/ops/dispatcher/page.tsx's DashboardBody for why this
 * boundary exists. Unlike the dispatcher/depot read, control-room's own
 * kill-switch list is load-bearing for this page's own engage/disengage
 * panel (KillSwitchPanel needs a real starting list, not a silently-empty
 * one) — an OpsDbConfigError here correctly falls into the same
 * unavailable-page state as a fleet-snapshot failure, rather than being
 * swallowed.
 */
async function DashboardBody({ query }: { query: string }) {
  try {
    const [snapshot, activeKillSwitches] = await Promise.all([
      getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL),
      getOpsRepo().listKillSwitches(true),
    ]);
    return <ControlRoomDashboard snapshot={snapshot} query={query} activeKillSwitches={activeKillSwitches} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <OpsAlert tone="error">
        Control-room data is unavailable right now ({message}). Try refreshing the page.
      </OpsAlert>
    );
  }
}
