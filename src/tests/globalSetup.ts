// Runs ONCE, in plain Node, before any test file starts — not per test file
// the way `setupFiles` (src/tests/setup.ts) does, and not in the jsdom
// environment `vitest.config.ts` sets for every test file. That is exactly
// the right place to refuse the whole run before any Postgres-backed test
// file's own `beforeAll` can write a single fixture row, whichever of them
// happens to run first.
//
// OPS_DATABASE_URL unset -> every DB-backed test in this suite already
// skips itself (see e.g. src/tests/unit/opsBreakdownReportsPaginationDb.test.ts's
// `describe.skipIf(!HAS_OPS_DB)`), so there is nothing to guard and this
// returns immediately without connecting to anything.
//
// See scripts/lib/disposable-db.mjs for what "disposable" means and why a
// stray env var pointing this suite at a real database is exactly the
// failure this exists to catch.
export default async function setup(): Promise<void> {
  const connectionString = process.env.OPS_DATABASE_URL;
  if (!connectionString || !connectionString.trim()) return;

  const { assertDisposableOpsDatabase } = await import('../../scripts/lib/disposable-db.mjs');
  await assertDisposableOpsDatabase(connectionString);
}
