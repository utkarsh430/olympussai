// @vitest-environment node
//
// Invite acceptance now provisions a Supabase Auth identity instead of
// storing a bcrypt hash.
//
// The whole risk of this change is in what it must NOT break. An invite is a
// one-time, emailed, hash-only credential with an expiry, a revocation, and a
// one-live-invite-per-email rule, and it is the only way an ops account has
// ever come into existence. Bolting an external HTTP call into the middle of
// that transaction introduces exactly two new ways to half-succeed, and
// neither is recoverable by the person clicking the link:
//
//   * a spent invite and no account to sign into, and
//   * an account with no ops profile behind it.
//
// So these tests assert, in order: that the identity is provisioned from the
// LOCKED INVITE ROW rather than from anything the client sent; that no
// password is written to the database at all; that every provisioning failure
// leaves the invite unconsumed and retryable; that a database failure after
// provisioning takes the identity back down; and that expiry, revocation and
// single-use still refuse exactly as before.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';

const acceptInvite = vi.fn();
const recordAuditEvent = vi.fn();
const provisionOpsIdentity = vi.fn();
const releaseOpsIdentity = vi.fn();
const establishOpsSession = vi.fn();
const recordFailure = vi.fn();

class TestInviteNotAcceptableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteNotAcceptableError';
  }
}

vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ acceptInvite, recordAuditEvent }),
  InviteNotAcceptableError: TestInviteNotAcceptableError,
}));
vi.mock('@/lib/auth/rbac/opsIdentity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/rbac/opsIdentity')>(
    '@/lib/auth/rbac/opsIdentity',
  );
  return {
    // The real error class — the route branches on `error.failure`, and a
    // stand-in would let a rename of that field pass this suite.
    OpsIdentityError: actual.OpsIdentityError,
    provisionOpsIdentity: (...args: unknown[]) => provisionOpsIdentity(...args),
    releaseOpsIdentity: (...args: unknown[]) => releaseOpsIdentity(...args),
  };
});
vi.mock('@/lib/auth/rbac/server', () => ({
  establishOpsSession: (...args: unknown[]) => establishOpsSession(...args),
}));
vi.mock('@/lib/auth/origin', () => ({ isSameOrigin: () => true }));
vi.mock('@/lib/auth/rate-limit', () => ({
  checkRateLimit: async () => ({ limited: false, retryAfterSeconds: 0 }),
  recordFailure: (...args: unknown[]) => {
    recordFailure(...args);
    return Promise.resolve({ limited: false, retryAfterSeconds: 0 });
  },
  clearFailures: async () => undefined,
  clientIpFrom: () => '203.0.113.9',
}));

const { POST } = await import('@/app/api/ops/auth/accept-invite/route');
const { OpsIdentityError } = await import('@/lib/auth/rbac/opsIdentity');
const { SUPABASE_MANAGED_PASSWORD_HASH, verifyPassword } = await import(
  '@/lib/auth/rbac/passwords'
);

const RAW_TOKEN = 'a'.repeat(48);
const INVITE_EMAIL = 'invited.dispatcher@olympuss.local';
const SUPABASE_USER_ID = '77777777-7777-7777-7777-777777777777';
const OPS_USER_ID = '11111111-1111-1111-1111-111111111111';

function acceptRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('https://olympuss.test/api/ops/auth/accept-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: RAW_TOKEN,
      name: 'Invited Dispatcher',
      password: 'a-long-enough-password',
      ...body,
    }),
  });
}

function createdUser(overrides: Partial<OpsUserRecord> = {}): OpsUserRecord {
  return {
    id: OPS_USER_ID,
    email: INVITE_EMAIL,
    name: 'Invited Dispatcher',
    role: 'dispatcher',
    passwordHash: SUPABASE_MANAGED_PASSWORD_HASH,
    status: 'active',
    vehicleId: null,
    supabaseUserId: SUPABASE_USER_ID,
    createdAt: new Date('2026-08-12T00:00:00Z').toISOString(),
    ...overrides,
  };
}

/**
 * Stands in for the real transaction: hands the callbacks the invite row's
 * OWN email and role, exactly as repo.acceptInvite does under the row lock.
 */
function repoRunsTheTransaction(invite: { email: string; role: string }) {
  acceptInvite.mockImplementation(
    async (input: {
      provisionIdentity: (i: { email: string; role: string }) => Promise<unknown>;
    }) => {
      await input.provisionIdentity({ email: invite.email, role: invite.role });
      return createdUser({ email: invite.email, role: invite.role as OpsUserRecord['role'] });
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  provisionOpsIdentity.mockResolvedValue({ supabaseUserId: SUPABASE_USER_ID });
  releaseOpsIdentity.mockResolvedValue(true);
  recordAuditEvent.mockResolvedValue({ id: 'audit-1', createdAt: new Date().toISOString() });
});

describe('accepting an invite provisions the sign-in identity', () => {
  it('creates the Supabase account from the invite row, with the invited role as its claim', async () => {
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });

    const response = await POST(acceptRequest());

    expect(response.status).toBe(200);
    expect(provisionOpsIdentity).toHaveBeenCalledTimes(1);
    expect(provisionOpsIdentity).toHaveBeenCalledWith({
      email: INVITE_EMAIL,
      password: 'a-long-enough-password',
      role: 'dispatcher',
    });
  });

  it('takes the email and role from the invite, never from the request body', async () => {
    // The classic privilege-escalation shape for an invite flow: accept a
    // driver invite while asking to be an admin, or while asking for someone
    // else's address. The route must not even have the opportunity — it hands
    // provisioning a callback that the repository calls with the locked row's
    // values.
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'driver' });

    await POST(acceptRequest({ role: 'admin', email: 'attacker@evil.test' }));

    expect(provisionOpsIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ email: INVITE_EMAIL, role: 'driver' }),
    );
  });

  it('sends the repository no password of any kind', async () => {
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });

    await POST(acceptRequest());

    const [input] = acceptInvite.mock.calls[0] as [Record<string, unknown>];
    expect(input).not.toHaveProperty('passwordHash');
    expect(input).not.toHaveProperty('password');
    expect(Object.keys(input).sort()).toEqual(
      ['name', 'provisionIdentity', 'releaseIdentity', 'tokenHash'].sort(),
    );
  });

  it('still sends only the hashed token, never the raw one', async () => {
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });

    await POST(acceptRequest());

    const [input] = acceptInvite.mock.calls[0] as [{ tokenHash: string }];
    expect(input.tokenHash).not.toBe(RAW_TOKEN);
    expect(input.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('leaves the account with no local password that could ever be used', async () => {
    // The row still needs a `password_hash` (the column is `not null`), and
    // whatever goes in it must not be a second, weaker door into an account
    // whose real credential now lives in Supabase Auth.
    await expect(verifyPassword('a-long-enough-password', SUPABASE_MANAGED_PASSWORD_HASH)).resolves.toBe(
      false,
    );
    await expect(verifyPassword(SUPABASE_MANAGED_PASSWORD_HASH, SUPABASE_MANAGED_PASSWORD_HASH)).resolves.toBe(
      false,
    );
    await expect(verifyPassword('', SUPABASE_MANAGED_PASSWORD_HASH)).resolves.toBe(false);
  });

  it('audits the acceptance and signs the operator in, exactly as before', async () => {
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });

    const response = await POST(acceptRequest());
    const body = await response.json();

    expect(body).toEqual({ ok: true, role: 'dispatcher', name: 'Invited Dispatcher' });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ops_user.invite.accept', actorUserId: OPS_USER_ID }),
    );
    expect(establishOpsSession).toHaveBeenCalledWith({
      id: OPS_USER_ID,
      email: INVITE_EMAIL,
      role: 'dispatcher',
    });
  });
});

describe('a half-finished acceptance is never left behind', () => {
  it('refuses an address that already has a sign-in account, and does not consume the invite', async () => {
    // Adopting the existing account would mean resetting a stranger's
    // password to whatever was typed into this form. Refusing is the only
    // safe answer, and the invite must survive it so an admin can link the
    // account properly.
    acceptInvite.mockImplementation(
      async (input: { provisionIdentity: (i: unknown) => Promise<unknown> }) => {
        await input.provisionIdentity({ email: INVITE_EMAIL, role: 'dispatcher' });
        throw new Error('unreachable — provisioning should have thrown');
      },
    );
    provisionOpsIdentity.mockRejectedValue(
      new OpsIdentityError('email_already_registered', 'already registered'),
    );

    const response = await POST(acceptRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('IDENTITY_ALREADY_EXISTS');
    expect(establishOpsSession).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
    // Treated as a failed attempt for rate-limiting, like any other refusal
    // on this endpoint.
    expect(recordFailure).toHaveBeenCalled();
  });

  it('reports a provisioning outage as retryable and keeps the invite alive', async () => {
    acceptInvite.mockImplementation(
      async (input: { provisionIdentity: (i: unknown) => Promise<unknown> }) => {
        await input.provisionIdentity({ email: INVITE_EMAIL, role: 'dispatcher' });
        throw new Error('unreachable');
      },
    );
    provisionOpsIdentity.mockRejectedValue(new OpsIdentityError('unreachable', 'network down'));

    const response = await POST(acceptRequest());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe('IDENTITY_PROVISIONING_FAILED');
    expect(body.error.message).toContain('still valid');
    expect(establishOpsSession).not.toHaveBeenCalled();
  });

  it('takes the new Supabase account back down when the database half fails', async () => {
    // The compensating undo. Without it, a failed acceptance leaves an
    // account that can sign in and has no ops profile — and the next attempt
    // then fails with "already registered" forever.
    acceptInvite.mockImplementation(
      async (input: {
        provisionIdentity: (i: unknown) => Promise<{ supabaseUserId: string }>;
        releaseIdentity: (id: string) => Promise<void>;
      }) => {
        const identity = await input.provisionIdentity({
          email: INVITE_EMAIL,
          role: 'dispatcher',
        });
        await input.releaseIdentity(identity.supabaseUserId);
        throw new Error('insert failed');
      },
    );

    await expect(POST(acceptRequest())).rejects.toThrow('insert failed');
    expect(releaseOpsIdentity).toHaveBeenCalledWith(SUPABASE_USER_ID);
  });

  it('surfaces an unconfigured Supabase project as configuration, not as a bad invite', async () => {
    acceptInvite.mockImplementation(
      async (input: { provisionIdentity: (i: unknown) => Promise<unknown> }) => {
        await input.provisionIdentity({ email: INVITE_EMAIL, role: 'dispatcher' });
        throw new Error('unreachable');
      },
    );
    provisionOpsIdentity.mockRejectedValue(new OpsIdentityError('not_configured', 'no key'));

    const response = await POST(acceptRequest());

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('NOT_CONFIGURED');
  });
});

describe('everything that made the invite flow safe still refuses', () => {
  it.each([
    ['expired', 'Invite has expired.'],
    ['revoked', 'Invite has been revoked.'],
    ['already accepted', 'Invite already accepted.'],
    ['unknown', 'Invite not found.'],
  ])('refuses an %s invite without provisioning anything', async (_label, message) => {
    acceptInvite.mockRejectedValue(new TestInviteNotAcceptableError(message));

    const response = await POST(acceptRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVITE_NOT_ACCEPTABLE');
    // The single generic message is retained: which of the four it was is not
    // the invitee's business.
    expect(body.error.message).toBe('This invite link is invalid or has expired.');
    expect(provisionOpsIdentity).not.toHaveBeenCalled();
  });

  it('still rejects a password shorter than the minimum before touching anything', async () => {
    const response = await POST(acceptRequest({ password: 'short' }));

    expect(response.status).toBe(400);
    expect(acceptInvite).not.toHaveBeenCalled();
    expect(provisionOpsIdentity).not.toHaveBeenCalled();
  });
});
