import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
/**
 * ─── WHY IT IS NOT AN ERROR ALERT ────────────────────────────────────────
 *
 * `info`, not `destructive`, and `role="status"` rather than `role="alert"`.
 * The brief for this surface asked for "a clear, calm explanation rather than
 * a refusal that reads like a bug", and the tone is most of that work: a red
 * box with a warning triangle tells a genuine operator that something has
 * broken and that they should be worried. Nothing has broken. During a
 * cutover a real member of staff may simply not be linked yet, and the
 * correct feeling is "ah, one more step", not "the system is down".
 *
 * The wording follows the same rule. "This account has no operations access
 * configured" describes a database row; "your sign-in works — it has not been
 * linked to an operations role yet" describes what happened to the reader,
 * separates the half that worked from the half that has not, and points at
 * the person who can fix it.
 */
export function NoOpsAccessNotice({ requested }: { requested?: string | null }) {
  return (
    <Alert variant="info" role="status" className="w-full">
      <AlertTitle>Your sign-in worked. Your access is not set up yet.</AlertTitle>
      <AlertDescription className="mt-2 space-y-2 text-muted-foreground">
        <p>
          This account has not been linked to an operations role yet
          {requested ? (
            <>
              , so it cannot open <span className="font-mono text-foreground">{requested}</span>
            </>
          ) : null}
          . Nothing is wrong with your password.
        </p>
        <p>
          Ask your administrator to add your account. Both the operations console and the project
          workspace need a role before they will open.
        </p>
      </AlertDescription>
    </Alert>
  );
}
