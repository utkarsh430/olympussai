// @vitest-environment node
//
// What `revokeOpsIdentity` actually sends to Supabase Auth, and what it
// refuses to call a revocation.
//
// `ops_users.status` revokes /ops/*. It revokes nothing else: /project/* and
// /api/upsrtc/* authorize on "any signed-in Supabase user", so a disabled
// operator kept full enterprise access, renewed by refresh, indefinitely.
// Banning the identity is what closes that, and this file pins the two things
// the disable route cannot see for itself — that the ban is on the wire, and
// that a write which did not ban is reported as a failure rather than a
// success.
//
// Measured against the project's own Supabase instance with the installed
// @supabase/auth-js 2.112.2 (`ban_duration` is on `AdminUserAttributes` at
// dist/module/lib/types.d.ts:493), a ban produces:
//
//   GET /user with the already-issued access token   403 user_banned
//   refresh_token grant                              400 user_banned
//   a fresh password sign-in                         400 user_banned
//
// so the enterprise surface, which asks Supabase Auth on every request,
// refuses on the next request rather than after a token lifetime.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserById = vi.fn();
const updateUserById = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { getUserById, updateUserById } } }),
}));

const { revokeOpsIdentity, pushOpsRoleClaim, OpsIdentityError } = await import(
  '@/lib/auth/rbac/opsIdentity'
);

const SUPABASE_USER_ID = '99999999-9999-9999-9999-999999999999';
const FAR_FUTURE = '2126-07-20T00:17:48.705166875Z';

function userResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      user: {
        id: SUPABASE_USER_ID,
        // Supabase Auth maintains these itself; dropping them is a silent,
        // unrecoverable lockout, so every write must be seen to merge.
        app_metadata: { provider: 'email', providers: ['email'], ops_role: 'control_room' },
        ...overrides,
      },
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserById.mockResolvedValue(userResponse());
});

describe('revokeOpsIdentity', () => {
  it('clears the role claim and bans the account in ONE write', async () => {
    updateUserById.mockResolvedValue(
      userResponse({
        app_metadata: { provider: 'email', providers: ['email'], ops_role: null },
        banned_until: FAR_FUTURE,
      }),
    );

    await expect(revokeOpsIdentity(SUPABASE_USER_ID)).resolves.toBeUndefined();

    // Two calls would have a window between them where the ceiling is gone
    // but the account is still live, and a second call that fails leaves a
    // half-revocation nobody is watching.
    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(updateUserById).toHaveBeenCalledWith(SUPABASE_USER_ID, {
      app_metadata: { provider: 'email', providers: ['email'], ops_role: null },
      // 876000h is a hundred years — auth-js's own documented "indefinitely".
      ban_duration: '876000h',
    });
  });

  it('writes the cleared claim as an explicit null, never by omitting the key', async () => {
    updateUserById.mockResolvedValue(
      userResponse({
        app_metadata: { provider: 'email', providers: ['email'], ops_role: null },
        banned_until: FAR_FUTURE,
      }),
    );

    await revokeOpsIdentity(SUPABASE_USER_ID);

    // `updateUserById` MERGES app_metadata, so an omitted key means "leave the
    // old role exactly where it is" — the opposite of a revocation.
    const attributes = updateUserById.mock.calls[0]![1];
    expect(Object.keys(attributes.app_metadata)).toContain('ops_role');
    expect(attributes.app_metadata.ops_role).toBeNull();
    expect(attributes.app_metadata.provider).toBe('email');
  });

  it('fails when Supabase accepted the write but the account is not banned', async () => {
    updateUserById.mockResolvedValue(
      userResponse({ app_metadata: { ops_role: null } }), // no banned_until
    );

    await expect(revokeOpsIdentity(SUPABASE_USER_ID)).rejects.toMatchObject({
      name: 'OpsIdentityError',
      failure: 'write_not_applied',
    });
  });

  it('fails when the ban read back has already expired', async () => {
    updateUserById.mockResolvedValue(
      userResponse({
        app_metadata: { ops_role: null },
        banned_until: '2020-01-01T00:00:00Z',
      }),
    );

    // A past `banned_until` is not a ban. Accepting it would report a
    // revocation that grants the account access on its next request.
    await expect(revokeOpsIdentity(SUPABASE_USER_ID)).rejects.toMatchObject({
      failure: 'write_not_applied',
    });
  });

  it('fails when the ban landed but the role claim did not', async () => {
    updateUserById.mockResolvedValue(
      userResponse({
        app_metadata: { ops_role: 'control_room' },
        banned_until: FAR_FUTURE,
      }),
    );

    await expect(revokeOpsIdentity(SUPABASE_USER_ID)).rejects.toMatchObject({
      failure: 'write_not_applied',
    });
  });

  it('reports a vanished identity as identity_not_found, not as a rejected write', async () => {
    updateUserById.mockResolvedValue({ data: null, error: { code: 'user_not_found', status: 404 } });

    await expect(revokeOpsIdentity(SUPABASE_USER_ID)).rejects.toMatchObject({
      failure: 'identity_not_found',
    });
  });

  it('surfaces a refused write as write_rejected', async () => {
    updateUserById.mockResolvedValue({ data: null, error: { status: 500, message: 'boom' } });

    const error = await revokeOpsIdentity(SUPABASE_USER_ID).catch((e) => e);
    expect(error).toBeInstanceOf(OpsIdentityError);
    expect(error.failure).toBe('write_rejected');
  });
});

describe('pushOpsRoleClaim leaves the ban question alone', () => {
  it('never sends ban_duration on an ordinary role change', async () => {
    updateUserById.mockResolvedValue(
      userResponse({ app_metadata: { provider: 'email', providers: ['email'], ops_role: 'depot' } }),
    );

    await pushOpsRoleClaim(SUPABASE_USER_ID, 'depot');

    const attributes = updateUserById.mock.calls[0]![1];
    // Omitted, not `'none'`: sending a value either way would let a role
    // change silently decide whether a banned account is allowed back in.
    expect(attributes).not.toHaveProperty('ban_duration');
  });

  it('does not require the account to be unbanned to succeed', async () => {
    updateUserById.mockResolvedValue(
      userResponse({
        app_metadata: { provider: 'email', providers: ['email'], ops_role: 'depot' },
        banned_until: FAR_FUTURE,
      }),
    );

    await expect(pushOpsRoleClaim(SUPABASE_USER_ID, 'depot')).resolves.toBeUndefined();
  });
});
