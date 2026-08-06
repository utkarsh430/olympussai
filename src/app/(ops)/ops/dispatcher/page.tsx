import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';

export default async function DispatcherPage() {
  // requireOpsRolePage() in the layout above guarantees a non-null,
  // correct-role session by the time this renders.
  const session = (await getOpsSession())!;

  return (
    <OpsShell title="Dispatcher" email={session.email}>
      <p className="text-sm text-[#9aa0ad]">
        Dispatcher approvals/overrides are recorded via POST /api/ops/dispatcher/approvals,
        attributed to this account in ops_audit_log. Full dashboard UI is a separate frontend
        ticket.
      </p>
    </OpsShell>
  );
}
