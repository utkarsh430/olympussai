import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';
import { PlannerDashboard } from '@/components/ops/planner/PlannerDashboard';

export const dynamic = 'force-dynamic';

export default async function PlannerPage() {
  // requireOpsRolePage() in the layout above guarantees a non-null,
  // correct-role session by the time this renders.
  const session = (await getOpsSession())!;

  return (
    <OpsShell title="Planner" email={session.email}>
      <DashboardBody />
    </OpsShell>
  );
}

/** See src/app/(ops)/ops/dispatcher/page.tsx's DashboardBody for why this boundary exists. */
async function DashboardBody() {
  try {
    const snapshot = await getOpsFleetSnapshot();
    return <PlannerDashboard snapshot={snapshot} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Planner data is unavailable right now ({message}). Try refreshing the page.
      </p>
    );
  }
}
