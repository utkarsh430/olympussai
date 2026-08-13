/**
 * "You are signed in, but this account has no operations access."
 *
 * Shown on /login when a valid Supabase session has no active, linked
 * `ops_users` row behind it. It exists because the alternatives are all
 * worse:
 *
 *   - Forwarding them to the screen anyway bounces them back here, and back
 *     again: a loop, which is indistinguishable from the product being broken
 *     and is the specific failure that locks people out.
 *   - Dropping them silently on /project/upsrtc answers a question they did
 *     not ask and hides the real state from the person best placed to report
 *     it.
 *   - An error page implies something went wrong. Nothing did — during the
 *     cutover a genuine operator may simply not be linked yet.
 *
 * IT NO LONGER OFFERS A WAY ONWARD. It used to close with "Otherwise you can
 * continue to the project workspace" and a link to /project/upsrtc, from the
 * days when that surface admitted any signed-in account. It is now gated on
 * the same active ops profile as /ops/* (src/lib/auth/authorize.ts), so that
 * link became a button whose only function was to bounce the reader back to
 * this notice. Removed rather than repointed: there is no third place, and
 * inventing one would be the loop again under a different name.
 *
 * SO IT NAMES NO REASON. `resolveOpsSession` distinguishes unlinked from
 * disabled from stale-claim, and this page is deliberately given none of it:
 * /login is public and unauthenticated-reachable, and "that account is
 * disabled" is an account-enumeration oracle. The operator gets an accurate
 * instruction ("ask an administrator"); the administrator has the audit log.
 */
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
        Ask an administrator to grant your account a role. Both the operations console and the
        project workspace require one.
      </p>
    </div>
  );
}
