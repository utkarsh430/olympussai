// @vitest-environment node
//
// The WRITE half of scripts/backfill-ops-supabase-links.mjs, against a real
// ops Postgres.
//
// The planner is proved without a database in opsSupabaseBackfillPlan.test.ts.
// What can only be proved here is that applying a plan does exactly what the
// plan said and nothing else: that it is genuinely idempotent, that it never
// re-points an existing link, that the audit row and the link commit
// together, that a stolen identity is reported rather than overwritten, and -
// the one that would be catastrophic and silent - that linking leaves
// password_hash, role and status untouched, because password_hash is the
// entire rollback mechanism for this cutover.
//
// FIXTURE RESIDUE, deliberately. `ops_audit_log` carries BEFORE UPDATE/DELETE
// triggers that raise on every row (20260805210000__ops_rbac.sql) and
// `actor_user_id` is `not null references ops_users (id) on delete restrict`.
// So once this suite writes a real audit row, neither that row nor its actor
// can ever be deleted - by anything, including this file. That is the control
// working as designed, not a gap. The suite therefore uses ONE deterministic,
// re-used actor row (upserted, never deleted) instead of a fresh admin per
// run, so the residue is a single row rather than one per run. Every other
// fixture row is per-test and removed.
//
// Requires db/migrations/20260812094500__ops_users_supabase_link.sql applied:
//   OPS_DATABASE_URL=postgres://... pnpm migrate:ops
//
// SKIPPED, not failed, when OPS_DATABASE_URL is unset LOCALLY, matching every
// other Postgres-backed test in this suite. IN CI IT IS NOT OPTIONAL - see the
// hard-fail guard below.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// Plain ESM operational script, deliberately not TypeScript; its exports
// carry JSDoc types, so this import is fully checked.
import { applyLinks, resolveActor } from '../../../scripts/backfill-ops-supabase-links.mjs';

const HAS_OPS_DB = Boolean(process.env.OPS_DATABASE_URL?.trim());

if (process.env.CI === 'true' && !HAS_OPS_DB) {
  throw new Error(
    'CI=true but OPS_DATABASE_URL is unset. In CI this suite must RUN, never skip ' +
      '(.github/workflows/ci-web.yml provisions the ops-db service for it). ' +
      'Locally, leave CI unset and it skips as before.',
  );
}

const ACTOR_EMAIL = 'backfill-fixture-admin@example.test';
const LEGACY_HASH = '$2a$12$fixturefixturefixturefixturefixturefixturefixtureXX';

describe.skipIf(!HAS_OPS_DB)('backfill apply - against a real ops Postgres', () => {
  let pool: import('pg').Pool;
  let actor: { id: string; role: string };
  const disposableIds: string[] = [];

  /** A throwaway ops row. Nothing in ops_audit_log FKs to the subject
   * (resource_id is plain text), so these are all deletable. */
  async function makeUser({ role = 'dispatcher', status = 'active' } = {}) {
    const id = randomUUID();
    const email = `backfill-${role}-${id}@example.test`;
    await pool.query(
      `insert into ops_users (id, email, name, role, password_hash, status)
       values ($1, $2, 'Backfill Fixture', $3, $4, $5)`,
      [id, email, role, LEGACY_HASH, status],
    );
    disposableIds.push(id);
    return { id, email };
  }

  /** The row at `index`. Absent is a test failure, not an undefined that
   * makes every assertion after it vacuous. */
  function at<T>(rows: T[], index = 0): T {
    const found = rows[index];
    if (found === undefined) throw new Error(`no row at index ${index} (got ${rows.length})`);
    return found;
  }

  const decision = (user: { id: string; email: string }, targetSupabaseUserId: string) => ({
    kind: 'link',
    opsUserId: user.id,
    email: user.email,
    role: 'dispatcher',
    status: 'active',
    targetSupabaseUserId,
    caseMismatch: false,
  });

  beforeAll(async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    pool = getOpsPool();

    const { rows: columns } = await pool.query(
      `select column_name from information_schema.columns
        where table_name = 'ops_users' and column_name = 'supabase_user_id'`,
    );
    if (columns.length === 0) {
      throw new Error(
        'ops_users.supabase_user_id is missing. Run: OPS_DATABASE_URL=... pnpm migrate:ops',
      );
    }

    const { rows } = await pool.query(
      `insert into ops_users (email, name, role, password_hash, status)
       values ($1, 'Backfill Fixture Admin', 'admin', $2, 'active')
       on conflict (email) do update
         set role = 'admin', status = 'active', supabase_user_id = null
       returning id`,
      [ACTOR_EMAIL, LEGACY_HASH],
    );
    actor = { id: String(at(rows).id), role: 'admin' };
  });

  afterAll(async () => {
    // The actor row is deliberately left behind - see the header.
    await pool.query('delete from ops_users where id = any($1::uuid[])', [disposableIds]);
  });

  describe('resolveActor', () => {
    it('accepts an active admin, case-insensitively', async () => {
      expect(await resolveActor(pool, ACTOR_EMAIL.toUpperCase())).toEqual({ id: actor.id, role: 'admin' });
    });

    it('refuses a non-admin, so the trail names someone allowed to grant access', async () => {
      const planner = await makeUser({ role: 'planner' });

      await expect(resolveActor(pool, planner.email)).rejects.toThrow(/must be an admin/);
    });

    it('refuses a disabled admin', async () => {
      const disabled = await makeUser({ role: 'admin', status: 'disabled' });

      await expect(resolveActor(pool, disabled.email)).rejects.toThrow(/disabled, not active/);
    });

    it('refuses an unknown address rather than writing an unattributed link', async () => {
      await expect(resolveActor(pool, `nobody-${randomUUID()}@example.test`)).rejects.toThrow(/No ops_users row/);
    });
  });

  describe('applyLinks', () => {
    it('writes the link and its audit row together', async () => {
      const subject = await makeUser();
      const supabaseUserId = randomUUID();

      const results = await applyLinks(pool, [decision(subject, supabaseUserId)], { actor });

      expect(at(results).outcome).toBe('linked');
      const { rows } = await pool.query('select supabase_user_id from ops_users where id = $1', [subject.id]);
      expect(at(rows).supabase_user_id).toBe(supabaseUserId);

      const audit = await pool.query(
        `select action, actor_user_id, actor_role, resource_type, metadata
           from ops_audit_log where resource_id = $1`,
        [subject.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(at(audit.rows)).toMatchObject({
        action: 'admin.user.supabase_link',
        actor_user_id: actor.id,
        actor_role: 'admin',
        resource_type: 'ops_user',
      });
      expect(at(audit.rows).metadata).toMatchObject({
        supabase_user_id: supabaseUserId,
        ops_email: subject.email,
        matched_by: 'email',
        source: 'scripts/backfill-ops-supabase-links.mjs',
      });
    });

    it('never writes a password, hash or key into the audit metadata', async () => {
      const subject = await makeUser();

      await applyLinks(pool, [decision(subject, randomUUID())], { actor });

      const audit = await pool.query('select metadata from ops_audit_log where resource_id = $1', [subject.id]);
      expect(JSON.stringify(at(audit.rows).metadata)).not.toMatch(/\$2[aby]\$|password|secret|service_role/i);
    });

    it('links without an audit row under --no-audit, and says nothing else changed', async () => {
      const subject = await makeUser();

      const results = await applyLinks(pool, [decision(subject, randomUUID())], { actor: null });

      expect(at(results).outcome).toBe('linked');
      const audit = await pool.query('select 1 from ops_audit_log where resource_id = $1', [subject.id]);
      expect(audit.rowCount).toBe(0);
    });

    it('leaves password_hash, role and status untouched - the rollback depends on it', async () => {
      const subject = await makeUser();
      const before = await pool.query('select password_hash, role, status from ops_users where id = $1', [subject.id]);

      await applyLinks(pool, [decision(subject, randomUUID())], { actor });

      const after = await pool.query('select password_hash, role, status from ops_users where id = $1', [subject.id]);
      expect(at(after.rows)).toEqual(at(before.rows));
      expect(at(after.rows).password_hash).toBe(LEGACY_HASH);
    });

    it('is idempotent: re-applying the same plan writes nothing a second time', async () => {
      const subject = await makeUser();
      const plan = [decision(subject, randomUUID())];

      await applyLinks(pool, plan, { actor });
      const second = await applyLinks(pool, plan, { actor });

      // The guarded update matches nothing the second time. Reported as
      // raced rather than as success, because the operator's plan is stale.
      expect(at(second).outcome).toBe('raced');
      const audit = await pool.query('select 1 from ops_audit_log where resource_id = $1', [subject.id]);
      expect(audit.rowCount).toBe(1);
    });

    it('never re-points an existing link', async () => {
      const subject = await makeUser();
      const original = randomUUID();
      await applyLinks(pool, [decision(subject, original)], { actor });

      await applyLinks(pool, [decision(subject, randomUUID())], { actor });

      const { rows } = await pool.query('select supabase_user_id from ops_users where id = $1', [subject.id]);
      expect(at(rows).supabase_user_id).toBe(original);
    });

    it('reports a stolen identity instead of overwriting or aborting', async () => {
      const holder = await makeUser();
      const subject = await makeUser();
      const shared = randomUUID();
      await applyLinks(pool, [decision(holder, shared)], { actor });

      const results = await applyLinks(pool, [decision(subject, shared)], { actor });

      // The partial unique index rejects it; the run says why and moves on.
      expect(at(results).outcome).toBe('failed');
      expect(at(results).detail).toContain('linked to another ops row');
      const { rows } = await pool.query('select supabase_user_id from ops_users where id = $1', [subject.id]);
      expect(at(rows).supabase_user_id).toBeNull();
    });

    it('one bad row does not roll back the good ones', async () => {
      const holder = await makeUser();
      const doomed = await makeUser();
      const fine = await makeUser();
      const shared = randomUUID();
      const good = randomUUID();
      await applyLinks(pool, [decision(holder, shared)], { actor });

      const results = await applyLinks(pool, [decision(doomed, shared), decision(fine, good)], { actor });

      expect(results.map((r: { outcome: string }) => r.outcome)).toEqual(['failed', 'linked']);
      const { rows } = await pool.query('select supabase_user_id from ops_users where id = $1', [fine.id]);
      expect(at(rows).supabase_user_id).toBe(good);
      // And the failed row wrote no audit entry - no record of a link that
      // did not happen.
      const audit = await pool.query('select 1 from ops_audit_log where resource_id = $1', [doomed.id]);
      expect(audit.rowCount).toBe(0);
    });

    it('records a case-insensitive match as such, so the trail says how it matched', async () => {
      const subject = await makeUser();

      await applyLinks(pool, [{ ...decision(subject, randomUUID()), caseMismatch: true }], { actor });

      const audit = await pool.query('select metadata from ops_audit_log where resource_id = $1', [subject.id]);
      expect(at(audit.rows).metadata.matched_by).toBe('email_case_insensitive');
    });
  });
});
