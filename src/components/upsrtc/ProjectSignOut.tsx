'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { isAuthDisabled } from '@/lib/auth/publicPreview';

/**
 * Restrained Olympuss project context + Sign Out, mounted into the dashboard's
 * top command bar (Section 16). Deliberately compact and gold-toned so it reads
 * as "you are inside an Olympuss project environment" without overwhelming the
 * command centre's cyan HUD identity.
 *
 * Sign Out calls the server logout endpoint (clears the HttpOnly cookie) then
 * hard-navigates to /login, so the now-unauthenticated client cannot keep
 * rendering protected state.
 *
 * The button — and only the button — is dropped in public preview: there is
 * no session to end and /login forwards straight back in, so it would be an
 * inert control. The Olympuss context mark beside it is not about the
 * session and stays. Same reasoning as OpsSignOut.tsx.
 */
export function ProjectSignOut() {
  const [busy, setBusy] = useState(false);
  const signOutAvailable = !isAuthDisabled();

  async function handleSignOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the request fails, fall through to the login page; the
      // protected route + APIs re-verify server-side regardless.
    }
    window.location.assign('/login');
  }

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-2">
        {/* Minimal ascending-peak emblem, gold — evokes the Olympuss mark
            without depending on a raster asset inside the HUD. */}
        <span
          aria-hidden
          className="relative flex h-8 w-8 items-center justify-center"
        >
          <span className="absolute inset-0 rounded-full border border-brand/45" />
          <svg viewBox="0 0 24 24" className="relative h-3.5 w-3.5" fill="none">
            <path
              d="M4 18 L12 6 L20 18"
              stroke="hsl(var(--brand))"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="leading-tight">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-brand">
            Olympuss AI
          </div>
          <div className="whitespace-nowrap font-mono text-[8px] uppercase tracking-[0.16em] text-brand/55">
            Project Environment
          </div>
        </div>
      </div>

      {signOutAvailable ? (
        <button
          type="button"
          onClick={handleSignOut}
          disabled={busy}
          data-testid="project-sign-out"
          className="inline-flex items-center gap-1.5 rounded border border-brand/40 bg-brand/[0.06] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-brand transition-colors hover:border-brand/80 hover:bg-brand/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          {busy ? 'Signing out…' : 'Sign Out'}
        </button>
      ) : null}
    </div>
  );
}
