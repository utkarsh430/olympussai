'use client';

import { useState } from 'react';

/**
 * Shared chrome for the per-role ops dashboards: title, signed-in identity,
 * logout. Intentionally minimal — the per-role dashboards themselves (real
 * driver/dispatcher/depot/control-room/planner screens) are frontend work
 * tracked separately; this ticket's scope is the auth/guard/audit layer.
 */
export function OpsShell({
  title,
  email,
  children,
}: {
  title: string;
  email: string;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Navigating to the login page is the LAST step, and it happens only once
   * the server has confirmed both sessions ended (POST /api/ops/auth/logout,
   * which now clears the legacy cookie and revokes the Supabase session).
   *
   * On failure this deliberately stays put and says so. The shared depot
   * tablet is the whole reason: an operator who taps sign out, sees the login
   * page and walks away has to be right about having signed out, so showing
   * the login screen over a session that is still live is worse than showing
   * an error.
   */
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

  return (
    <main className="mx-auto min-h-[100dvh] max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] pb-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#6f7684]">
            Olympuss AI · Ops
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[#e6e9ef]">{title}</h1>
        </div>
        <div className="flex items-center gap-4 text-right">
          <p className="text-sm text-[#9aa0ad]">{email}</p>
          <div className="flex flex-col items-end gap-1.5">
            <button
              type="button"
              onClick={handleLogout}
              disabled={busy}
              data-testid="ops-sign-out"
              className="rounded-md border border-[rgba(255,255,255,0.14)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9aa0ad] hover:border-[#4f8cff]/60 hover:text-[#8fb4ff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
            {failed ? (
              <p
                role="alert"
                className="max-w-[15rem] text-[11px] leading-snug text-[#ff8f8f]"
              >
                Sign-out failed — you are still signed in. Try again, or close this browser.
              </p>
            ) : null}
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}
