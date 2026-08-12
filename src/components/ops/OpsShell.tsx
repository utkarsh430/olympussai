'use client';

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
  async function handleLogout() {
    await fetch('/api/ops/auth/logout', { method: 'POST' });
    // The single front door. Note this only clears the LEGACY ops cookie —
    // a Supabase-authenticated operator stays signed in and /login will say
    // so. Completing sign-out across both is the session layer's job, not
    // this button's.
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
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-[rgba(255,255,255,0.14)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9aa0ad] hover:border-[#4f8cff]/60 hover:text-[#8fb4ff]"
          >
            Sign out
          </button>
        </div>
      </header>
      {children}
    </main>
  );
}
