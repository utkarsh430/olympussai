// @vitest-environment node
//
// The transactional half of invite acceptance and role assignment, against a
// real Postgres.
//
// Everything asserted here lives in the TRANSACTION, not in TypeScript, so a
// mocked repository cannot see any of it. Two claims are made throughout this
// change that are only true if the database actually behaves this way:
//
//   1. "A failed acceptance leaves the invite unconsumed." That is a ROLLBACK,
//      and the only way to know a rollback happened is to look afterwards.
//   2. "A failed claim write rolls the role change back." Same. The route
//      returns 502 either way; the difference between a correct
//      implementation and a broken one is entirely in what is left in the
//      row, and a unit test with a fake repository would be asserting on its
//      own fake.
//
// Requires the ops migrations applied:
//   OPS_DATABASE_URL=postgres://... pnpm migrate:ops
//
// SKIPPED, not failed, when OPS_DATABASE_URL is unset LOCALLY, matching every
// other Postgres-backed test in this suite. IN CI IT IS NOT OPTIONAL — see the
// hard-fail guard below.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { OpsRole } from '@/lib/auth/rbac/roles';

const HAS_OPS_DB = Boolean(process.env.OPS_DATABASE_URL?.trim());

if (process.env.CI === 'true' && !HAS_OPS_DB) {
  throw new Error(
    'CI=true but OPS_DATABASE_URL is unset. In CI this suite must RUN, never skip ' +
      '(.github/workflows/ci-web.yml provisions the ops-db service for it). ' +
      'Locally, leave CI unset and it skips as before.',
  );
}

describe.skipIf(!HAS_OPS_DB)('invite acceptance and role assignment — against a real ops Postgres', () => {
  const adminId = randomUUID();
  const adminEmail = `invite-admin-${adminId}@example.test`;
  const createdUserIds: string[] = [adminId];
  const createdInviteIds: string[] = [];

  async function pool() {
    const { getOpsPool } = await import('@/lib/db/pool');
    return getOpsPool();
  }

  async function repo() {
    const { getOpsRepo } = await import('@/lib/auth/rbac/repo');
    return getOpsRepo();
  }

  /** A live, unexpired invite. Returns its id and the raw token's hash. */
  async function liveInvite(role: OpsRole = 'dispatcher'): Promise<{
    id: string;
    email: string;
    tokenHash: string;
  }> {
    const { hashInviteToken, generateInviteToken } = await import('@/lib/auth/rbac/tokens');
    const tokenHash = hashInviteToken(generateInviteToken());
    const email = `invitee-${randomUUID()}@example.test`;
    const invite = await (
      await repo()
    ).createInvite({
      email,
      role,
      invitedBy: adminId,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    createdInviteIds.push(invite.id);
    return { id: invite.id, email, tokenHash };
  }

  beforeAll(async () => {
    const db = await pool();
    const { rows } = await db.query(
      `select column_name from information_schema.columns
        where table_name = 'ops_users' and column_name = 'supabase_user_id'`,
    );
    if (rows.length === 0) {
      throw new Error(
        'ops_users.supabase_user_id is missing. Run: OPS_DATABASE_URL=... pnpm migrate:ops',
      );
    }

    await db.query(
      `insert into ops_users (id, email, name, role, password_hash, status)
       values ($1, $2, 'Invite Fixture Admin', 'admin', 'legacy-bcrypt-hash', 'active')`,
      [adminId, adminEmail],
    );
  });

  afterAll(async () => {
    const db = await pool();
    // ops_invites.invited_by is `on delete restrict`, so invites go first.
    await db.query('delete from ops_audit_log where actor_user_id = any($1::uuid[])', [
      createdUserIds,
    ]);
    await db.query('delete from ops_users where id = any($1::uuid[]) and id <> $2', [
      createdUserIds,
      adminId,
    ]);
    await db.query('delete from ops_invites where id = any($1::uuid[])', [createdInviteIds]);
    await db.query('delete from ops_users where id = $1', [adminId]);
  });

  describe('acceptInvite', () => {
    it('links the new profile to the provisioned identity and stores no local password', async () => {
      const invite = await liveInvite('planner');
      const supabaseUserId = randomUUID();

      const user = await (
        await repo()
      ).acceptInvite({
        tokenHash: invite.tokenHash,
        name: 'A Planner',
        provisionIdentity: async () => ({ supabaseUserId }),
        releaseIdentity: async () => undefined,
      });
      createdUserIds.push(user.id);

      const { SUPABASE_MANAGED_PASSWORD_HASH } = await import('@/lib/auth/rbac/passwords');
      expect(user.supabaseUserId).toBe(supabaseUserId);
      expect(user.passwordHash).toBe(SUPABASE_MANAGED_PASSWORD_HASH);
      expect(user.role).toBe('planner');
      expect(user.email).toBe(invite.email);

      // Resolvable through the Supabase front door immediately.
      const found = await (await repo()).findUserBySupabaseId(supabaseUserId);
      expect(found?.id).toBe(user.id);

      const { rows } = await (
        await pool()
      ).query('select accepted_at from ops_invites where id = $1', [invite.id]);
      expect(rows[0].accepted_at).not.toBeNull();
    });

    it('hands provisioning the invite row\'s own email and role', async () => {
      const invite = await liveInvite('driver');
      const supabaseUserId = randomUUID();
      let seen: { email: string; role: string } | null = null;

      const user = await (
        await repo()
      ).acceptInvite({
        tokenHash: invite.tokenHash,
        name: 'A Driver',
        provisionIdentity: async (i) => {
          seen = i;
          return { supabaseUserId };
        },
        releaseIdentity: async () => undefined,
      });
      createdUserIds.push(user.id);

      expect(seen).toEqual({ email: invite.email, role: 'driver' });
    });

    it('leaves the invite unconsumed and creates no profile when provisioning fails', async () => {
      // The claim the accept-invite route makes to the invitee in its error
      // message: "your invite is still valid". This is where that is true or
      // not.
      const invite = await liveInvite();

      await expect(
        (
          await repo()
        ).acceptInvite({
          tokenHash: invite.tokenHash,
          name: 'Never Created',
          provisionIdentity: async () => {
            throw new Error('Supabase refused');
          },
          releaseIdentity: async () => undefined,
        }),
      ).rejects.toThrow('Supabase refused');

      const db = await pool();
      const inviteRow = await db.query('select accepted_at from ops_invites where id = $1', [
        invite.id,
      ]);
      expect(inviteRow.rows[0].accepted_at).toBeNull();
      const userRow = await db.query('select id from ops_users where email = $1', [invite.email]);
      expect(userRow.rows).toHaveLength(0);

      // And it is still acceptable afterwards — the whole point of not
      // consuming it.
      const retrySupabaseId = randomUUID();
      const user = await (
        await repo()
      ).acceptInvite({
        tokenHash: invite.tokenHash,
        name: 'Created On Retry',
        provisionIdentity: async () => ({ supabaseUserId: retrySupabaseId }),
        releaseIdentity: async () => undefined,
      });
      createdUserIds.push(user.id);
      expect(user.supabaseUserId).toBe(retrySupabaseId);
    });

    it('releases the provisioned identity when the database half fails', async () => {
      // Forced by inserting a row that collides with the invite's address, so
      // the ops_users insert inside the transaction violates
      // ops_users_email_lower_uq after provisioning has already succeeded.
      const invite = await liveInvite();
      const squatterId = randomUUID();
      createdUserIds.push(squatterId);
      await (
        await pool()
      ).query(
        `insert into ops_users (id, email, name, role, password_hash, status)
         values ($1, $2, 'Address Squatter', 'driver', 'legacy-bcrypt-hash', 'active')`,
        [squatterId, invite.email.toUpperCase()],
      );

      const supabaseUserId = randomUUID();
      const released: string[] = [];

      await expect(
        (
          await repo()
        ).acceptInvite({
          tokenHash: invite.tokenHash,
          name: 'Doomed',
          provisionIdentity: async () => ({ supabaseUserId }),
          releaseIdentity: async (id) => {
            released.push(id);
          },
        }),
      ).rejects.toThrow();

      expect(released).toEqual([supabaseUserId]);
      const inviteRow = await (
        await pool()
      ).query('select accepted_at from ops_invites where id = $1', [invite.id]);
      expect(inviteRow.rows[0].accepted_at).toBeNull();
    });

    it('does not release the identity once the transaction has committed', async () => {
      const invite = await liveInvite();
      const supabaseUserId = randomUUID();
      const released: string[] = [];

      const user = await (
        await repo()
      ).acceptInvite({
        tokenHash: invite.tokenHash,
        name: 'Committed',
        provisionIdentity: async () => ({ supabaseUserId }),
        releaseIdentity: async (id) => {
          released.push(id);
        },
      });
      createdUserIds.push(user.id);

      expect(released).toEqual([]);
    });

    it('still refuses a second acceptance, an expired invite and a revoked one', async () => {
      const { InviteNotAcceptableError } = await import('@/lib/auth/rbac/repo');
      const db = await pool();

      const consumed = await liveInvite();
      const first = await (
        await repo()
      ).acceptInvite({
        tokenHash: consumed.tokenHash,
        name: 'First',
        provisionIdentity: async () => ({ supabaseUserId: randomUUID() }),
        releaseIdentity: async () => undefined,
      });
      createdUserIds.push(first.id);

      const expired = await liveInvite();
      await db.query(`update ops_invites set expires_at = now() - interval '1 hour' where id = $1`, [
        expired.id,
      ]);

      const revoked = await liveInvite();
      await db.query('update ops_invites set revoked_at = now() where id = $1', [revoked.id]);

      for (const invite of [consumed, expired, revoked]) {
        let provisioned = false;
        await expect(
          (
            await repo()
          ).acceptInvite({
            tokenHash: invite.tokenHash,
            name: 'Should Not Exist',
            provisionIdentity: async () => {
              provisioned = true;
              return { supabaseUserId: randomUUID() };
            },
            releaseIdentity: async () => undefined,
          }),
        ).rejects.toBeInstanceOf(InviteNotAcceptableError);
        // No identity is created for an invite that was never acceptable.
        expect(provisioned).toBe(false);
      }
    });
  });

  describe('assignUserRole', () => {
    async function linkedUser(role: OpsRole = 'dispatcher'): Promise<string> {
      const id = randomUUID();
      createdUserIds.push(id);
      await (
        await pool()
      ).query(
        `insert into ops_users (id, email, name, role, password_hash, status, supabase_user_id)
         values ($1, $2, 'Assignable', $3, 'legacy-bcrypt-hash', 'active', $4)`,
        [id, `assignable-${id}@example.test`, role, randomUUID()],
      );
      return id;
    }

    async function roleOf(id: string): Promise<string> {
      const { rows } = await (await pool()).query('select role from ops_users where id = $1', [id]);
      return rows[0].role;
    }

    it('writes the new role once the claim write succeeds', async () => {
      const id = await linkedUser('dispatcher');

      const updated = await (
        await repo()
      ).assignUserRole({ id, role: 'control_room', commitClaim: async () => undefined });

      expect(updated?.role).toBe('control_room');
      expect(await roleOf(id)).toBe('control_room');
    });

    it('rolls the role change back when the claim write fails', async () => {
      // The single most important assertion in this change. A 502 is returned
      // either way; only the row says whether the two stores were left
      // diverged — and a diverged account is refused on every request until
      // someone works out why.
      const id = await linkedUser('depot');

      await expect(
        (
          await repo()
        ).assignUserRole({
          id,
          role: 'admin',
          commitClaim: async () => {
            throw new Error('Supabase refused the claim write');
          },
        }),
      ).rejects.toThrow('Supabase refused the claim write');

      expect(await roleOf(id)).toBe('depot');
    });

    it('hands the claim writer the role that is about to be committed', async () => {
      const id = await linkedUser('driver');
      let seen: string | null = null;

      await (
        await repo()
      ).assignUserRole({
        id,
        role: 'planner',
        commitClaim: async (user) => {
          seen = user.role;
          // Visible inside the transaction, not yet committed.
          expect(await roleOf(id)).toBe('driver');
        },
      });

      expect(seen).toBe('planner');
      expect(await roleOf(id)).toBe('planner');
    });

    it('returns null for an unknown user without calling the claim writer', async () => {
      let called = false;
      const result = await (
        await repo()
      ).assignUserRole({
        id: randomUUID(),
        role: 'planner',
        commitClaim: async () => {
          called = true;
        },
      });

      expect(result).toBeNull();
      expect(called).toBe(false);
    });
  });
});
