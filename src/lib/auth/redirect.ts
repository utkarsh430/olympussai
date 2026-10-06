/**
 * Safe internal redirect targets.
 *
 * Prevents open-redirects: a `next` parameter must resolve, as a browser would
 * resolve it, to a path under one of the allowlisted protected roots. Anything
 * else falls back to the project home.
 */

export const DEFAULT_NEXT = '/project/upsrtc';

/** Protected project surfaces a post-login redirect may target. */
export const PROTECTED_ROOTS: readonly string[] = [
  '/project/upsrtc',
  '/project/bunching',
  '/project/depots',
];

/** Throwaway origin used only to resolve and normalise a root-relative path. */
const RESOLVE_BASE = 'http://internal.invalid';

function isUnderProtectedRoot(pathname: string): boolean {
  return PROTECTED_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/** Longest redirect target accepted; a longer one is not a link anyone followed. */
export const MAX_NEXT_LENGTH = 2048;

/**
 * `next` arrives from a query string, so it may be absent, repeated (an array)
 * or anything else a caller passes: only a string of sane length is considered.
 */
export function sanitizeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > MAX_NEXT_LENGTH) {
    return DEFAULT_NEXT;
  }
  // Must be a root-relative path, not a protocol-relative or backslash trick.
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return DEFAULT_NEXT;
  }
  // Resolve the way a browser would, so dot segments, backslashes and stripped
  // control characters are judged on the path they actually produce.
  let resolved: URL;
  try {
    resolved = new URL(next, RESOLVE_BASE);
  } catch {
    return DEFAULT_NEXT;
  }
  if (resolved.origin !== RESOLVE_BASE) return DEFAULT_NEXT;
  if (!isUnderProtectedRoot(resolved.pathname)) return DEFAULT_NEXT;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
