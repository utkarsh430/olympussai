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

export function OpsAccessPendingNotice({
  role,
  requested,
}: {
  role?: OpsRole | null;
  requested?: string | null;
}) {
  return (
    <div
      role="status"
      className="w-full max-w-sm space-y-3 rounded-md border border-[#d6a13a]/35 bg-[#d6a13a]/[0.06] p-5"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#f3c86a]">
        Operations access not active yet
      </p>
      <p className="text-sm leading-relaxed text-[#d8dae1]">
        Your account is set up for operations
        {role ? (
          <>
            {' '}
            as <span className="font-mono text-[12px] text-[#f2eee7]">{role.replace('_', ' ')}</span>
          </>
        ) : null}
        , but that has not been applied to your sign-in yet, so the operations console
        {requested ? (
          <>
            {' '}
            — including <span className="font-mono text-[12px] text-[#a3a7b2]">{requested}</span> —
          </>
        ) : null}{' '}
        will not open for you.
      </p>
      <p className="text-[12px] leading-relaxed text-[#a3a7b2]">
        Nothing is wrong with your account and there is nothing to retry. Ask an administrator to
        re-apply your operations role, then sign in again. In the meantime the operations sign-in
        fallback still works if you have an operations password.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/ops/login?legacy=1"
          className="inline-flex items-center rounded-md border border-[rgba(255,255,255,0.14)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a7b2] transition-colors hover:border-[rgba(255,255,255,0.3)] hover:text-[#f2eee7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a]"
        >
          Operations fallback sign-in
        </Link>
        <Link
          href={DEFAULT_NEXT}
          className="inline-flex items-center rounded-md border border-[rgba(255,255,255,0.14)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a7b2] transition-colors hover:border-[rgba(255,255,255,0.3)] hover:text-[#f2eee7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a]"
        >
          Continue to project
        </Link>
      </div>
    </div>
  );
}
