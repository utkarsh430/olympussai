'use client';

import { useState } from 'react';

/**
 * Shown on /login when the visitor already holds a valid Supabase session
 * (Section 15). Offers continuing into the project or signing out. Exposes
 * only the signed-in email — never any internal session/token details.
 */
export function AuthenticatedActions({ next, email }: { next: string; email?: string | null }) {
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
      <a
        href={next}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-[#d6a13a]/60 bg-[#d6a13a]/12 px-6 py-3.5 font-mono text-[13px] uppercase tracking-[0.2em] text-[#f3c86a] transition-all hover:bg-[#d6a13a]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a]"
        style={{ boxShadow: '0 0 30px -12px rgba(214,161,58,0.6)' }}
      >
        Continue to UPSRTC Project
      </a>
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
