import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { CommandConsole } from '@/components/ops/pilot-driver/CommandConsole';
import { PwaRegister } from '@/components/ops/pilot-driver/PwaRegister';

export default async function PilotDriverPage() {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('pilot_driver', '/ops/pilot-driver');

  return (
    <OpsShell title="Pilot Driver" email={session.email} role="pilot_driver">
      <PwaRegister />
      <CommandConsole />
    </OpsShell>
  );
}
