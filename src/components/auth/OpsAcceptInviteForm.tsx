'use client';

import { useId, useState } from 'react';
import { isOpsRole } from '@/lib/auth/rbac/roles';
import { opsHomePath } from '@/lib/auth/landing';

/** Mirrors src/lib/auth/rbac/passwords.ts MIN_PASSWORD_LENGTH (kept in sync manually — no server-only import in a client component). */
const MIN_PASSWORD_LENGTH = 12;

export function OpsAcceptInviteForm({ token }: { token: string }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const errorId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'submitting') return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      setStatus('error');
      return;
    }
    setStatus('submitting');
    setError(null);

    try {
      const response = await fetch('/api/ops/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });

      if (response.ok) {
        const data = (await response.json().catch(() => null)) as {
          role?: string;
          redirectTo?: string;
        } | null;
        const role = data?.role;
        // The SERVER picks the destination. It is the only side that knows
        // whether the session it just opened can actually get through the
        // edge gate — a claimless token has no business being pointed at an
        // /ops/* page, and this component cannot tell.
        //
        // The role fallback keeps an older cached bundle working against a
        // newer server and vice versa. opsHomePath, not `/ops/${segment}`:
        // the raw segment sends an admin to /ops/admin, a 404 — the very
        // first thing that used to happen to a new administrator.
        window.location.assign(
          data?.redirectTo ?? (isOpsRole(role) ? opsHomePath(role) : '/login'),
        );
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? 'This invite link is invalid or has expired.');
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
          htmlFor="name"
          className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a7b2]"
        >
          Full name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-describedby={error ? errorId : undefined}
          className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-4 py-3 text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4f8cff]/40"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a7b2]"
        >
          Choose a password ({MIN_PASSWORD_LENGTH}+ characters)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={error ? errorId : undefined}
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
        className="bg-[#4f8cff]/12 flex w-full items-center justify-center gap-2 rounded-md border border-[#4f8cff]/60 px-6 py-3.5 font-mono text-[13px] uppercase tracking-[0.2em] text-[#8fb4ff] transition-all hover:bg-[#4f8cff]/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
