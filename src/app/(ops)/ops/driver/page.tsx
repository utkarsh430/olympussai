import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { DriverDashboard } from '@/components/ops/driver/DriverDashboard';

export default async function DriverPage() {
  // requireOpsRolePage() in the layout above guarantees a non-null,
  // correct-role session by the time this renders.
  const session = (await getOpsSession())!;

  return (
    <OpsShell title="Driver" email={session.email}>
      <DriverDashboard />
    </OpsShell>
  );
}
