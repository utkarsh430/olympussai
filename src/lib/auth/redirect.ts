/**
 * Safe internal redirect targets.
 *
 * Prevents open-redirects: a `next` parameter must be an absolute *internal*
 * path under one of the protected project surfaces. Anything else falls back
 * to the project home.
 */

export const DEFAULT_NEXT = '/project/upsrtc';

/**
 * Every protected surface a `next` parameter is allowed to point at. Both
 * `/project/upsrtc` (the dashboard) and `/project/bunching` (the simulator)
 * are listed explicitly — an earlier version of this allowlist covered only
 * the dashboard, so a deep link into the simulator silently fell back to the
 * dashboard after login instead of 404ing or open-redirecting.
 */
const ALLOWED_PREFIXES = ['/project/upsrtc', '/project/bunching'] as const;

export function sanitizeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT;
  // Must be a root-relative path, not a protocol-relative or backslash trick.
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return DEFAULT_NEXT;
  }
  // Only allow the protected project surfaces.
  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => next === prefix || next.startsWith(`${prefix}/`),
  );
  if (!allowed) return DEFAULT_NEXT;
  return next;
}
