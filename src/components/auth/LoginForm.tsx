'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { OPS_LEGACY_LOGIN_PATH } from '@/lib/auth/landing';
import { DEFAULT_NEXT } from '@/lib/auth/redirect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Enterprise authentication form, backed by Supabase Auth.
 *
 * Accounts are provisioned by an administrator only — there is no
 * self-service sign-up, so this form intentionally has no "create account"
 * affordance.
 *
 * - Explicit labels, password masked, standard autocomplete hints.
 * - Enter submits; button disabled while processing.
 * - Status announced via aria-live; error linked with aria-describedby.
 * - No credential hints, no prefilled values, generic error only.
 *
 * ─── THE RE-SKIN CHANGED NO LOGIC ────────────────────────────────────────
 *
 * Every branch below — the omitted `next`, the server-chosen destination,
 * the 503 fallback pointer — is unchanged. What changed is that the controls
 * are the shared Input and Button rather than eight hand-written literal
 * hexes, and the labels are readable sentence case rather than 11px letter-
 * spaced monospace caps. The old labels were styled as HUD chrome; this is a
 * form a depot clerk fills in on a phone.
 *
 * ─── AND THE CONTROLS ARE PHONE-SIZED ────────────────────────────────────
 *
 * `h-12` — 48px — rather than the shared Input's 36px default. That clears
 * the 44px touch minimum with room to spare, which matters here more than
 * anywhere else in the product: this is the one screen a driver opens
 * one-handed. The shared Input already sets `text-base` with a `md:text-sm`
 * step down, so the text stays at 16px on a phone; below 16px iOS Safari
 * zooms the viewport on focus and throws the layout sideways.
 */

/**
 * `next` is a sanitized deep-link target, or null when the visitor asked for
 * nowhere in particular. NULL IS NOT THE SAME AS THE DEFAULT PATH and must not
 * be collapsed into one: the server routes "asked for nothing" to the signed-in
 * role's own dashboard, and can only do that if this form omits the field
 * rather than filling it in with a guess.
 */
export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  // 503 means Supabase auth is not configured on this deployment — nothing the
  // operator types here can ever work, so say so rather than leaving them to
  // conclude their password is wrong.
  //
  // This used to point at /ops/login as a separate console with its own
  // credentials. It is no longer separate — it forwards straight back here —
  // so the pointer is now the explicit legacy escape hatch, which is exactly
  // the door that still works when Supabase is the thing that is down. Purely
  // client-side copy: the API keeps its generic message and never says which
  // variable is missing.
  const [authUnavailable, setAuthUnavailable] = useState(false);

  const errorId = useId();
  const statusId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);
    setAuthUnavailable(false);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Omitted entirely when there is no request to make, so the server
        // sees "no destination asked for" and picks the role's own dashboard.
        body: JSON.stringify({ email, password, ...(next === null ? {} : { next }) }),
      });

      const data = (await response.json().catch(() => null)) as {
        error?: string;
        redirectTo?: string;
      } | null;

      if (response.ok) {
        // The SERVER picks the destination, not this component: only it knows
        // the signed-in role, and therefore which of the seven ops dashboards
        // (or the project surface) this person belongs on. `next` is sent up
        // as a request, not applied here as a decision.
        //
        // Falling back to `next` if the field is missing keeps an older cached
        // bundle working against a newer server, and vice versa.
        // Full navigation so the server re-renders the now-authorized route.
        window.location.assign(data?.redirectTo ?? next ?? DEFAULT_NEXT);
        return;
      }

      setError(data?.error ?? 'Invalid email or password.');
      setAuthUnavailable(response.status === 503);
      setStatus('error');
    } catch {
      // Names the thing that failed and what to do about it. "Something went
      // wrong. Please try again." told the reader neither.
      setError('Could not reach the sign-in service. Check your connection and try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <div className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-foreground">
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={status === 'error' || undefined}
            className="h-12"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-foreground">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={status === 'error' || undefined}
            className="h-12"
          />
        </div>

        {error && (
          <Alert id={errorId} variant="destructive">
            <AlertDescription className="space-y-2">
              <p>{error}</p>
              {authUnavailable && (
                <p className="text-foreground">
                  Sign-in is not working on this installation. Your email and password are not the
                  problem. Operations staff can still use the{' '}
                  <Link
                    href={OPS_LEGACY_LOGIN_PATH}
                    className="font-medium text-brand underline underline-offset-2"
                  >
                    backup operations sign-in
                  </Link>
                  .
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Button type="submit" variant="brand" size="xl" disabled={submitting} className="w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>

        {/* Screen-reader status region. */}
        <p id={statusId} aria-live="polite" className="sr-only">
          {submitting ? 'Signing in, please wait.' : status === 'error' ? 'Sign-in failed.' : ''}
        </p>

        <p className="text-center text-[13px] leading-relaxed text-subtle">
          Accounts are created by your administrator. You cannot sign yourself up.
        </p>
      </div>
    </form>
  );
}
