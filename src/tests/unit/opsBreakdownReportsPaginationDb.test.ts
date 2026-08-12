// @vitest-environment node
//
// Postgres-backed regression proof for a keyset-pagination bug found by
// adversarial review: the old cursor carried only `created_at` and compared
// with a strict `<`, while the query's ORDER BY was `created_at desc, id
// desc`. A page boundary that fell in the middle of several rows sharing one
// `created_at` silently dropped whichever of those rows sorted after the
// boundary — `r.created_at < cursor` excludes ALL rows at exactly `cursor`,
// not just the ones the page already returned. These are safety records
// (breakdown reports), and the loss was silent, with no error surfaced
// anywhere.
//
// A mocked-repo unit test (src/tests/unit/opsBreakdownReportsRead.test.ts)
// cannot catch this — the bug lives entirely in the SQL this file drives
// against a real Postgres, the same reasoning as
// controlServiceWebhookDb.test.ts.
//
// Requires db/migrations/20260806120000__ops_breakdown_reports.sql and
// 20260812090000__ops_breakdown_reports_keyset_index.sql applied:
//   OPS_DATABASE_URL=postgres://... pnpm migrate:ops
//
// SKIPPED, not failed, when OPS_DATABASE_URL is unset, matching every other
// Postgres-backed test in this suite.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const HAS_OPS_DB = Boolean(process.env.OPS_DATABASE_URL?.trim());

describe.skipIf(!HAS_OPS_DB)('listBreakdownReports keyset pagination — against a real ops Postgres', () => {
  const driverUserId = randomUUID();
  const driverEmail = `pagination-test-${driverUserId}@example.test`;
  // Sorted ascending so this file's own expectations don't accidentally
  // depend on insertion order — the query orders by id DESC as its tiebreak.
  const reportIds = [randomUUID(), randomUUID(), randomUUID()].sort();
  const SHARED_CREATED_AT = '2026-08-10T12:00:00.000Z';

  beforeAll(async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    const pool = getOpsPool();

    const { rows } = await pool.query(
      `select table_name from information_schema.tables where table_name = 'ops_breakdown_reports'`,
    );
    if (rows.length === 0) {
      throw new Error('ops_breakdown_reports is missing. Run: OPS_DATABASE_URL=... pnpm migrate:ops');
    }

    await pool.query(
      `insert into ops_users (id, email, name, role, password_hash, status)
       values ($1, $2, 'Pagination Test Driver', 'driver', 'not-a-real-hash', 'active')`,
      [driverUserId, driverEmail],
    );

    // All three rows share the EXACT same created_at — the literal
    // reproduction the adversarial review used, not merely a millisecond
    // collision.
    for (const id of reportIds) {
      await pool.query(
        `insert into ops_breakdown_reports (id, driver_user_id, vehicle_reg, category, description, created_at)
         values ($1, $2, 'UP25PAGE01', 'Mechanical', 'pagination regression fixture', $3)`,
        [id, driverUserId, SHARED_CREATED_AT],
      );
    }
  });

  afterAll(async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    const pool = getOpsPool();
    await pool.query('delete from ops_breakdown_reports where driver_user_id = $1', [driverUserId]);
    await pool.query('delete from ops_users where id = $1', [driverUserId]);
    await pool.end();
  });

  it('returns every row exactly once across pages when multiple rows share an identical created_at', async () => {
    const { getOpsRepo } = await import('@/lib/auth/rbac/repo');
    const repo = getOpsRepo();

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    // limit: 2 against 3 same-timestamp rows forces the boundary to fall
    // mid-tie on the very first page — exactly the case the old
    // `created_at`-only cursor lost a row on.
    for (; pages < 10; pages += 1) {
      const page = await repo.listBreakdownReports({ driverUserId, limit: 2, before: cursor });
      seen.push(...page.items.map((item) => item.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(pages).toBeGreaterThan(0);
    expect(pages).toBeLessThan(10); // didn't hit the loop guard (would mean it never terminates)
    expect(seen.sort()).toEqual([...reportIds].sort());
    // Exactly once each: no silent loss, and no duplicate from a boundary
    // that double-counts a tied row instead of dropping one.
    expect(new Set(seen).size).toBe(reportIds.length);
  });

  it('the cursor tiebreaks by id, matching ORDER BY created_at desc, id desc', async () => {
    const { getOpsRepo } = await import('@/lib/auth/rbac/repo');
    const repo = getOpsRepo();

    const firstPage = await repo.listBreakdownReports({ driverUserId, limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    // Highest id first among tied timestamps.
    expect(firstPage.items[0]?.id).toBe([...reportIds].sort().reverse()[0]);
    expect(firstPage.nextCursor).toBe(`${SHARED_CREATED_AT}_${firstPage.items[0]?.id}`);
  });
});
