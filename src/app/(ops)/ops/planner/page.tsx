import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';

export default async function PlannerPage() {
  // requireOpsRolePage() in the layout above guarantees a non-null,
  // correct-role session by the time this renders.
  const session = (await getOpsSession())!;

  return (
    <OpsShell title="Planner" email={session.email}>
      <p className="text-sm text-[#9aa0ad]">
        Planner-facing screens (route/schedule planning) are tracked as a separate frontend ticket;
        this is a guarded placeholder proving the role gate.
      </p>
    </OpsShell>
  );
}
