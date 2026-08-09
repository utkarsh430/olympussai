'use client';

import { useId, useState } from 'react';
import { isOpsRole, OPS_ROLE_SEGMENT } from '@/lib/auth/rbac/roles';

/**
 * Ops RBAC login form — email + password against a per-person account.
 * Mirrors src/components/auth/LoginForm.tsx's UX conventions (explicit
 * labels, generic error, aria-live status) but authenticates against
 * /api/ops/auth/login instead of the Supabase-backed /api/auth/login.
 *
 * `next` is a pre-sanitized deep-link target (sanitizeOpsNext) or null. When
 * null, the destination is derived from the role the login response reports,
 * since roles differ in where their home page lives.
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
        const target = next ?? (isOpsRole(role) ? `/ops/${OPS_ROLE_SEGMENT[role]}` : '/ops/login');
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
