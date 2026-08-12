// @vitest-environment node
//
// Postgres-backed regression proof for TWO keyset-pagination bugs found by
// adversarial review, both of which silently lost safety records
// (breakdown reports) with no error surfaced anywhere:
//
//   1. TIE-BREAKING. The cursor carried only `created_at` and compared with
//      a strict `<`, while the query's ORDER BY was `created_at desc, id
//      desc`. A page boundary falling in the middle of several rows sharing
//      one `created_at` dropped whichever of those rows sorted after the
//      boundary - `r.created_at < cursor` excludes ALL rows at exactly
//      `cursor`, not just the ones the page already returned.
//
//   2. PRECISION. Even with the (created_at, id) tuple in place, the cursor
//      was serialized through `Date#toISOString()` - MILLISECONDS - while
//      `created_at timestamptz` stores MICROSECONDS
//      (db/migrations/20260806120000__ops_breakdown_reports.sql). The
//      boundary row's own timestamp was therefore rounded DOWN before being
//      compared, so `(created_at, id) < (truncated, id)` excluded every row
//      in the same millisecond below the boundary - including rows no page
//      had returned. Three rows at .500900/.500500/.500100 paged one at a
//      time returned exactly one of them and then reported "no more pages";
//      the other two became permanently unreachable.
//
// Both defects live entirely in the SQL and the cursor round-trip, so both
// need a real Postgres: milliseconds only differ from microseconds when a
// real `timestamptz` column is on the other end of the comparison.
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
// SKIPPED, not failed, when OPS_DATABASE_URL is unset LOCALLY, matching
// every other Postgres-backed test in this suite. IN CI IT IS NOT OPTIONAL -
// see the hard-fail guard below.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const HAS_OPS_DB = Boolean(process.env.OPS_DATABASE_URL?.trim());

/**
 * CI-ONLY hard failure on a missing database, the same convention
 * .github/workflows/ci-web.yml's e2e job already applies to both Playwright
 * specs, and for the same reason: this file skipped on every CI run this
 * repo has ever done, because that workflow's lint/typecheck/test job had no
 * Postgres. A regression test that only ever runs on one engineer's laptop
 * is green and meaningless. The workflow now provisions a database for
 * `pnpm test`; this throw is what stops that from silently regressing back
 * to a skip if the service container is ever dropped.
 */
if (process.env.CI === 'true' && !HAS_OPS_DB) {
  throw new Error(
    'CI=true but OPS_DATABASE_URL is unset. In CI this suite must RUN, never skip ' +
      '(.github/workflows/ci-web.yml provisions the ops-db service for it). ' +
      'Locally, leave CI unset and it skips as before.',
  );
}

describe.skipIf(!HAS_OPS_DB)('listBreakdownReports keyset pagination — against a real ops Postgres', () => {
  const driverUserId = randomUUID();
  const driverEmail = `pagination-test-${driverUserId}@example.test`;
  // Sorted ascending so this file's own expectations don't accidentally
  // depend on insertion order — the query orders by id DESC as its tiebreak.
  const reportIds = [randomUUID(), randomUUID(), randomUUID()].sort();
  const SHARED_CREATED_AT = '2026-08-10T12:00:00.000Z';
  /** What the cursor for SHARED_CREATED_AT must look like: full stored precision, not `Date#toISOString()`'s three digits. */
  const SHARED_CREATED_AT_CURSOR = '2026-08-10T12:00:00.000000Z';

  // Second fixture, a SEPARATE driver so it never mixes into the tie-break
  // fixture above: three rows in the same second AND the same millisecond,
  // differing only in microseconds. Descending, i.e. the order the query
  // must return them in. `.500900` is deliberately the newest, so a cursor
  // that truncates it to `.500Z` rounds the boundary DOWN past the other
  // two and loses them.
  const microDriverUserId = randomUUID();
  const microDriverEmail = `pagination-micro-${microDriverUserId}@example.test`;
  const MICRO_CREATED_AT_DESC = [
    '2026-08-10T13:00:00.500900Z',
    '2026-08-10T13:00:00.500500Z',
    '2026-08-10T13:00:00.500100Z',
  ] as const;
  /** Parallel to MICRO_CREATED_AT_DESC - index i is the row stored at MICRO_CREATED_AT_DESC[i]. */
  const microReportIds = MICRO_CREATED_AT_DESC.map(() => randomUUID());

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

    await pool.query(
      `insert into ops_users (id, email, name, role, password_hash, status)
       values ($1, $2, 'Pagination Micro Test Driver', 'driver', 'not-a-real-hash', 'active')`,
      [microDriverUserId, microDriverEmail],
    );

    // Same second, same MILLISECOND, different microseconds. Postgres
    // stores all six digits; anything that round-trips this boundary
    // through a millisecond-precision representation loses two of these
    // three rows forever.
    for (const [index, createdAt] of MICRO_CREATED_AT_DESC.entries()) {
      await pool.query(
        `insert into ops_breakdown_reports (id, driver_user_id, vehicle_reg, category, description, created_at)
         values ($1, $2, 'UP25PAGE02', 'Mechanical', 'sub-millisecond pagination fixture', $3)`,
        [microReportIds[index], microDriverUserId, createdAt],
      );
    }

    // Guard the fixture itself: if the column ever loses sub-millisecond
    // precision (e.g. pinned to timestamptz(3)), these rows collapse onto
    // one instant and the tests below would pass for the wrong reason.
    const { rows: stored } = await pool.query<{ micros: string }>(
      `select to_char(created_at at time zone 'utc', 'US') as micros
         from ops_breakdown_reports
        where driver_user_id = $1
        order by created_at desc`,
      [microDriverUserId],
    );
    if (stored.map((r) => r.micros).join(',') !== '500900,500500,500100') {
      throw new Error(
        `ops_breakdown_reports.created_at did not keep microsecond precision (got ${stored
          .map((r) => r.micros)
          .join(',')}); this fixture cannot prove anything.`,
      );
    }
  });

  afterAll(async () => {
    const { getOpsPool } = await import('@/lib/db/pool');
    const pool = getOpsPool();
    await pool.query('delete from ops_breakdown_reports where driver_user_id = any($1)', [
      [driverUserId, microDriverUserId],
    ]);
    await pool.query('delete from ops_users where id = any($1)', [[driverUserId, microDriverUserId]]);
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
    expect(firstPage.nextCursor).toBe(`${SHARED_CREATED_AT_CURSOR}_${firstPage.items[0]?.id}`);
  });

  it('returns every row exactly once across pages when rows differ only BELOW the millisecond', async () => {
    const { getOpsRepo } = await import('@/lib/auth/rbac/repo');
    const repo = getOpsRepo();

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    // limit: 1 is the literal reproduction: page 0 returns the `.500900`
    // row and mints a cursor from it; a millisecond-precision cursor
    // rounds that boundary down to `.500000`, so page 1 comes back EMPTY
    // and the `.500500`/`.500100` reports are never reachable again.
    for (; pages < 10; pages += 1) {
      const page = await repo.listBreakdownReports({
        driverUserId: microDriverUserId,
        limit: 1,
        before: cursor,
      });
      seen.push(...page.items.map((item) => item.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(pages).toBeLessThan(10); // didn't hit the loop guard
    // Newest-first, and every row present exactly once.
    expect(seen).toEqual(microReportIds);
    expect(new Set(seen).size).toBe(microReportIds.length);
  });

  it('mints a cursor at the full stored microsecond precision, not Date#toISOString milliseconds', async () => {
    const { getOpsRepo, BREAKDOWN_REPORT_CURSOR_PATTERN } = await import('@/lib/auth/rbac/repo');
    const repo = getOpsRepo();

    const firstPage = await repo.listBreakdownReports({ driverUserId: microDriverUserId, limit: 1 });
    expect(firstPage.items[0]?.id).toBe(microReportIds[0]);
    // The exact boundary the next page is asked to continue from - the six
    // digits are the whole point, so this asserts the literal string rather
    // than a loose "has some fraction" match.
    expect(firstPage.nextCursor).toBe(`${MICRO_CREATED_AT_DESC[0]}_${microReportIds[0]}`);
    // ...and the routes' own query validation must accept what the repo mints,
    // or the very next page request 400s instead of paginating.
    expect(BREAKDOWN_REPORT_CURSOR_PATTERN.test(firstPage.nextCursor!)).toBe(true);
  });
});
