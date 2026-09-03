'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isAuthDisabled } from '@/lib/auth/publicPreview';

/**
 * The "Sign out" control, extracted from OpsShell unchanged.
 *
 * ─── DO NOT SIMPLIFY THIS ────────────────────────────────────────────────
 *
 * Every branch below is a defect that was actually shipped. The original
 * implementation fired POST /api/ops/auth/logout, ignored the response and
 * navigated away — and since that endpoint only cleared the legacy cookie, a
 * Supabase-authenticated operator (which is now every operator) saw a login
 * page over a session that was still live. Both halves were fixed: the
 * endpoint now ends both sessions (src/lib/auth/rbac/signOut.ts), and this
 * button now believes the endpoint rather than assuming it.
 *
 * So the contract this component owes, and which
 * src/tests/unit/opsShellSignOutButton.test.tsx pins:
 *
 *   1. Navigation happens LAST, and only after the server confirms both
 *      sessions ended.
 *   2. A non-OK response stays put and says so.
 *   3. A request that never reached the server is a FAILED sign-out, not a
 *      best-effort one.
 *   4. The operator can try again.
 *
 * The shared depot tablet is why this is worth the code: an operator who
 * taps sign out, sees a login page and hands the device over has to be right
 * about having signed out. A login screen over a live session is worse than
 * an error.
 *
 * This file's move out of OpsShell.tsx is presentation-only — the logic is
 * byte-for-byte the behaviour it had there.
 *
 * IT RENDERS NOTHING IN PUBLIC PREVIEW. With authentication switched off
 * there is no session to end, so every one of the four guarantees above is
 * vacuous: the endpoint would clear cookies nobody holds, and the /login it
 * navigates to forwards straight back into the console. A control that
 * appears to sign you out and demonstrably does not is exactly the lie this
 * component was rewritten to stop telling, so on a preview build it is
 * absent instead. `isAuthDisabled()` reads NEXT_PUBLIC_DISABLE_AUTH here —
 * see src/lib/auth/publicPreview.ts for why one function serves both halves.
 */
export function OpsSignOut({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const hidden = isAuthDisabled();

  async function handleLogout() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/ops/auth/logout', { method: 'POST' });
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
    // The single front door.
    window.location.assign('/login');
  }

  if (hidden) return null;

  return (
    <div className={cn('flex flex-col items-end gap-1.5', className)}>
      <button
        type="button"
        onClick={handleLogout}
        disabled={busy}
        data-testid="ops-sign-out"
        className="ops-button"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {failed ? (
        <p role="alert" className="max-w-[15rem] text-right text-[11px] leading-snug text-ops-danger">
          Sign-out failed — you are still signed in. Try again, or close this browser.
        </p>
      ) : null}
    </div>
  );
}
