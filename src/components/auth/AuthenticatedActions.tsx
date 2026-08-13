'use client';

import { useState } from 'react';

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

  async function handleSignOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore — the server clears the session; fall through to a reload.
    }
    window.location.assign('/login');
  }

  return (
    <div className="w-full max-w-sm space-y-4">
      {email && (
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#a3a7b2]">
          Signed in as <span className="text-[#f2eee7]">{email}</span>
        </p>
      )}
      {next && (
        <a
          href={next}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-[#d6a13a]/60 bg-[#d6a13a]/12 px-6 py-3.5 font-mono text-[13px] uppercase tracking-[0.2em] text-[#f3c86a] transition-all hover:bg-[#d6a13a]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a]"
          style={{ boxShadow: '0 0 30px -12px rgba(214,161,58,0.6)' }}
        >
          {label ?? 'Continue to UPSRTC Project'}
        </a>
      )}
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="w-full rounded-md border border-[rgba(255,255,255,0.14)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.18em] text-[#a3a7b2] transition-colors hover:border-[rgba(255,255,255,0.3)] hover:text-[#f2eee7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a] disabled:opacity-60"
      >
        {busy ? 'Signing out…' : 'Sign Out'}
      </button>
    </div>
  );
}
