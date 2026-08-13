// @vitest-environment node
//
// THE CUTOVER TRAP: a linked operator whose role claim has not been pushed.
//
// `ops_users` says control_room. `app_metadata.ops_role` says nothing. That is
// not a corner case — it is the state EVERY operator occupies between the
// backfill that links their profile and the push that writes their claim, so
// the entire roster passes through it, and it is the window the whole cutover
// has to survive.
//
// What used to happen, end to end:
//
//   POST /api/auth/login  -> 200 {"redirectTo":"/ops/control-room"}   (the
//                            database knows the role)
//   GET  /ops/control-room -> 307 /ops/login?next=...                  (the
//                            edge gate reads the token, which does not)
//   GET  /ops/login        -> 307 /login?next=...
//   GET  /login            -> 200, with a button pointing straight back
//
// A clickable loop with no explanation, at the moment the largest number of
// people are hitting it. Nothing in that chain is individually wrong: the two
// halves are answering from two different stores.
//
// The fix reconciles the stores at the one moment the sign-in route holds
// both: it pushes `ops_users.role` into `app_metadata` and refreshes the
// session so THIS navigation carries the claim. The direction is the whole
// safety argument and these tests pin it — database to token, never the
// reverse, and never further than the database went.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { OpsRole } from '@/lib/auth/rbac/roles';
import {
  resolveLanding,
  landingUrl,
  OPS_ACCESS_PENDING_NOTICE,
  NO_OPS_ACCESS_NOTICE,
} from '@/lib/auth/landing';

// ── Doubles ───────────────────────────────────────────────────────────────

const signInWithPassword = vi.fn();
const refreshSession = vi.fn();
const opsRoleForSupabaseUser = vi.fn<(id: string) => Promise<OpsRole | null>>();
const pushOpsRoleClaim = vi.fn<(id: string, role: OpsRole) => Promise<void>>();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword: (input: unknown) => signInWithPassword(input),
      refreshSession: () => refreshSession(),
    },
  }),
}));
vi.mock('@/lib/auth/opsAccess', () => ({
  opsRoleForSupabaseUser: (id: string) => opsRoleForSupabaseUser(id),
  currentOpsRole: vi.fn(),
  currentOpsAccess: vi.fn(),
}));
vi.mock('@/lib/auth/rbac/opsIdentity', () => ({
  pushOpsRoleClaim: (id: string, role: OpsRole) => pushOpsRoleClaim(id, role),
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  checkRateLimit: async () => ({ limited: false }),
  recordFailure: async () => ({ limited: false }),
  clearFailures: async () => {},
  clientIpFrom: () => '127.0.0.1',
}));

const { POST } = await import('@/app/api/auth/login/route');
const { syncOpsRoleClaimForSignIn, opsRoleClaimInAccessToken } = await import(
  '@/lib/auth/opsClaimSync'
);

const SUPABASE_USER_ID = '0addd862-aa69-4d7e-a2b7-f4c672c5a842';

/** A JWT-shaped string whose payload carries (or omits) an ops role claim. */
function accessTokenWithClaim(role: OpsRole | null): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: SUPABASE_USER_ID, app_metadata: role ? { ops_role: role } : {} }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

function signIn(next?: string): Promise<Response> {
  const request = new NextRequest('https://olympuss.test/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://olympuss.test',
      host: 'olympuss.test',
    },
    body: JSON.stringify({ email: 'operator@example.com', password: 'correct horse', next }),
  });
  return POST(request);
}

/** Supabase accepts the password and hands back a user carrying `claim`. */
function credentialsAccepted(claim: OpsRole | null): void {
  signInWithPassword.mockResolvedValue({
    data: {
      user: { id: SUPABASE_USER_ID, app_metadata: claim ? { ops_role: claim } : {} },
      session: { access_token: accessTokenWithClaim(claim) },
    },
    error: null,
  });
}

/** A refresh that mints a token carrying `claim`. */
function refreshMints(claim: OpsRole | null): void {
  refreshSession.mockResolvedValue({
    data: {
      session: { access_token: accessTokenWithClaim(claim) },
      user: { id: SUPABASE_USER_ID, app_metadata: claim ? { ops_role: claim } : {} },
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  opsRoleForSupabaseUser.mockResolvedValue(null);
  pushOpsRoleClaim.mockResolvedValue(undefined);
  refreshMints(null);
});

// ───────────────────────────────────────────────────────────────────────────
// THE LANDING DECISION
// ───────────────────────────────────────────────────────────────────────────

describe('landing for an operator the edge gate cannot see yet', () => {
  it('refuses to nominate the ops screen they asked for', () => {
    const decision = resolveLanding({
      requestedNext: '/ops/control-room',
      opsRole: 'control_room',
      opsClaimReady: false,
    });

    expect(decision).toEqual({
      kind: 'ops-access-pending',
      role: 'control_room',
      requested: '/ops/control-room',
    });
  });

  it('refuses to nominate their own dashboard either, when they asked for nothing', () => {
    // The subtler half. Sending them to /ops/<role> "because that is where
    // they belong" is the same bounce with a different first hop.
    const decision = resolveLanding({ opsRole: 'depot', opsClaimReady: false });

    expect(decision).toEqual({ kind: 'ops-access-pending', role: 'depot', requested: null });
  });

  it('still honours a NON-ops destination, which works perfectly well', () => {
    const decision = resolveLanding({
      requestedNext: '/project/upsrtc',
      opsRole: 'depot',
      opsClaimReady: false,
    });

    expect(decision).toEqual({ kind: 'go', path: '/project/upsrtc' });
  });

  it('is a different answer from "no ops access", because it is a different fact', () => {
    const pending = resolveLanding({
      requestedNext: '/ops/depot',
      opsRole: 'depot',
      opsClaimReady: false,
    });
    const none = resolveLanding({ requestedNext: '/ops/depot', opsRole: null });

    expect(landingUrl(pending)).toBe(`/login?notice=${OPS_ACCESS_PENDING_NOTICE}`);
    expect(landingUrl(none)).toBe(`/login?notice=${NO_OPS_ACCESS_NOTICE}`);
    expect(landingUrl(pending)).not.toBe(landingUrl(none));
  });

  it('changes nothing once the claim is there', () => {
    expect(resolveLanding({ opsRole: 'depot', opsClaimReady: true })).toEqual({
      kind: 'go',
      path: '/ops/depot',
    });
    // And the default keeps every existing caller's behaviour.
    expect(resolveLanding({ opsRole: 'depot' })).toEqual({ kind: 'go', path: '/ops/depot' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SIGN-IN
// ───────────────────────────────────────────────────────────────────────────

describe('signing in with a role the database holds and the token does not', () => {
  it('pushes the claim and sends them to their dashboard for real', async () => {
    credentialsAccepted(null);
    opsRoleForSupabaseUser.mockResolvedValue('control_room');
    refreshMints('control_room');

    const response = await signIn('/ops/control-room');

    expect(pushOpsRoleClaim).toHaveBeenCalledWith(SUPABASE_USER_ID, 'control_room');
    // Not enough to write app_metadata: the token this request already minted
    // is claimless, so without a refresh the very next hop still bounces.
    expect(refreshSession).toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true, redirectTo: '/ops/control-room' });
  });

  it('explains instead of looping when the claim cannot be pushed', async () => {
    credentialsAccepted(null);
    opsRoleForSupabaseUser.mockResolvedValue('control_room');
    pushOpsRoleClaim.mockRejectedValue(new Error('service role key is not configured'));

    const response = await signIn('/ops/control-room');

    // Sign-in still SUCCEEDS — the password was correct and Supabase issued a
    // session. What changes is where they are pointed.
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.redirectTo).toBe(`/login?notice=${OPS_ACCESS_PENDING_NOTICE}`);
    expect(body.redirectTo).not.toContain('/ops/');
  });

  it('explains instead of looping when the refresh does not carry the claim', async () => {
    // `updateUserById` merges server-side and can no-op; a write that did not
    // reach the token is a failure, not a success.
    credentialsAccepted(null);
    opsRoleForSupabaseUser.mockResolvedValue('control_room');
    refreshMints(null);

    const response = await signIn('/ops/control-room');

    expect((await response.json()).redirectTo).toBe(
      `/login?notice=${OPS_ACCESS_PENDING_NOTICE}`,
    );
  });

  it('leaves an already-correct claim alone rather than writing on every sign-in', async () => {
    credentialsAccepted('depot');
    opsRoleForSupabaseUser.mockResolvedValue('depot');

    const response = await signIn();

    expect(pushOpsRoleClaim).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
    expect((await response.json()).redirectTo).toBe('/ops/depot');
  });

  it('pushes nothing for an account with no ops profile, and nominates nowhere', async () => {
    // There is no "ordinary project viewer" tier any more: `/project/*` is
    // gated on the same active ops profile as `/ops/*`
    // (src/lib/auth/authorize.ts), so an account without one has no
    // destination and gets the explanation instead of a link that refuses it
    // on arrival.
    credentialsAccepted(null);
    opsRoleForSupabaseUser.mockResolvedValue(null);

    const response = await signIn();

    expect(pushOpsRoleClaim).not.toHaveBeenCalled();
    expect((await response.json()).redirectTo).toBe(`/login?notice=${NO_OPS_ACCESS_NOTICE}`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE DIRECTION OF THE WRITE
// ───────────────────────────────────────────────────────────────────────────

describe('the database stays the authority', () => {
  it('writes the DATABASE role into the token, never the other way round', async () => {
    // The token claims control_room; the database has since demoted this
    // account to driver. The push must correct the token DOWN.
    credentialsAccepted('control_room');
    opsRoleForSupabaseUser.mockResolvedValue('driver');
    refreshMints('driver');

    const response = await signIn();

    expect(pushOpsRoleClaim).toHaveBeenCalledWith(SUPABASE_USER_ID, 'driver');
    expect(pushOpsRoleClaim).not.toHaveBeenCalledWith(SUPABASE_USER_ID, 'control_room');
    expect((await response.json()).redirectTo).toBe('/ops/driver');
  });

  it('pushes nothing at all when the database grants no role', async () => {
    // A disabled or unlinked account: `opsRoleForSupabaseUser` returns null,
    // so there is no value to push and no ops destination to nominate. A
    // lingering claim is not honoured into one.
    credentialsAccepted('control_room');
    opsRoleForSupabaseUser.mockResolvedValue(null);

    const response = await signIn('/ops/control-room');

    expect(pushOpsRoleClaim).not.toHaveBeenCalled();
    expect((await response.json()).redirectTo).toBe(`/login?notice=${NO_OPS_ACCESS_NOTICE}`);
  });

  it('reports failure rather than success when the refreshed token disagrees', async () => {
    refreshMints('driver');

    const synced = await syncOpsRoleClaimForSignIn(
      { auth: { refreshSession } } as never,
      SUPABASE_USER_ID,
      'control_room',
    );

    expect(synced).toBe(false);
  });

  it('reads the claim out of the token that middleware will actually check', () => {
    expect(opsRoleClaimInAccessToken(accessTokenWithClaim('planner'))).toBe('planner');
    expect(opsRoleClaimInAccessToken(accessTokenWithClaim(null))).toBeNull();
    // An unrecognised or malformed value is no ceiling, never a wildcard.
    expect(opsRoleClaimInAccessToken('not-a-jwt')).toBeNull();
    expect(opsRoleClaimInAccessToken(null)).toBeNull();
  });
});
