import Link from 'next/link';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAdminInvitesPanel } from '@/components/ops/OpsAdminInvitesPanel';

export default async function OpsAdminInvitesPage() {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('admin', '/ops/admin/invites');

  return (
    <OpsShell title="Admin · Invites" email={session.email}>
      <p className="mb-6 text-sm">
        <Link href="/ops/admin/rollout-stages" className="text-[#8fb4ff] hover:underline">
          Pilot rollout stages &rarr;
        </Link>
      </p>
      <OpsAdminInvitesPanel />
    </OpsShell>
  );
}
