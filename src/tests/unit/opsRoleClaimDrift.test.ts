// @vitest-environment node
//
// Detecting a role that disagrees with itself.
//
// A role now lives in `ops_users.role` (authority) and in
// `app_metadata.ops_role` (the ceiling Edge middleware checks). They are
// written together, but they can still fall apart through paths this app does
// not control — the Supabase dashboard, a psql session, a user deleted on one
// side only.
//
// The symptom is nasty precisely because it is safe: `resolveOpsSession()`
// refuses a session whose claim disagrees with the database, so divergence is
// never an escalation. It is a lockout that presents to the operator as "I
// sign in and it immediately tells me my session is out of date", with
// nothing in any log naming the cause. This checker is what turns that into a
// list of names.
//
// The tests that matter most are the last two: an account that could not be
// READ must never be reported as clean, and an unlinked account must never be
// reported as drift. Getting either backwards makes the check worse than not
// having one — the first turns an outage into a green light, the second
// buries the real findings under every legacy row in the table.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';
import type { OpsRole } from '@/lib/auth/rbac/roles';

const listUsers = vi.fn<() => Promise<OpsUserRecord[]>>();
const readOpsRoleClaim = vi.fn<(id: string) => Promise<OpsRole | null>>();

vi.mock('@/lib/auth/rbac/repo', () => ({ getOpsRepo: () => ({ listUsers }) }));
vi.mock('@/lib/auth/rbac/opsIdentity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/rbac/opsIdentity')>(
    '@/lib/auth/rbac/opsIdentity',
  );
  return {
    OpsIdentityError: actual.OpsIdentityError,
    readOpsRoleClaim: (id: string) => readOpsRoleClaim(id),
  };
});

const { findOpsRoleDrift } = await import('@/lib/auth/rbac/roleDrift');
const { OpsIdentityError } = await import('@/lib/auth/rbac/opsIdentity');

let seq = 0;
function user(overrides: Partial<OpsUserRecord> = {}): OpsUserRecord {
  seq += 1;
  return {
    id: `1111111${seq}-1111-1111-1111-111111111111`,
    email: `operator-${seq}@olympuss.local`,
    name: `Operator ${seq}`,
    role: 'dispatcher',
    passwordHash: 'supabase-managed:no-local-password',
    status: 'active',
    vehicleId: null,
    supabaseUserId: `9999999${seq}-9999-9999-9999-999999999999`,
    createdAt: new Date('2026-08-12T00:00:00Z').toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
});

describe('findOpsRoleDrift', () => {
  it('reports nothing when every claim matches its row', async () => {
    const users = [user({ role: 'dispatcher' }), user({ role: 'planner' })];
    listUsers.mockResolvedValue(users);
    readOpsRoleClaim.mockImplementation(async (id) => {
      const match = users.find((u) => u.supabaseUserId === id);
      return match ? match.role : null;
    });

    const report = await findOpsRoleDrift();

    expect(report.drift).toEqual([]);
    expect(report.linkedUsers).toBe(2);
    expect(report.unlinkedUsers).toBe(0);
    expect(report.totalUsers).toBe(2);
  });

  it('names an account whose claim is a different role than the database', async () => {
    const stale = user({ role: 'depot' });
    listUsers.mockResolvedValue([stale]);
    readOpsRoleClaim.mockResolvedValue('control_room');

    const report = await findOpsRoleDrift();

    expect(report.drift).toEqual([
      expect.objectContaining({
        opsUserId: stale.id,
        email: stale.email,
        databaseRole: 'depot',
        claimRole: 'control_room',
        kind: 'claim_stale',
      }),
    ]);
  });

  it('names a linked account whose token carries no ops role at all', async () => {
    // Not a lockout at the guard — the database still decides — but the
    // account cannot get past Edge middleware through the Supabase front
    // door, which is its own kind of invisible.
    listUsers.mockResolvedValue([user({ role: 'driver' })]);
    readOpsRoleClaim.mockResolvedValue(null);

    const report = await findOpsRoleDrift();

    expect(report.drift[0]).toMatchObject({ kind: 'claim_missing', claimRole: null });
  });

  it('names a disabled account whose identity still carries a role', async () => {
    listUsers.mockResolvedValue([user({ role: 'control_room', status: 'disabled' })]);
    readOpsRoleClaim.mockResolvedValue('control_room');

    const report = await findOpsRoleDrift();

    expect(report.drift[0]).toMatchObject({
      kind: 'claim_lingering',
      databaseStatus: 'disabled',
      claimRole: 'control_room',
    });
  });

  it('does not report a disabled account that was cleaned up properly', async () => {
    listUsers.mockResolvedValue([user({ status: 'disabled' })]);
    readOpsRoleClaim.mockResolvedValue(null);

    const report = await findOpsRoleDrift();

    expect(report.drift).toEqual([]);
  });

  it('names an account whose linked identity no longer exists', async () => {
    listUsers.mockResolvedValue([user()]);
    readOpsRoleClaim.mockRejectedValue(new OpsIdentityError('identity_not_found', 'gone'));

    const report = await findOpsRoleDrift();

    expect(report.drift[0]).toMatchObject({ kind: 'identity_missing' });
  });

  it('reports an account it could not read as unknown, never as clean', async () => {
    // The failure mode that would make this check actively harmful: a
    // Supabase outage silently producing an empty drift list.
    listUsers.mockResolvedValue([user(), user()]);
    readOpsRoleClaim.mockRejectedValue(new OpsIdentityError('unreachable', 'timed out'));

    const report = await findOpsRoleDrift();

    expect(report.drift).toHaveLength(2);
    expect(report.drift.every((entry) => entry.kind === 'unreadable')).toBe(true);
    expect(report.drift[0]?.detail).toContain('timed out');
  });

  it('does not treat an account with no sign-in identity as drift, but does count it', async () => {
    // Every legacy row is in this state until it is backfilled. Reporting
    // them as drift would bury the findings that matter; not counting them
    // would let "0 drift" read as "everything is linked".
    listUsers.mockResolvedValue([
      user({ supabaseUserId: null }),
      user({ supabaseUserId: null }),
      user({ role: 'planner' }),
    ]);
    readOpsRoleClaim.mockResolvedValue('planner');

    const report = await findOpsRoleDrift();

    expect(report.drift).toEqual([]);
    expect(report.totalUsers).toBe(3);
    expect(report.linkedUsers).toBe(1);
    expect(report.unlinkedUsers).toBe(2);
    expect(readOpsRoleClaim).toHaveBeenCalledTimes(1);
  });

  it('checks every linked account even on a roster larger than one read window', async () => {
    const users = Array.from({ length: 12 }, () => user());
    listUsers.mockResolvedValue(users);
    readOpsRoleClaim.mockResolvedValue('admin'); // disagrees with every row

    const report = await findOpsRoleDrift();

    expect(readOpsRoleClaim).toHaveBeenCalledTimes(12);
    expect(report.drift).toHaveLength(12);
  });
});
