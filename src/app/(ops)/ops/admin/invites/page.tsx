import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAdminPeoplePanel } from '@/components/ops/admin/OpsAdminPeoplePanel';

/**
 * The people screen.
 *
 * The URL still says `invites` because that is where the screen started and a
 * live console's addresses are not worth churning; what it holds is the whole
 * people surface — roster, roles, depot and vehicle assignments, and the
 * invites that create new accounts.
 */
export default async function OpsAdminPeoplePage() {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('admin', '/ops/admin/invites');

  return (
    <OpsShell
      title="People"
      email={session.email}
      role="admin"
      variant="wide"
      subtitle="Who can sign in, what they are allowed to do, and which depot or bus they are set to"
    >
      <OpsAdminPeoplePanel />
    </OpsShell>
  );
}
