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
//
// ─── AND WHICH SESSION THE NEW OPERATOR WALKS AWAY WITH ──────────────────
//
// The half this route got wrong for as long as it has existed: it provisioned
// a Supabase identity and then opened a LEGACY ops session against it. So the
// one path that creates brand-new operators was the only path that never
// produced a Supabase session — an account whose sole credential lives in
// Supabase Auth, holding a 4-hour cookie from the door being dismantled, and
// nothing at all the moment that door is deleted.
//
// The tests at the bottom pin the corrected contract: the invitee is signed
// in through the same front door as everybody else, with the password they
// just chose and the invite's own address; the destination comes from the
// server rather than from the browser; the legacy cookie is issued ONLY when
// Supabase cannot be reached, because by then the single-use invite is
// already spent and refusing would strand a real person.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';
import type { OpsRole } from '@/lib/auth/rbac/roles';

const acceptInvite = vi.fn();
const recordAuditEvent = vi.fn();
const provisionOpsIdentity = vi.fn();
const releaseOpsIdentity = vi.fn();
const pushOpsRoleClaim = vi.fn();
const establishOpsSession = vi.fn();
const recordFailure = vi.fn();
const signInWithPassword = vi.fn();
const refreshSession = vi.fn();
/** Thrown by the client factory when a test wants "Supabase is unconfigured". */
let supabaseClientFactoryError: Error | null = null;

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
    // Reached only through the real `syncOpsRoleClaimForSignIn`, which the
    // route falls back to when the freshly minted token somehow arrives
    // without the claim provisioning already asserted.
    pushOpsRoleClaim: (...args: unknown[]) => pushOpsRoleClaim(...args),
  };
});
vi.mock('@/lib/auth/rbac/server', () => ({
  establishOpsSession: (...args: unknown[]) => establishOpsSession(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    if (supabaseClientFactoryError) throw supabaseClientFactoryError;
    return {
      auth: {
        signInWithPassword: (input: unknown) => signInWithPassword(input),
        refreshSession: () => refreshSession(),
      },
    };
  },
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
const CHOSEN_PASSWORD = 'a-long-enough-password';

/**
 * A JWT-shaped access token whose payload carries (or omits) an ops role
 * claim. The route reads the TOKEN, not the user record, because the token is
 * the artifact Edge middleware will actually verify.
 */
function accessTokenWithClaim(role: OpsRole | null): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: SUPABASE_USER_ID, app_metadata: role ? { ops_role: role } : {} }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

/** What Supabase Auth returns for a successful password sign-in. */
function signedInAs(role: OpsRole | null) {
  return {
    data: {
      user: { id: SUPABASE_USER_ID, app_metadata: role ? { ops_role: role } : {} },
      session: { access_token: accessTokenWithClaim(role) },
    },
    error: null,
  };
}

function acceptRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('https://olympuss.test/api/ops/auth/accept-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: RAW_TOKEN,
      name: 'Invited Dispatcher',
      password: CHOSEN_PASSWORD,
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
    depotId: null,
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
  supabaseClientFactoryError = null;
  provisionOpsIdentity.mockResolvedValue({ supabaseUserId: SUPABASE_USER_ID });
  releaseOpsIdentity.mockResolvedValue(true);
  recordAuditEvent.mockResolvedValue({ id: 'audit-1', createdAt: new Date().toISOString() });
  // The happy path: provisioning stamped the claim on at creation, so the
  // very first token already carries it.
  signInWithPassword.mockImplementation(async () => signedInAs('dispatcher'));
  pushOpsRoleClaim.mockResolvedValue(undefined);
  refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('not stubbed') });
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

  it('audits the acceptance', async () => {
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });

    await POST(acceptRequest());

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ops_user.invite.accept', actorUserId: OPS_USER_ID }),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE SESSION THE INVITEE LEAVES WITH
// ───────────────────────────────────────────────────────────────────────────

describe('accepting an invite opens a real session on the single front door', () => {
  it('signs the new operator in through Supabase with the password they just chose', async () => {
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });

    const response = await POST(acceptRequest());

    expect(response.status).toBe(200);
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: INVITE_EMAIL,
      password: CHOSEN_PASSWORD,
    });
  });

  it('signs in as the INVITE address, never one the client asked for', async () => {
    // Same escalation shape provisioning already refuses, one step later: a
    // sign-in against a client-supplied address would hand the invitee a
    // session belonging to somebody else.
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'driver' });

    await POST(acceptRequest({ email: 'victim@olympuss.local' }));

    expect(signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: INVITE_EMAIL }),
    );
  });

  it('does NOT fall back to a legacy ops cookie when Supabase signed them in', async () => {
    // The defect, stated as an assertion. A Supabase-managed account with a
    // legacy session is precisely the state the cutover is removing, and it
    // is what this route produced for every operator it ever created.
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });

    await POST(acceptRequest());

    expect(establishOpsSession).not.toHaveBeenCalled();
  });

  it('sends them to their own dashboard, chosen by the server', async () => {
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });

    const body = await (await POST(acceptRequest())).json();

    expect(body).toEqual({
      ok: true,
      role: 'dispatcher',
      name: 'Invited Dispatcher',
      redirectTo: '/ops/dispatcher',
    });
  });

  it('sends a new admin to /ops/admin, which is now a real console', async () => {
    // This assertion used to read "not to /ops/admin, which is not a page",
    // and it was right: the segment held no page.tsx, so a new admin accepting
    // an invite landed on a 404 unless the landing logic detoured them. The
    // detour is gone because the destination exists.
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'admin' });
    signInWithPassword.mockImplementation(async () => signedInAs('admin'));

    const body = await (await POST(acceptRequest())).json();

    expect(body.redirectTo).toBe('/ops/admin');
  });

  it('repairs a token that arrived without the ops role claim, and only then lands them', async () => {
    // Provisioning asserts the claim was stored, so this should be
    // unreachable — but a token with no claim is invisible to the Edge gate,
    // and nominating an /ops/* path for it is the redirect loop itself.
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });
    signInWithPassword.mockImplementation(async () => signedInAs(null));
    refreshSession.mockResolvedValue({
      data: { session: { access_token: accessTokenWithClaim('dispatcher') } },
      error: null,
    });

    const body = await (await POST(acceptRequest())).json();

    expect(pushOpsRoleClaim).toHaveBeenCalledWith(SUPABASE_USER_ID, 'dispatcher');
    expect(body.redirectTo).toBe('/ops/dispatcher');
  });

  it('explains rather than bouncing when the claim cannot be repaired', async () => {
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });
    signInWithPassword.mockImplementation(async () => signedInAs(null));
    pushOpsRoleClaim.mockRejectedValue(new Error('Auth admin unreachable'));

    const response = await POST(acceptRequest());
    const body = await response.json();

    // Still a successful acceptance — the account exists and the invite is
    // spent. What it must not do is point them at a dashboard the edge will
    // refuse; every /ops/* destination bounces without the claim.
    expect(response.status).toBe(200);
    expect(body.redirectTo).toBe('/login?notice=ops-access-pending');
    expect(establishOpsSession).not.toHaveBeenCalled();
  });

  it('falls back to a legacy session when Supabase Auth refuses the sign-in', async () => {
    // The invite is single-use and already spent by this point. Refusing
    // here would strand a real operator behind a link that can never be
    // clicked again, so they get a working session and land normally.
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'service unavailable', status: 503 },
    });

    const response = await POST(acceptRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(establishOpsSession).toHaveBeenCalledWith({
      id: OPS_USER_ID,
      email: INVITE_EMAIL,
      role: 'dispatcher',
    });
    // The legacy cookie IS a ceiling the edge accepts, so the dashboard is
    // the honest destination here — not an "access pending" explanation.
    expect(body.redirectTo).toBe('/ops/dispatcher');
  });

  it('falls back the same way when Supabase is not configured at all', async () => {
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });
    supabaseClientFactoryError = new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured');

    const response = await POST(acceptRequest());

    expect(response.status).toBe(200);
    expect(establishOpsSession).toHaveBeenCalledTimes(1);
    expect((await response.json()).redirectTo).toBe('/ops/dispatcher');
  });

  it('still answers 200 when neither door can open a session', async () => {
    // Nothing left to give them, but the acceptance genuinely happened and
    // the account genuinely exists. Reporting failure would tell them to
    // click a link that is now dead.
    repoRunsTheTransaction({ email: INVITE_EMAIL, role: 'dispatcher' });
    supabaseClientFactoryError = new Error('unconfigured');
    establishOpsSession.mockRejectedValue(new Error('OPS_SESSION_SECRET is missing'));

    const response = await POST(acceptRequest());

    expect(response.status).toBe(200);
    expect((await response.json()).redirectTo).toBe('/login?notice=ops-access-pending');
  });

  it('never signs anyone in when the acceptance itself was refused', async () => {
    acceptInvite.mockRejectedValue(new TestInviteNotAcceptableError('Invite has expired.'));

    await POST(acceptRequest());

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(establishOpsSession).not.toHaveBeenCalled();
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

describe('an invite whose address already has an ops_users row', () => {
  /**
   * What the ops database raises when `acceptInvite`'s insert collides with
   * `ops_users.email`'s unique constraint. `pg` puts the driver's own fields
   * on a plain Error, which is exactly what the route has to recognise —
   * verified against a real Postgres with the ops migrations applied.
   */
  function duplicateEmailViolation(): Error {
    return Object.assign(new Error('duplicate key value violates unique constraint "ops_users_email_key"'), {
      code: '23505',
      constraint: 'ops_users_email_key',
    });
  }

  it('answers a clean 409 instead of a 500 carrying the raw constraint name', async () => {
    // THE DEFECT. Nothing refused an invite for an address that already had an
    // account (POST /api/ops/admin/invites now does — see
    // opsInviteExistingAccount.test.ts), so the collision surfaced HERE, to the
    // invitee, as an unhandled throw. `deleteInvite`-shaped repair is not
    // available to them and the message named a database constraint.
    acceptInvite.mockRejectedValue(duplicateEmailViolation());

    const response = await POST(acceptRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('ACCOUNT_ALREADY_EXISTS');
    expect(body.error.message).toMatch(/already has an operations account/i);
    // Whatever they do next, it is not retrying this link.
    expect(body.error.message).toMatch(/administrator/i);
    // And it must not read like a database error.
    expect(body.error.message).not.toMatch(/constraint|ops_users|23505/i);
  });

  it('leaves any other unique-constraint failure alone rather than mislabelling it', async () => {
    // A 23505 on a different constraint is a different fact, and answering
    // "you already have an account" to it would be a guess. It stays an
    // unhandled server error, which is the honest report of an unknown state.
    acceptInvite.mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint "ops_invites_token_hash_key"'), {
        code: '23505',
        constraint: 'ops_invites_token_hash_key',
      }),
    );

    await expect(POST(acceptRequest())).rejects.toThrow(/token_hash/);
  });
});
