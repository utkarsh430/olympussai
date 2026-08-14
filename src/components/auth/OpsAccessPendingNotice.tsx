/**
 * "You ARE an operator; your sign-in cannot prove it yet."
 *
 * Shown on /login when the ops profile table gives this account an active
 * role but the access token carries no matching role claim, and the claim
 * could not be repaired during sign-in.
 *
 * THE WHOLE POINT IS THAT IT IS NOT NoOpsAccessNotice. That notice says the
 * account has no operations access configured, which for this person is
 * false, and it advises asking an administrator for a role they already
 * hold. Telling an on-shift dispatcher the wrong one of those two things
 * sends them chasing a problem that does not exist while the real one — a
 * claim that never got pushed — goes unreported. So the wording names the
 * actual state and the actual fix.
 *
 * NO LINK INTO /ops/*. Not the requested screen, not their dashboard, not a
 * retry. Every ops destination is gated at the edge on the claim this
 * account is missing, so any such link bounces the user straight back here.
 * That silent, clickable loop is the defect this page replaced; adding a
 * convenience button would rebuild it one click at a time.
 *
 * SAFE TO NAME THE ROLE. Unlike NoOpsAccessNotice — which withholds its
 * reason because /login is public and "that account is disabled" is an
 * enumeration oracle — this only ever renders for a session that has already
 * authenticated as this very account, and it states a fact that account's own
 * administrator gave it. Naming the role is what makes the report actionable
 * ("my account is control_room but sign-in cannot see it").
 */
import Link from 'next/link';
import { DEFAULT_NEXT } from '@/lib/auth/redirect';
import type { OpsRole } from '@/lib/auth/rbac/roles';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * ─── TONE, AND WHY IT IS `info` ──────────────────────────────────────────
 *
 * Same reasoning as NoOpsAccessNotice: this reader is a real operator, quite
 * possibly mid-shift, and the only thing that has gone wrong is a background
 * step nobody asked them to perform. A red alert would send them chasing an
 * account problem that does not exist. The two escapes below are real — both
 * genuinely open — so this state is a detour, not a wall, and it should read
 * as one.
 *
 * The role is still spelled out, because naming it is what makes the report
 * actionable ("my account is control room but sign-in cannot see it").
 * `.replace('_', ' ')` is unchanged and correct here: every ops role is at
 * most two words.
 */
export function OpsAccessPendingNotice({
  role,
  requested,
}: {
  role?: OpsRole | null;
  requested?: string | null;
}) {
  return (
    <Alert variant="info" role="status" className="w-full">
      <AlertTitle>Your operations access is not switched on yet</AlertTitle>
      <AlertDescription className="mt-2 space-y-3 text-muted-foreground">
        <p>
          Your account is set up for operations
          {role ? (
            <>
              {' '}
              as <span className="font-medium text-foreground">{role.replace('_', ' ')}</span>
            </>
          ) : null}
          , but that has not reached your sign-in yet, so the operations console
          {requested ? (
            <>
              {' '}
              — including <span className="font-mono text-foreground">{requested}</span> —
            </>
          ) : null}{' '}
          will not open for you.
        </p>
        <p>
          Nothing is wrong with your account, and there is nothing to retry. Ask your administrator
          to apply your operations role again, then sign in once more.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild variant="outline" size="sm">
            <Link href="/ops/login?legacy=1">Use the backup operations sign-in</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={DEFAULT_NEXT}>Go to the project workspace</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
