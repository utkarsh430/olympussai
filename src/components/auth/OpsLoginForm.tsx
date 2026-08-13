'use client';

import { useId, useState } from 'react';
import { isOpsRole } from '@/lib/auth/rbac/roles';
import { opsHomePath, opsPathIsReachableBy } from '@/lib/auth/landing';

/**
 * Ops RBAC login form — email + password against a per-person account.
 * Mirrors src/components/auth/LoginForm.tsx's UX conventions (explicit
 * labels, generic error, aria-live status) but authenticates against
 * /api/ops/auth/login instead of the Supabase-backed /api/auth/login.
 *
 * `next` is a pre-sanitized deep-link target (sanitizeOpsNext) or null. When
 * null, the destination is derived from the role the login response reports,
 * since roles differ in where their home page lives.
 *
 * A SANITIZED `next` IS NOT A REACHABLE ONE, and conflating the two turned a
 * SUCCESSFUL sign-in into "Access Denied". Sanitizing proves a target is
 * internal and not a login loop; it says nothing about whether the account
 * that just authenticated may open it. A `next` outlives the navigation that
 * set it — middleware writes one whenever it bounces an operator off an ops
 * route, and it survives in the address bar and in bookmarks — so an admin
 * arriving at this form with a stale `?next=/ops/control-room` typed the
 * right password and was shown a refusal, indistinguishable from having typed
 * the wrong one. The main door (src/lib/auth/landing.ts's `resolveLanding`,
 * used by POST /api/auth/login) already narrows to the role's own dashboard
 * in that case; `opsPathIsReachableBy` is the same rule, from the same owner,
 * applied here.
 *
 * This form is scheduled to disappear with `/ops/login` at the cutover. It is
 * fixed rather than left to rot because the legacy door is still LIVE, so the
 * defect is reachable by real operators today.
 */
export function OpsLoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const errorId = useId();
  const statusId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);

    try {
      const response = await fetch('/api/ops/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = (await response.json().catch(() => null)) as { role?: string } | null;
        const role = data?.role;
        // Without a usable role there is nowhere role-correct to go, and
        // honouring `next` blind is what produced the refusal described
        // above — so the single front door absorbs it and explains.
        //
        // opsHomePath, not `/ops/${segment}`: the raw segment sends an admin
        // to /ops/admin, which is not a page.
        const target = !isOpsRole(role)
          ? '/login'
          : next !== null && opsPathIsReachableBy(next, role)
            ? next
            : opsHomePath(role);
        // Full navigation so the server re-renders the now-authorized route.
        window.location.assign(target);
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? 'Invalid email or password.');
      setStatus('error');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full max-w-sm space-y-5">
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
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@olympuss.us"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={status === 'error' || undefined}
          className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-4 py-3 text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4f8cff]/40"
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
          className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-4 py-3 text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4f8cff]/40"
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-[#f0857d]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-[#4f8cff]/12 flex w-full items-center justify-center gap-2 rounded-md border border-[#4f8cff]/60 px-6 py-3.5 font-mono text-[13px] uppercase tracking-[0.2em] text-[#8fb4ff] transition-all hover:bg-[#4f8cff]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4f8cff] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>

      <p id={statusId} aria-live="polite" className="sr-only">
        {submitting ? 'Signing in, please wait.' : status === 'error' ? 'Sign-in failed.' : ''}
      </p>
    </form>
  );
}
