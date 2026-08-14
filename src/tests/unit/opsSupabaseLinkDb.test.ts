// @vitest-environment node
//
// Postgres-backed proof of the ops_users <-> Supabase Auth linkage
// (db/migrations/20260812094500__ops_users_supabase_link.sql).
//
// Everything asserted here lives in the SCHEMA, not in TypeScript, so a
// mocked repo cannot see any of it: that at most one ops profile may bind to
// a Supabase identity, that unlinked rows are free to stay null in bulk, that
// the case-insensitive email lookup the app already performs is now backed by
// a real constraint, and — the one that would be catastrophic and silent —
// that linking touches nothing else, so the legacy password path and every
// existing FK survive it unchanged.
//
// Requires db/migrations/20260812094500__ops_users_supabase_link.sql applied:
//   OPS_DATABASE_URL=postgres://... pnpm migrate:ops
//
// SKIPPED, not failed, when OPS_DATABASE_URL is unset LOCALLY, matching every
// other Postgres-backed test in this suite. IN CI IT IS NOT OPTIONAL — see the
// hard-fail guard below.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const HAS_OPS_DB = Boolean(process.env.OPS_DATABASE_URL?.trim());

if (process.env.CI === 'true' && !HAS_OPS_DB) {
  throw new Error(
    'CI=true but OPS_DATABASE_URL is unset. In CI this suite must RUN, never skip ' +
      '(.github/workflows/ci-web.yml provisions the ops-db service for it). ' +
      'Locally, leave CI unset and it skips as before.',
  );
}

describe.skipIf(!HAS_OPS_DB)('ops_users.supabase_user_id — against a real ops Postgres', () => {
  const opsUserId = randomUUID();
  const otherOpsUserId = randomUUID();
  const unlinkedA = randomUUID();
  const unlinkedB = randomUUID();
  const supabaseUserId = randomUUID();
  const email = `supabase-link-${opsUserId}.qa@example.test`;
  const otherEmail = `supabase-link-other-${otherOpsUserId}.qa@example.test`;
  const createdIds = [opsUserId, otherOpsUserId, unlinkedA, unlinkedB];

  beforeAll(async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    const pool = getOpsPool();

    const { rows } = await pool.query(
      `select column_name from information_schema.columns
        where table_name = 'ops_users' and column_name = 'supabase_user_id'`,
    );
    if (rows.length === 0) {
      throw new Error(
        'ops_users.supabase_user_id is missing. Run: OPS_DATABASE_URL=... pnpm migrate:ops',
      );
    }

    for (const [id, addr] of [
      [opsUserId, email],
      [otherOpsUserId, otherEmail],
      [unlinkedA, `unlinked-a-${unlinkedA}.qa@example.test`],
      [unlinkedB, `unlinked-b-${unlinkedB}.qa@example.test`],
    ] as const) {
      await pool.query(
        `insert into ops_users (id, email, name, role, password_hash, status)
         values ($1, $2, 'Supabase Link Fixture', 'dispatcher', 'legacy-bcrypt-hash', 'active')`,
        [id, addr],
      );
    }
  });

  afterAll(async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    await getOpsPool().query('delete from ops_users where id = any($1::uuid[])', [createdIds]);
  });

  it('starts null, so an unlinked account keeps signing in the legacy way', async () => {
    const { getOpsRepo } = await import('@/lib/auth/rbac/repo');
    const user = await getOpsRepo().findUserById(opsUserId);

    expect(user?.supabaseUserId).toBeNull();
    // The rollback fuel. Nothing in this migration may disturb it.
    expect(user?.passwordHash).toBe('legacy-bcrypt-hash');
  });

  it('resolves a Supabase identity to exactly one ops profile once linked', async () => {
    const { getOpsRepo } = await import('@/lib/auth/rbac/repo');
    const repo = getOpsRepo();

    expect(await repo.findUserBySupabaseId(supabaseUserId)).toBeNull();

    const linked = await repo.linkSupabaseUser(opsUserId, supabaseUserId);
    expect(linked?.supabaseUserId).toBe(supabaseUserId);

    const found = await repo.findUserBySupabaseId(supabaseUserId);
    expect(found?.id).toBe(opsUserId);
    // The ops id and the Supabase id are different uuids in different
    // systems, and only the ops one may ever reach an FK column.
    expect(found?.id).not.toBe(supabaseUserId);
  });

  it('leaves password_hash and every other column untouched when linking', async () => {
    const { getOpsRepo } = await import('@/lib/auth/rbac/repo');
    const user = await getOpsRepo().findUserBySupabaseId(supabaseUserId);

    expect(user?.passwordHash).toBe('legacy-bcrypt-hash');
    expect(user?.status).toBe('active');
    expect(user?.role).toBe('dispatcher');
    expect(user?.email).toBe(email);
  });

  it('refuses to bind one Supabase identity to a second ops profile', async () => {
    const { getOpsRepo } = await import('@/lib/auth/rbac/repo');
    // Two ops rows claiming one person would make the guard's resolution
    // nondeterministic — which account's role and status decide the request?
    await expect(getOpsRepo().linkSupabaseUser(otherOpsUserId, supabaseUserId)).rejects.toThrow(
      /ops_users_supabase_user_id_uq|duplicate key/i,
    );
  });

  it('allows many unlinked rows at once — the unique index is partial', async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    const { rows } = await getOpsPool().query(
      'select count(*)::int as n from ops_users where id = any($1::uuid[]) and supabase_user_id is null',
      [[unlinkedA, unlinkedB]],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('backs the case-insensitive email lookup with a real constraint', async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    const collision = randomUUID();
    createdIds.push(collision);

    // Two rows differing only in case would make findUserByEmail (which
    // queries `lower(email) = lower($1) limit 1`, no ORDER BY)
    // nondeterministic, and would collapse onto ONE Supabase login identity.
    await expect(
      getOpsPool().query(
        `insert into ops_users (id, email, name, role, password_hash, status)
         values ($1, $2, 'Case Collision', 'driver', 'x', 'active')`,
        [collision, email.toUpperCase()],
      ),
    ).rejects.toThrow(/ops_users_email_lower_uq|duplicate key/i);
  });
});
