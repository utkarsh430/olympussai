'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { OPS_LEGACY_LOGIN_PATH } from '@/lib/auth/landing';
import { DEFAULT_NEXT } from '@/lib/auth/redirect';

/**
 * Enterprise authentication form, backed by Supabase Auth (Section 15).
 *
 * Accounts are provisioned by an administrator only — there is no
 * self-service sign-up, so this form intentionally has no "create account"
 * affordance.
 *
 * - Explicit labels, password masked, standard autocomplete hints.
 * - Enter submits; button disabled while processing.
 * - Status announced via aria-live; error linked with aria-describedby.
 * - No credential hints, no prefilled values, generic error only.
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

      const data = (await response.json().catch(() => null)) as
        | { error?: string; redirectTo?: string }
        | null;

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
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full max-w-sm">
      <div className="space-y-5">
        <div>
          <label
            htmlFor="email"
            className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a7b2]"
          >
            Email
          </label>
          <input
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
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-4 py-3 text-[#f2eee7] placeholder:text-[#707580] transition-colors focus:border-[#d6a13a]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d6a13a]/40"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a7b2]"
          >
            Password
          </label>
          <input
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
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-4 py-3 text-[#f2eee7] placeholder:text-[#707580] transition-colors focus:border-[#d6a13a]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d6a13a]/40"
          />
        </div>

        {error && (
          <div id={errorId} role="alert" className="space-y-2">
            <p className="text-sm text-[#f0857d]">{error}</p>
            {authUnavailable && (
              <p className="text-[12px] leading-relaxed text-[#a3a7b2]">
                This sign-in is unavailable on this deployment — your credentials are not the
                problem. Operations staff can still use the{' '}
                <Link
                  href={OPS_LEGACY_LOGIN_PATH}
                  className="text-[#f3c86a] underline underline-offset-2 transition-colors hover:text-[#d6a13a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a]"
                >
                  operations sign-in
                </Link>
                .
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-md border border-[#d6a13a]/60 bg-[#d6a13a]/12 px-6 py-3.5 font-mono text-[13px] uppercase tracking-[0.2em] text-[#f3c86a] transition-all hover:bg-[#d6a13a]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a] disabled:cursor-not-allowed disabled:opacity-60"
          style={{ boxShadow: '0 0 30px -12px rgba(214,161,58,0.6)' }}
        >
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>

        {/* Screen-reader status region. */}
        <p id={statusId} aria-live="polite" className="sr-only">
          {submitting ? 'Signing in, please wait.' : status === 'error' ? 'Authentication failed.' : ''}
        </p>

        <p className="text-center text-[11px] leading-relaxed text-[#707580]">
          Accounts are provisioned by an administrator. There is no self-service sign-up.
        </p>
      </div>
    </form>
  );
}
