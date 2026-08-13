// @vitest-environment node
//
// Role assignment writes two stores, or neither.
//
// `ops_users.role` is the authority; `app_metadata.ops_role` is the ceiling
// Edge middleware checks without a database. `resolveOpsSession()` refuses
// any session whose claim disagrees with the database, in BOTH directions —
// which is what makes divergence safe, and also what makes it expensive: a
// half-applied assignment is a lockout that lasts until the operator
// re-authenticates, on an account nobody knows is broken.
//
// So "the database write succeeded, the claim write did not" is not a
// degraded success. It is a failure, and these tests pin that: the claim
// write runs inside the transaction, the failure rolls the role back, the
// attempt is still recorded in the append-only audit trail, and the response
// says plainly that nothing was applied.
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';
import type { OpsRole } from '@/lib/auth/rbac/roles';

const requireOpsRole = vi.fn();
const findUserById = vi.fn();
const countAdmins = vi.fn();
const assignUserRole = vi.fn();
const recordAuditEvent = vi.fn();
const pushOpsRoleClaim = vi.fn();

vi.mock('@/lib/auth/rbac/guard', () => ({
  requireOpsRole: (...args: unknown[]) => requireOpsRole(...args),
}));
vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({ findUserById, countAdmins, assignUserRole, recordAuditEvent }),
}));
vi.mock('@/lib/auth/rbac/opsIdentity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/rbac/opsIdentity')>(
    '@/lib/auth/rbac/opsIdentity',
  );
  return {
    OpsIdentityError: actual.OpsIdentityError,
    pushOpsRoleClaim: (...args: unknown[]) => pushOpsRoleClaim(...args),
  };
});
vi.mock('@/lib/auth/origin', () => ({ isSameOrigin: () => true }));
vi.mock('@/lib/auth/rate-limit', () => ({ clientIpFrom: () => '203.0.113.9' }));

const { POST } = await import('@/app/api/ops/admin/users/[id]/role/route');
const { OpsIdentityError } = await import('@/lib/auth/rbac/opsIdentity');

const ADMIN_ID = '00000000-0000-0000-0000-0000000000ad';
const TARGET_ID = '11111111-1111-1111-1111-111111111111';
const SUPABASE_USER_ID = '99999999-9999-9999-9999-999999999999';

const ADMIN_CLAIMS = { sub: ADMIN_ID, email: 'admin@olympuss.local', role: 'admin' as const };

function target(overrides: Partial<OpsUserRecord> = {}): OpsUserRecord {
  return {
    id: TARGET_ID,
    email: 'operator@olympuss.local',
    name: 'An Operator',
    role: 'dispatcher',
    passwordHash: 'supabase-managed:no-local-password',
    status: 'active',
    vehicleId: null,
    depotId: null,
    supabaseUserId: SUPABASE_USER_ID,
    createdAt: new Date('2026-08-12T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function roleRequest(role: string, id = TARGET_ID): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`https://olympuss.test/api/ops/admin/users/${id}/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

/**
 * Stands in for the real transaction: runs `commitClaim` before "committing",
 * and propagates its failure instead of returning a user — which is what
 * `rollback` then `throw` looks like from the caller's side.
 */
function repoRunsTheTransaction(current: OpsUserRecord) {
  assignUserRole.mockImplementation(
    async (input: { role: OpsRole; commitClaim: (u: OpsUserRecord) => Promise<void> }) => {
      const updated = { ...current, role: input.role };
      await input.commitClaim(updated);
      return updated;
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOpsRole.mockResolvedValue({ ok: true, claims: ADMIN_CLAIMS });
  recordAuditEvent.mockResolvedValue({ id: 'audit-1', createdAt: new Date().toISOString() });
  countAdmins.mockResolvedValue(3);
  pushOpsRoleClaim.mockResolvedValue(undefined);
});

describe('a role change writes both stores as one action', () => {
  it('writes ops_users.role and the token claim, and audits them as one event', async () => {
    findUserById.mockResolvedValue(target({ role: 'dispatcher' }));
    repoRunsTheTransaction(target({ role: 'dispatcher' }));

    const response = await POST(...roleRequest('control_room'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(pushOpsRoleClaim).toHaveBeenCalledWith(SUPABASE_USER_ID, 'control_room');
    expect(assignUserRole).toHaveBeenCalledWith(
      expect.objectContaining({ id: TARGET_ID, role: 'control_room' }),
    );
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.user.role_assign',
        actorUserId: ADMIN_ID,
        resourceId: TARGET_ID,
        metadata: expect.objectContaining({
          previousRole: 'dispatcher',
          role: 'control_room',
          claimWritten: true,
          supabaseUserId: SUPABASE_USER_ID,
        }),
      }),
    );
    expect(body).toMatchObject({
      ok: true,
      role: 'control_room',
      previousRole: 'dispatcher',
      claimWritten: true,
      requiresReauth: true,
    });
  });

  it('pushes the claim INSIDE the transaction, before it commits', async () => {
    // The ordering is the whole design. If the claim write happened after
    // commit, its failure would leave the two stores diverged and the
    // operator locked out — which is precisely what this route exists to
    // prevent. Proven by the transaction refusing to produce a result at all
    // when the claim write throws.
    findUserById.mockResolvedValue(target());
    const observed: string[] = [];
    assignUserRole.mockImplementation(
      async (input: { role: OpsRole; commitClaim: (u: OpsUserRecord) => Promise<void> }) => {
        observed.push('role-row-written');
        await input.commitClaim(target({ role: input.role }));
        observed.push('committed');
        return target({ role: input.role });
      },
    );
    pushOpsRoleClaim.mockImplementation(async () => {
      observed.push('claim-written');
    });

    await POST(...roleRequest('planner'));

    expect(observed).toEqual(['role-row-written', 'claim-written', 'committed']);
  });

  it('re-pushes the claim when the role is unchanged, so drift can be repaired', async () => {
    findUserById.mockResolvedValue(target({ role: 'depot' }));
    repoRunsTheTransaction(target({ role: 'depot' }));

    const response = await POST(...roleRequest('depot'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(pushOpsRoleClaim).toHaveBeenCalledWith(SUPABASE_USER_ID, 'depot');
    // Nothing changed, so nobody's existing token has gone stale.
    expect(body.requiresReauth).toBe(false);
  });

  it('writes only the database for an account that has no sign-in identity yet', async () => {
    findUserById.mockResolvedValue(target({ supabaseUserId: null }));
    repoRunsTheTransaction(target({ supabaseUserId: null }));

    const response = await POST(...roleRequest('planner'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(pushOpsRoleClaim).not.toHaveBeenCalled();
    expect(body.claimWritten).toBe(false);
    // The audit record must not imply a claim was written when there was
    // nowhere to write one.
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ claimWritten: false, supabaseUserId: null }),
      }),
    );
  });
});

describe('a failed claim write fails the whole assignment', () => {
  it('applies neither store and says so', async () => {
    findUserById.mockResolvedValue(target({ role: 'dispatcher' }));
    repoRunsTheTransaction(target({ role: 'dispatcher' }));
    pushOpsRoleClaim.mockRejectedValue(
      new OpsIdentityError('write_rejected', 'Supabase refused the write'),
    );

    const response = await POST(...roleRequest('admin'));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe('ROLE_CLAIM_WRITE_FAILED');
    expect(body.error.message).toContain('The role was not changed.');
  });

  it('still records the attempt in the append-only audit trail, naming what failed', async () => {
    // The rollback undoes the role change. It does not undo the fact that an
    // admin tried and the system could not carry it out, and an append-only
    // trail is the one place that can be stated.
    findUserById.mockResolvedValue(target({ role: 'dispatcher' }));
    repoRunsTheTransaction(target({ role: 'dispatcher' }));
    pushOpsRoleClaim.mockRejectedValue(new OpsIdentityError('unreachable', 'timed out'));

    await POST(...roleRequest('control_room'));

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.user.role_assign_failed',
        actorUserId: ADMIN_ID,
        resourceId: TARGET_ID,
        metadata: expect.objectContaining({
          role: 'dispatcher',
          attemptedRole: 'control_room',
          failure: 'unreachable',
          rolledBack: true,
        }),
      }),
    );
  });

  it('does not let a failure to write the audit record mask the real failure', async () => {
    findUserById.mockResolvedValue(target());
    repoRunsTheTransaction(target());
    pushOpsRoleClaim.mockRejectedValue(new OpsIdentityError('write_not_applied', 'no-op merge'));
    recordAuditEvent.mockRejectedValue(new Error('audit table unreachable'));

    const response = await POST(...roleRequest('planner'));

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('ROLE_CLAIM_WRITE_FAILED');
  });

  it('reports an unconfigured Supabase project as configuration, not as a bad request', async () => {
    findUserById.mockResolvedValue(target());
    repoRunsTheTransaction(target());
    pushOpsRoleClaim.mockRejectedValue(new OpsIdentityError('not_configured', 'no key'));

    const response = await POST(...roleRequest('planner'));

    expect(response.status).toBe(503);
  });
});

describe('who may assign, and to whom', () => {
  it('is admin-only', async () => {
    await POST(...roleRequest('admin'));
    expect(requireOpsRole).toHaveBeenCalledWith(['admin']);
  });

  it('returns the guard refusal untouched for a non-admin', async () => {
    const refusal = new Response(null, { status: 403 });
    requireOpsRole.mockResolvedValue({ ok: false, response: refusal });

    const response = await POST(...roleRequest('admin'));

    expect(response).toBe(refusal);
    expect(assignUserRole).not.toHaveBeenCalled();
    expect(pushOpsRoleClaim).not.toHaveBeenCalled();
  });

  it('refuses to demote the last active admin, before writing anything', async () => {
    findUserById.mockResolvedValue(target({ role: 'admin', status: 'active' }));
    countAdmins.mockResolvedValue(1);

    const response = await POST(...roleRequest('planner'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('LAST_ADMIN');
    expect(assignUserRole).not.toHaveBeenCalled();
    expect(pushOpsRoleClaim).not.toHaveBeenCalled();
  });

  it('allows the last admin to be re-assigned admin (a claim repair is not a demotion)', async () => {
    findUserById.mockResolvedValue(target({ role: 'admin', status: 'active' }));
    repoRunsTheTransaction(target({ role: 'admin', status: 'active' }));
    countAdmins.mockResolvedValue(1);

    const response = await POST(...roleRequest('admin'));

    expect(response.status).toBe(200);
    expect(pushOpsRoleClaim).toHaveBeenCalledWith(SUPABASE_USER_ID, 'admin');
  });

  it('rejects an unknown role', async () => {
    findUserById.mockResolvedValue(target());

    const response = await POST(...roleRequest('superuser'));

    expect(response.status).toBe(400);
    expect(assignUserRole).not.toHaveBeenCalled();
  });

  it('404s an unknown user without calling Supabase', async () => {
    findUserById.mockResolvedValue(null);

    const response = await POST(...roleRequest('planner'));

    expect(response.status).toBe(404);
    expect(pushOpsRoleClaim).not.toHaveBeenCalled();
  });
});
