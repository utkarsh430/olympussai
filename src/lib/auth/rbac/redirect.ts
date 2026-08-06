/**
 * Safe internal redirect targets for the ops surface.
 *
 * Same open-redirect defence as src/lib/auth/redirect.ts (root-relative only,
 * no protocol-relative/backslash tricks), scoped to /ops/* instead of
 * /project/upsrtc. Returns null (rather than a hardcoded default) when there
 * is no safe explicit target, so the caller can fall back to a role-specific
 * home once it knows the signed-in user's role.
 */
export function sanitizeOpsNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/ops/') || next.startsWith('//') || next.startsWith('/\\')) {
    return null;
  }
  if (next.startsWith('/ops/login') || next.startsWith('/ops/accept-invite')) {
    return null;
  }
  return next;
}
