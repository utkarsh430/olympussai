/**
 * "You are signed in, but this account has no operations access."
 *
 * Shown on /login when a valid Supabase session asks for an `/ops/*` screen
 * with no active, linked `ops_users` row behind it. It exists because the
 * alternatives are all worse:
 *
 *   - Forwarding them to the ops screen anyway bounces them back here, and
 *     back again: a loop, which is indistinguishable from the product being
 *     broken and is the specific failure that locks people out.
 *   - Dropping them silently on /project/upsrtc answers a question they did
 *     not ask and hides the real state from the person best placed to report
 *     it.
 *   - An error page implies something went wrong. Nothing did — an ordinary
 *     project viewer has no ops profile by design, and during the cutover a
 *     genuine operator may simply not be linked yet.
 *
 * SO IT NAMES NO REASON. `resolveOpsSession` distinguishes unlinked from
 * disabled from stale-claim, and this page is deliberately given none of it:
 * /login is public and unauthenticated-reachable, and "that account is
 * disabled" is an account-enumeration oracle. The operator gets an accurate
 * instruction ("ask an administrator"); the administrator has the audit log.
 */
import Link from 'next/link';
import { DEFAULT_NEXT } from '@/lib/auth/redirect';

export function NoOpsAccessNotice({ requested }: { requested?: string | null }) {
  return (
    <div
      role="status"
      className="w-full max-w-sm space-y-3 rounded-md border border-[#d6a13a]/35 bg-[#d6a13a]/[0.06] p-5"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#f3c86a]">
        No operations access
      </p>
      <p className="text-sm leading-relaxed text-[#d8dae1]">
        You are signed in, but this account has no operations access configured
        {requested ? (
          <>
            , so it cannot open <span className="font-mono text-[12px] text-[#a3a7b2]">{requested}</span>
          </>
        ) : null}
        .
      </p>
      <p className="text-[12px] leading-relaxed text-[#a3a7b2]">
        If you are operations staff, ask an administrator to grant your account a role. Otherwise
        you can continue to the project workspace.
      </p>
      <Link
        href={DEFAULT_NEXT}
        className="inline-flex items-center rounded-md border border-[rgba(255,255,255,0.14)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a7b2] transition-colors hover:border-[rgba(255,255,255,0.3)] hover:text-[#f2eee7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a]"
      >
        Continue to project
      </Link>
    </div>
  );
}
