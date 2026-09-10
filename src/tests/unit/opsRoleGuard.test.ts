// @vitest-environment node
//
// src/lib/auth/rbac/guard.ts is the AUTHORITATIVE half of ops RBAC —
// OPS_API_ROLE_OVERRIDES (roles.ts, pinned by rbac.test.ts) is only a coarse,
// edge-safe ceiling middleware applies before a request ever reaches here.
// Every route-level test in this repo mocks '@/lib/auth/rbac/guard' itself
// (see controlRoomAlerts.test.ts and friends), which proves each route calls
// requireOpsRole with the right allowlist but never exercises what
// requireOpsRole actually DOES with it. This file is that missing piece: the
// real guard.ts, with only its two dependencies (session resolution and the
// public-preview switch) mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveOpsSession = vi.fn();
const isAuthDisabled = vi.fn(() => false);

vi.mock('@/lib/auth/rbac/server', () => ({
  resolveOpsSession: (...args: unknown[]) => resolveOpsSession(...args),
}));

vi.mock('@/lib/auth/publicPreview', () => ({
  isAuthDisabled: () => isAuthDisabled(),
  previewClaimsFor: vi.fn(),
}));

const { requireOpsRole, requireOpsSession } = await import('@/lib/auth/rbac/guard');

const DISPATCHER = { sub: 'u-1', email: 'd@example.com', role: 'dispatcher', iat: 0, exp: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  isAuthDisabled.mockReturnValue(false);
});

describe('requireOpsRole is the authoritative decision, not a rubber stamp on the ceiling', () => {
  it('admits a session whose role is in the allowlist', async () => {
    resolveOpsSession.mockResolvedValue({ ok: true, claims: DISPATCHER });
    const result = await requireOpsRole(['dispatcher', 'control_room']);
    expect(result.ok).toBe(true);
  });

  // THE ONE THAT MATTERS. A role the middleware ceiling would have let
  // through (or a route with no override at all) must still be refused here
  // if the route's own allowlist does not include it — this is the "real,
  // narrow, authoritative allowlist" AGENTS.md describes.
  it('refuses a session whose role is authenticated but not in the allowlist, with 403 FORBIDDEN', async () => {
    resolveOpsSession.mockResolvedValue({ ok: true, claims: DISPATCHER });
    const result = await requireOpsRole(['control_room']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('never reaches the role check at all when there is no usable session — 401, not 403', async () => {
    resolveOpsSession.mockResolvedValue({ ok: false, reason: 'no_session' });
    const result = await requireOpsRole(['dispatcher']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(401);
  });

  it('surfaces a database outage as 503, never as an access decision either way', async () => {
    resolveOpsSession.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const result = await requireOpsRole(['dispatcher']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(503);
  });
});

describe('requireOpsSession', () => {
  it('accepts any authenticated role', async () => {
    resolveOpsSession.mockResolvedValue({ ok: true, claims: DISPATCHER });
    const result = await requireOpsSession();
    expect(result.ok).toBe(true);
  });

  it('maps role_claim_mismatch to a distinct, non-forbidden denial', async () => {
    resolveOpsSession.mockResolvedValue({ ok: false, reason: 'role_claim_mismatch' });
    const result = await requireOpsSession();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.response.status).toBe(401);
  });
});
