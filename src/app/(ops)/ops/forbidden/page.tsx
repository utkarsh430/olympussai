import type { Metadata } from 'next';
import Link from 'next/link';
import { getOpsSession } from '@/lib/auth/rbac/server';
import { opsHomePath } from '@/lib/auth/landing';

export const metadata: Metadata = {
  title: 'Access Denied',
  robots: { index: false, follow: false },
};

/**
 * Shown when middleware/a role layout redirects an AUTHENTICATED ops user
 * away from a role surface that is not theirs. Never redirects to /ops/login
 * — the person is signed in, just not permitted here, and this page must not
 * imply otherwise (see the comment in src/middleware.ts's handleOpsRequest).
 */
export default async function OpsForbiddenPage() {
  const session = await getOpsSession();
  // "Back to your dashboard" pointed an admin at /ops/admin, a 404: refused
  // at one screen, 404 at the next, with no way back into the product.
  const home = session ? opsHomePath(session.role) : '/login';

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-ops-ink">Access denied</h1>
      <p className="max-w-md text-sm text-ops-muted">
        {session
          ? `Your account (${session.role.replace('_', ' ')}) does not have access to that screen.`
          : 'You do not have access to that screen.'}
      </p>
      <Link
        href={home}
        className="ops-button-primary mt-2 px-5 py-2.5 text-[13px] tracking-[0.2em]"
      >
        {session ? 'Back to your dashboard' : 'Sign in'}
      </Link>
    </main>
  );
}
