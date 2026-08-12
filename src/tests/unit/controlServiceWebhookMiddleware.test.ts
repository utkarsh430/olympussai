// @vitest-environment node
//
// Middleware exemption for /api/control-service/*.
//
// This is the single highest-consequence line of the whole feature, and its
// failure mode is invisible from both ends. If a session gate ever applied to
// the webhook path, the unauthenticated POST would be answered with a 307 to a
// login page; control-service dispatches with `fetch`, which FOLLOWS
// redirects, so the sender would receive HTTP 200 with an HTML body, treat it
// as `res.ok`, and mark the event DELIVERED (control-service/src/webhooks/
// dispatch.ts). Every command lifecycle event would be discarded while every
// dashboard reported success.
//
// Two independent things are therefore asserted: that `config.matcher` does
// not select the path (so middleware never even runs in production), and that
// the `middleware` function short-circuits it anyway (so widening the matcher
// later cannot silently break inbound webhooks).
import { NextRequest, NextResponse } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMiddlewareSupabaseClient = vi.fn();
const getMiddlewareUser = vi.fn();
const verifyOpsSessionToken = vi.fn();

vi.mock('@/lib/supabase/middleware', () => ({
  createMiddlewareSupabaseClient: (...args: unknown[]) => createMiddlewareSupabaseClient(...args),
  getMiddlewareUser: (...args: unknown[]) => getMiddlewareUser(...args),
}));

vi.mock('@/lib/auth/rbac/session', () => ({
  verifyOpsSessionToken: (...args: unknown[]) => verifyOpsSessionToken(...args),
}));

const WEBHOOK_PATH = '/api/control-service/webhook';

function unauthenticatedPost(path: string): NextRequest {
  // No cookies, no Authorization header — exactly what control-service sends.
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-control-service-signature': 'deadbeef' },
    body: '{}',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // This used to throw, as a blunt "the Supabase gate must never run" tripwire.
  // It cannot any more: collapsing the two front doors means the OPS branch
  // legitimately builds a Supabase client too (it accepts a Supabase session
  // carrying app_metadata.ops_role as well as the legacy ops cookie), so a
  // throwing implementation would now fire on the ops paths this file also
  // exercises. The exemption is asserted directly and per-path instead —
  // `not.toHaveBeenCalled()` on EVERY machine-API case below, which is a
  // strictly stronger statement than "the mock did not blow up".
  createMiddlewareSupabaseClient.mockImplementation(() => ({
    supabase: null,
    supabaseResponse: NextResponse.next(),
  }));
  getMiddlewareUser.mockResolvedValue(null);
  verifyOpsSessionToken.mockResolvedValue(null);
});

describe('middleware — /api/control-service/* is exempt from every session gate', () => {
  it('lets an unauthenticated POST through to the route handler', async () => {
    const { middleware } = await import('@/middleware');
    const response = await middleware(unauthenticatedPost(WEBHOOK_PATH));

    // NextResponse.next() — the request continues to the handler.
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    // Emphatically NOT a redirect: a 3xx here is the silent-data-loss bug.
    expect(response.headers.get('location')).toBeNull();
    expect([301, 302, 303, 307, 308]).not.toContain(response.status);
    expect(createMiddlewareSupabaseClient).not.toHaveBeenCalled();
    expect(verifyOpsSessionToken).not.toHaveBeenCalled();
  });

  it('consults neither auth system for the webhook path', async () => {
    const { middleware } = await import('@/middleware');
    await middleware(unauthenticatedPost(WEBHOOK_PATH));

    expect(createMiddlewareSupabaseClient).not.toHaveBeenCalled();
    expect(getMiddlewareUser).not.toHaveBeenCalled();
    expect(verifyOpsSessionToken).not.toHaveBeenCalled();
  });

  it('exempts the whole /api/control-service/ prefix, not just the one route', async () => {
    const { middleware } = await import('@/middleware');
    for (const path of [WEBHOOK_PATH, '/api/control-service/webhook/', '/api/control-service/anything']) {
      const response = await middleware(unauthenticatedPost(path));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBe(200);
    }
    expect(createMiddlewareSupabaseClient).not.toHaveBeenCalled();
    expect(getMiddlewareUser).not.toHaveBeenCalled();
    expect(verifyOpsSessionToken).not.toHaveBeenCalled();
  });

  it('does not exempt look-alike paths that merely contain the prefix', async () => {
    // A prefix check, not a substring check: /api/ops/control-service/... is
    // still ops-gated.
    const { middleware } = await import('@/middleware');
    const response = await middleware(unauthenticatedPost('/api/ops/control-room/control-service'));

    expect(response.status).toBe(401);
    expect(verifyOpsSessionToken).toHaveBeenCalled();
  });

  it('keeps the still-protected surfaces gated', async () => {
    const { middleware } = await import('@/middleware');
    const response = await middleware(unauthenticatedPost('/api/ops/control-room/commands'));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('never selects the webhook path in config.matcher', async () => {
    const { config } = await import('@/middleware');

    for (const pattern of config.matcher) {
      // The literal prefix of each matcher entry, i.e. everything before the
      // first dynamic segment. This catches the realistic regression — someone
      // adding a broad '/api/:path*' — rather than only a literal mention of
      // the control-service path.
      const literalPrefix = pattern.split('/:')[0] ?? pattern;
      expect(
        WEBHOOK_PATH.startsWith(literalPrefix),
        `config.matcher entry ${pattern} would select ${WEBHOOK_PATH}`,
      ).toBe(false);
    }
  });
});
