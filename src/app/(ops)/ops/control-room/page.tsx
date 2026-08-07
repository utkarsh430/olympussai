import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { ControlRoomDashboard } from '@/components/ops/control-room/ControlRoomDashboard';

export const dynamic = 'force-dynamic';

export default async function ControlRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // requireOpsRolePage() in the layout above guarantees a non-null,
  // correct-role session by the time this renders.
  const session = (await getOpsSession())!;
  const { q } = await searchParams;

  return (
    <OpsShell title="Control Room" email={session.email}>
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
      getOpsFleetSnapshot(),
      getOpsRepo().listKillSwitches(true),
    ]);
    return <ControlRoomDashboard snapshot={snapshot} query={query} activeKillSwitches={activeKillSwitches} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Control-room data is unavailable right now ({message}). Try refreshing the page.
      </p>
    );
  }
}
