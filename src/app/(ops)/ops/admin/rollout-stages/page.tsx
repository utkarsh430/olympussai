import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAdminRolloutStagesPanel } from '@/components/ops/admin/OpsAdminRolloutStagesPanel';

export default async function OpsAdminRolloutStagesPage() {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('admin', '/ops/admin/rollout-stages');

  return (
    <OpsShell
      title="Command permissions"
      email={session.email}
      role="admin"
      variant="wide"
      subtitle="Which corridors an instruction is allowed to reach a driver on"
    >
      <OpsAdminRolloutStagesPanel />
    </OpsShell>
  );
}
