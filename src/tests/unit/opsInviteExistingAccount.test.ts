// @vitest-environment node
//
// Inviting an address that ALREADY has an ops_users row.
//
// ─── THE DEFECT THIS PINS ────────────────────────────────────────────────
//
// Nothing anywhere refused it. `ops_invites` has a partial unique index on
// `lower(email)` for LIVE invites only, and no constraint at all against
// `ops_users` — verified against a real Postgres with the ops migrations
// applied: the insert succeeds. So an admin re-inviting somebody who already
// has an account got a cheerful "Invite sent", the invitee got an email, and
// the failure surfaced one step later and to the wrong person — the ops_users
// insert inside `acceptInvite` hitting `ops_users_email_key`, which no branch
// of the accept route handled, so it fell through to `throw error` and became
// an HTTP 500 with a raw unique-constraint message.
//
// Both ends are fixed, and both are asserted here, because they are two
// different failures with two different audiences:
//
//   INVITE TIME   The admin is the person who can act on it, and they are
//                 standing right there. A clean 409 naming the existing
//                 account and its role is the whole fix — it also stops the
//                 doomed invite being created and emailed at all.
//   ACCEPT TIME   The pre-check is a read followed by a write, so it races:
//                 two admins, or an admin and an acceptance in flight, can
//                 still land a duplicate. The database is the only thing that
//                 settles it, and when it does, the invitee must get a
//                 sentence they can act on rather than a 500.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';

const requireOpsRole = vi.fn();
const findUserByEmail = vi.fn();
const createInvite = vi.fn();
const recordAuditEvent = vi.fn();
const sendEmail = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));
vi.mock('@/lib/auth/rbac/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/rbac/repo')>(
    '@/lib/auth/rbac/repo',
  );
  return {
    ...actual,
    getOpsRepo: () => ({ findUserByEmail, createInvite, recordAuditEvent }),
  };
});
vi.mock('@/lib/auth/origin', () => ({ isSameOrigin: () => true }));
vi.mock('@/lib/auth/rate-limit', () => ({
  clientIpFrom: () => '203.0.113.9',
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  recordFailure: async () => {},
}));
vi.mock('@/lib/email/resend', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

const { POST } = await import('@/app/api/ops/admin/invites/route');

const ADMIN_ID = '00000000-0000-0000-0000-0000000000ad';
const ADMIN_CLAIMS = { sub: ADMIN_ID, email: 'admin@olympuss.local', role: 'admin' as const };

function existing(overrides: Partial<OpsUserRecord> = {}): OpsUserRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'already.there@olympuss.local',
    name: 'Already There',
    role: 'dispatcher',
    passwordHash: 'supabase-managed:no-local-password',
    status: 'active',
    vehicleId: null,
    depotId: null,
    supabaseUserId: '99999999-9999-9999-9999-999999999999',
    createdAt: new Date('2026-08-12T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function inviteRequest(email: string, role = 'driver') {
  return new NextRequest('https://olympuss.test/api/ops/admin/invites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOpsRole.mockResolvedValue({ ok: true, claims: ADMIN_CLAIMS });
  findUserByEmail.mockResolvedValue(null);
  recordAuditEvent.mockResolvedValue(undefined);
  sendEmail.mockResolvedValue({ ok: true });
  createInvite.mockResolvedValue({
    id: '22222222-2222-2222-2222-222222222222',
    email: 'someone.new@olympuss.local',
    role: 'driver',
    expiresAt: new Date('2026-08-19T00:00:00Z').toISOString(),
    createdAt: new Date('2026-08-12T00:00:00Z').toISOString(),
  });
});

describe('inviting an address that already has an account', () => {
  it('refuses with a clean 409 naming the account, instead of creating a doomed invite', async () => {
    findUserByEmail.mockResolvedValue(existing());

    const response = await POST(inviteRequest('already.there@olympuss.local'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('USER_ALREADY_EXISTS');
    // The admin has to be able to act on this without going to the database:
    // which account, what role it currently holds, and what to do instead.
    expect(body.error.message).toMatch(/already has an operations account/i);
    expect(body.error.message).toMatch(/dispatcher/);
    expect(body.error.message).toMatch(/change their role|disable/i);
  });

  it('never creates or emails the invite it just refused', async () => {
    findUserByEmail.mockResolvedValue(existing());

    await POST(inviteRequest('already.there@olympuss.local'));

    expect(createInvite).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('says the account is disabled when it is, because the remedy is different', async () => {
    // Re-inviting is the intuitive way to bring a disabled operator back, and
    // it does not work — the row is still there. Saying only "already exists"
    // sends the admin looking for an account they cannot see in the roster's
    // default reading.
    findUserByEmail.mockResolvedValue(existing({ status: 'disabled' }));

    const response = await POST(inviteRequest('already.there@olympuss.local'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.message).toMatch(/disabled/i);
  });

  it('matches case-insensitively, the way the database does', async () => {
    // ops_users.email is compared with lower() everywhere it matters
    // (repo.findUserByEmail), so a check that only caught an exact-case match
    // would let the very insert it guards through.
    findUserByEmail.mockResolvedValue(existing());

    const response = await POST(inviteRequest('Already.There@Olympuss.local'));

    expect(response.status).toBe(409);
    expect(findUserByEmail).toHaveBeenCalledWith('Already.There@Olympuss.local');
  });

  it('still invites an address that has no account', async () => {
    findUserByEmail.mockResolvedValue(null);

    const response = await POST(inviteRequest('someone.new@olympuss.local'));

    expect(response.status).toBe(201);
    expect(createInvite).toHaveBeenCalledTimes(1);
  });

  it('refuses rather than guessing when the roster cannot be read', async () => {
    // A pre-check that cannot run is not a pre-check. Continuing would put us
    // back to creating an invite that may be doomed; the admin can retry.
    findUserByEmail.mockRejectedValue(new Error('connection terminated unexpectedly'));

    const response = await POST(inviteRequest('unknown@olympuss.local'));

    expect(response.status).toBe(503);
    expect(createInvite).not.toHaveBeenCalled();
  });
});
