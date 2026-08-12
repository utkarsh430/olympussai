import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getOpsSession } from '@/lib/auth/rbac/server';
import { sanitizeOpsNext } from '@/lib/auth/rbac/redirect';
import { OPS_LEGACY_LOGIN_PARAM, opsHomePath } from '@/lib/auth/landing';
import { OpsLoginForm } from '@/components/auth/OpsLoginForm';

export const metadata: Metadata = {
  title: 'Ops Sign In',
  robots: { index: false, follow: false },
};

/**
 * Forwards to `/login`, the single front door.
 *
 * NOT DELETED, DELIBERATELY. Three separate things still point here and are
 * out of this change's scope to move: `src/middleware.ts` builds this URL
 * when it bounces an unauthenticated operator off an ops route,
 * `pageGuard.ts` redirects here on every refusal, and any operator who
 * bookmarked it. Deleting the page would turn all three into a 404 — a
 * lockout — where forwarding turns them into a working sign-in. The page
 * disappears at the cutover, once those callers point at `/login` directly
 * and the new door is proven.
 *
 * The forward is unconditional except for the `?legacy=1` escape hatch (see
 * OPS_LEGACY_LOGIN_PARAM). It deliberately does NOT check for an existing
 * session first: reading one costs a database round-trip on a page whose only
 * job is to forward, and, worse, an ops-database outage would throw here and
 * 500 the sign-in route for everyone rather than letting them through to a
 * front door that does not need it.
 */
export default async function OpsLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; legacy?: string }>;
}) {
  const params = await searchParams;
  // `sanitizeOpsNext` returns null for /ops/login itself, so a self-referential
  // ?next cannot be forwarded into a cycle.
  const next = sanitizeOpsNext(params.next);

  if (params[OPS_LEGACY_LOGIN_PARAM] !== '1') {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  }

  // ── Legacy escape hatch below. ──────────────────────────────────────────
  // Never throws: this is the door people reach for when something else is
  // already broken, so an unreachable ops database must still leave a usable
  // form rather than a 500.
  let session = null;
  try {
    session = await getOpsSession();
  } catch {
    session = null;
  }
  if (session) {
    redirect(next ?? opsHomePath(session.role));
  }

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#6f7684]">
          Olympuss AI
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-[#e6e9ef]">Operations sign in</h1>
        <p className="mt-1 text-sm text-[#9aa0ad]">
          Fallback sign-in, for use when the main sign-in is unavailable.{' '}
          <a href="/login" className="text-[#8fb4ff] underline underline-offset-2">
            Use the main sign-in
          </a>
          .
        </p>
      </div>
      <OpsLoginForm next={next} />
    </main>
  );
}
