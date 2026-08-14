// @vitest-environment node
//
// Cancelling an outstanding invite.
//
// Revocation was enforced everywhere and settable nowhere: `acceptInvite`
// refuses a revoked invite and `ops_invites_pending_email_idx` excludes one,
// but no code path ever wrote `revoked_at`. That combination is worse than a
// plain missing feature — an invite sent to the wrong address or with the
// wrong role could not be cancelled, and because one live invite per email is
// a database constraint, the CORRECTED invite was refused too, for the seven
// days until the mistake expired. Resending cannot help: it rotates the token
// and leaves the role alone.
//
// So the tests below are about the states around the write as much as the
// write itself. Terminal states must refuse with the remedy that actually
// applies, and losing the race to an acceptance must never read as success.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireOpsRole = vi.fn();
const findInviteById = vi.fn();
const revokeInvite = vi.fn();
const recordAuditEvent = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));
vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ findInviteById, revokeInvite, recordAuditEvent }),
}));
vi.mock('@/lib/auth/origin', () => ({ isSameOrigin: () => true }));
vi.mock('@/lib/auth/rate-limit', () => ({ clientIpFrom: () => '203.0.113.9' }));

const { POST } = await import('@/app/api/ops/admin/invites/[id]/revoke/route');

const ADMIN_ID = '00000000-0000-0000-0000-0000000000ad';
const INVITE_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_CLAIMS = { sub: ADMIN_ID, email: 'admin@olympuss.local', role: 'admin' as const };

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITE_ID,
    email: 'wrong.address@olympuss.local',
    role: 'driver',
    expiresAt: new Date('2026-08-19T00:00:00Z').toISOString(),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-08-12T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function revokeRequest(id = INVITE_ID): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`https://olympuss.test/api/ops/admin/invites/${id}/revoke`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOpsRole.mockResolvedValue({ ok: true, claims: ADMIN_CLAIMS });
  recordAuditEvent.mockResolvedValue(undefined);
});

describe('revoking an outstanding invite', () => {
  it('stamps it revoked and records who did it', async () => {
    findInviteById.mockResolvedValue(invite());
    revokeInvite.mockResolvedValue(invite({ revokedAt: '2026-08-14T09:00:00.000Z' }));

    const response = await POST(...revokeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, inviteId: INVITE_ID });
    expect(revokeInvite).toHaveBeenCalledWith(INVITE_ID);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.invite.revoke',
        actorUserId: ADMIN_ID,
        resourceId: INVITE_ID,
      }),
    );
  });

  it('refuses an accepted invite by naming the remedy that actually applies', async () => {
    // The account exists by then. "Cancel the link" is not a thing that can
    // happen, and telling an admin to try again would send them in circles.
    findInviteById.mockResolvedValue(invite({ acceptedAt: '2026-08-13T00:00:00.000Z' }));

    const response = await POST(...revokeRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('INVITE_ALREADY_ACCEPTED');
    expect(body.error.message).toMatch(/disable the account/i);
    expect(revokeInvite).not.toHaveBeenCalled();
  });

  it('never reports success when an acceptance won the race', async () => {
    // The read said pending; the conditional UPDATE matched nothing because the
    // acceptance committed in between. Reporting 200 here would tell an admin a
    // live operator's access had been cancelled.
    findInviteById.mockResolvedValue(invite());
    revokeInvite.mockResolvedValue(null);

    const response = await POST(...revokeRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('INVITE_ALREADY_ACCEPTED');
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('is idempotent-safe: revoking twice refuses rather than re-stamping', async () => {
    findInviteById.mockResolvedValue(invite({ revokedAt: '2026-08-13T00:00:00.000Z' }));

    const response = await POST(...revokeRequest());

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('INVITE_ALREADY_REVOKED');
    expect(revokeInvite).not.toHaveBeenCalled();
  });

  it('answers 404 for an invite that does not exist', async () => {
    findInviteById.mockResolvedValue(null);

    const response = await POST(...revokeRequest());

    expect(response.status).toBe(404);
    expect(revokeInvite).not.toHaveBeenCalled();
  });

  it('is admin-only, and refuses before reading anything', async () => {
    requireOpsRole.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });

    const response = await POST(...revokeRequest());

    expect(response.status).toBe(403);
    expect(findInviteById).not.toHaveBeenCalled();
    expect(revokeInvite).not.toHaveBeenCalled();
  });
});
