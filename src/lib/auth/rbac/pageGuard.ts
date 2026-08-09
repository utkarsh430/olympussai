/**
 * Server-side role gate for ops pages (Server Components).
 *
 * Second independent check, same pattern as the Supabase-Auth-gated
 * (protected)/project/upsrtc/layout.tsx: middleware is the first line, this
 * re-verifies and redirect()s without trusting middleware. Used by every
 * per-role layout under src/app/(ops)/ops/<role>/layout.tsx.
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { getOpsSession } from './server';
import type { OpsRole } from './roles';
import type { OpsSessionClaims } from './session';

export async function requireOpsRolePage(
  role: OpsRole,
  nextPath: string,
): Promise<OpsSessionClaims> {
  const session = await getOpsSession();
  if (!session) {
    redirect(`/ops/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (session.role !== role) {
    redirect('/ops/forbidden');
  }
  return session;
}
