/**
 * Same-origin validation for state-changing auth requests (best-effort CSRF
 * defence, complementing the SameSite=lax cookie).
 *
 * Prefers the Origin header; falls back to Referer. Compares against the host
 * the request was actually served on (from the forwarded/host headers).
 */
import type { NextRequest } from 'next/server';

function requestHost(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    null
  );
}

export function isSameOrigin(request: NextRequest): boolean {
  const host = requestHost(request);
  if (!host) return false;

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  // Some clients omit Origin on same-origin POSTs; fall back to Referer.
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  // No Origin and no Referer — reject to be safe for a state change.
  return false;
}
