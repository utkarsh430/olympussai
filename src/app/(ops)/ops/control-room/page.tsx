import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';

export default async function ControlRoomPage() {
  // requireOpsRolePage() in the layout above guarantees a non-null,
  // correct-role session by the time this renders.
  const session = (await getOpsSession())!;

  return (
    <OpsShell title="Control Room" email={session.email}>
      <p className="text-sm text-[#9aa0ad]">
        Control-room commands are recorded via POST /api/ops/control-room/commands, requiring an
        unconsumed dispatcherActionId and attributed to this account. Full dashboard UI is a
        separate frontend ticket.
      </p>
    </OpsShell>
  );
}
