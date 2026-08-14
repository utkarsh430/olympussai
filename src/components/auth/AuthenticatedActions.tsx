'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Shown on /login when the visitor already holds a valid Supabase session
 * (Section 15). Offers continuing on, or signing out. Exposes only the
 * signed-in email — never any internal session/token details.
 *
 * `label` overrides the button text because the destination is no longer
 * always the project: /login is the ops console's front door too, and calling
 * an operator's own dashboard "the UPSRTC Project" would be a plain lie about
 * where the button goes. The caller picks the wording because only it knows
 * the role; the default is unchanged for the project case.
 *
 * A NULL `next` MEANS THERE IS NOWHERE TO GO, and the button disappears
 * rather than degrading to a default destination. Both surfaces of this app
 * are now gated on an active `ops_users` profile, so an account without one
 * has no valid target at all — and a "Continue" that lands on a page which
 * immediately bounces back here is the exact loop /login exists to break.
 * Sign-out remains, because it is the action that actually helps: it is how
 * the right person signs in on a shared machine.
 */
export function AuthenticatedActions({
  next,
  email,
  label,
}: {
  next: string | null;
  email?: string | null;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Navigation is the LAST step, and only once the server has confirmed both
   * credentials are gone. Showing a signed-out page over a session that is
   * still live is the defect this button is fixing, not a style it may
   * repeat — and "ignore the error and reload anyway" is exactly how it was
   * written before.
   */
  async function handleSignOut() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        setBusy(false);
        setFailed(true);
        return;
      }
    } catch {
      // The request never reached the server, so nothing was cleared.
      setBusy(false);
      setFailed(true);
      return;
    }
    window.location.assign('/login');
  }

  return (
    <div className="w-full space-y-4">
      {email && (
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{email}</span>
        </p>
      )}
      {next && (
        <Button asChild variant="brand" size="xl" className="w-full">
          <a href={next}>{label ?? 'Continue to UPSRTC Project'}</a>
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="xl"
        onClick={handleSignOut}
        disabled={busy}
        className="w-full"
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            Sign-out did not go through — you are still signed in. Try again, or close this browser.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
