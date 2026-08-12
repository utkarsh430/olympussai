/**
 * Safe internal redirect targets.
 *
 * Prevents open-redirects: a `next` parameter must be an absolute *internal*
 * path under one of the protected surfaces. Anything else falls back to the
 * project home.
 *
 * SCOPE WIDENED AT THE LOGIN COLLAPSE. `/login` is now the single front door
 * for the ops console as well as the project surface, so a `next` pointing
 * into `/ops/*` has to survive this function. It previously did not: every
 * ops deep link (including the one middleware itself builds when it bounces
 * an unauthenticated operator off `/ops/depot`) silently became
 * `/project/upsrtc`, which is not an error the user or a test would ever see
 * — they would just quietly land on the wrong product.
 *
 * The `/ops/*` rules are NOT restated here. `sanitizeOpsNext` already owns
 * them, including the two exclusions that matter for loop safety
 * (`/ops/login` and `/ops/accept-invite` are never valid post-login targets),
 * so this composes with it rather than keeping a second copy that can drift.
 */
import { sanitizeOpsNext } from './rbac/redirect';

export const DEFAULT_NEXT = '/project/upsrtc';

/**
 * Protected project surfaces a `next` may point at. Both `/project/upsrtc`
 * (the dashboard) and `/project/bunching` (the simulator) are listed
 * explicitly — an earlier version of this allowlist covered only the
 * dashboard, so a deep link into the simulator silently fell back to the
 * dashboard after login instead of 404ing or open-redirecting.
 */
const ALLOWED_PROJECT_PREFIXES = ['/project/upsrtc', '/project/bunching'] as const;

/**
 * The safe target this `next` names, or null if it names none.
 *
 * Callers that must tell "the user asked for somewhere specific" apart from
 * "the user asked for nothing" need the null — the landing decision in
 * src/lib/auth/landing.ts routes those two cases differently (an explicit
 * target is honoured; no target falls through to the signed-in user's own
 * role home). `sanitizeNext` below is the collapse-to-a-default wrapper for
 * everyone else.
 */
export function sanitizeNextOrNull(next: string | null | undefined): string | null {
  if (!next) return null;
  // Must be a root-relative path, not a protocol-relative or backslash trick.
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return null;
  }

  const isProjectPath = ALLOWED_PROJECT_PREFIXES.some(
    (prefix) => next === prefix || next.startsWith(`${prefix}/`),
  );
  if (isProjectPath) return next;

  return sanitizeOpsNext(next);
}

export function sanitizeNext(next: string | null | undefined): string {
  return sanitizeNextOrNull(next) ?? DEFAULT_NEXT;
}

/** True for a sanitized target that lives on the ops console. */
export function isOpsPath(path: string): boolean {
  return path.startsWith('/ops/');
}
