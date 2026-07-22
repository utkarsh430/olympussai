/**
 * Safe internal redirect targets.
 *
 * Prevents open-redirects: a `next` parameter must be an absolute *internal*
 * path under the protected project area. Anything else falls back to the
 * project home.
 */

export const DEFAULT_NEXT = '/project/upsrtc';

export function sanitizeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT;
  // Must be a root-relative path, not a protocol-relative or backslash trick.
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return DEFAULT_NEXT;
  }
  // Only allow the protected project surface.
  if (next !== '/project/upsrtc' && !next.startsWith('/project/upsrtc/')) {
    return DEFAULT_NEXT;
  }
  return next;
}
