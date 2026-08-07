import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { CommandConsole } from '@/components/ops/pilot-driver/CommandConsole';
import { PwaRegister } from '@/components/ops/pilot-driver/PwaRegister';

export default async function PilotDriverPage() {
  // requireOpsRolePage() in the layout above guarantees a non-null,
  // pilot_driver-role session by the time this renders.
  const session = (await getOpsSession())!;

  return (
    <OpsShell title="Pilot Driver" email={session.email}>
      <PwaRegister />
      <CommandConsole />
    </OpsShell>
  );
}
