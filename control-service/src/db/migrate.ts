// Migration runner for THIS service's own datastore
// (CONTROL_SERVICE_DATABASE_URL, db/migrations/*.sql). Never the web app's
// Supabase connection - the two datastores are intentionally isolated
// (docs/CONTROL_SERVICE_INTEGRATION.md section 3), and the web app has its
// own separate runner at scripts/migrate-ops.mjs.
//
// Before this file, migrations were applied by hand with psql and
// control-service/README.md said no runner was wired up. That is fine for one
// developer and unworkable for two Render instances booting at once, which is
// what this exists to make safe.
//
// Guarantees:
//   * Applied in LEXICOGRAPHIC filename order (the `YYYYMMDDHHMMSS__name.sql`
//     convention makes that chronological order too).
//   * ONE TRANSACTION PER FILE - the file's SQL and its schema_migrations row
//     commit together, so a partially-applied migration is impossible.
//   * A session-level advisory lock around the whole run, so two instances
//     starting simultaneously serialize instead of racing.
//   * A sha256 checksum per file; a shipped migration edited in place is
//     detected and aborts the run rather than silently diverging schemas.
//
// Usage: `pnpm migrate` (local, via tsx) or `node dist/db/migrate.js` (the
// runtime image / Render preDeployCommand - see ../../render.yaml).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { getPool, closePool } from './pool.js';
import { logger } from '../lib/logger.js';

/**
 * db/migrations lives at the package root, two levels up from this module in
 * BOTH layouts: src/db/migrate.ts -> ../../db/migrations, and (compiled)
 * dist/db/migrate.js -> ../../db/migrations. The Dockerfile copies db/ into
 * the runtime image for exactly this reason.
 */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../db/migrations',
);

// Session-level lock held for the duration of the run. hashtext() maps the
// name to the int4 pg_advisory_lock wants, so the key is readable in source
// instead of being a magic number. The name is namespaced per datastore -
// the web app's runner uses 'ops_migrations' against its own database.
const ADVISORY_LOCK_SQL = "select pg_advisory_lock(hashtext('control_service_migrations'))";
const ADVISORY_UNLOCK_SQL = "select pg_advisory_unlock(hashtext('control_service_migrations'))";

const CREATE_SCHEMA_MIGRATIONS_SQL = `
  create table if not exists schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now(),
    checksum   text
  )
`;

export interface MigrationRunResult {
  /** Filenames applied by this run, in the order they were applied. */
  applied: string[];
  /** Filenames already present in schema_migrations and left alone. */
  skipped: string[];
}

/** Thrown when an already-applied migration file has been edited in place. */
export class MigrationChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationChecksumError';
  }
}

/** Thrown when a migration file's own begin/commit pair is unbalanced. */
export class MigrationSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationSyntaxError';
  }
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

/** Index of the first character that is not whitespace or a SQL comment. */
function skipLeadingTrivia(sql: string): number {
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch !== undefined && /\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (sql.startsWith('--', i)) {
      const newline = sql.indexOf('\n', i);
      i = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

/** Index one past the last character that is not whitespace or a SQL comment. */
function skipTrailingTrivia(sql: string): number {
  let j = sql.length;
  for (;;) {
    while (j > 0) {
      const ch = sql[j - 1];
      if (ch === undefined || !/\s/.test(ch)) break;
      j -= 1;
    }
    if (j >= 2 && sql.slice(j - 2, j) === '*/') {
      const start = sql.lastIndexOf('/*', j - 2);
      if (start === -1) break;
      j = start;
      continue;
    }
    // A trailing `-- ...` comment only counts as trivia if it is the whole
    // line; `select 1; -- note` must not lose its statement.
    const lineStart = sql.lastIndexOf('\n', j - 1) + 1;
    if (/^\s*--/.test(sql.slice(lineStart, j))) {
      j = lineStart;
      continue;
    }
    break;
  }
  return j;
}

const LEADING_BEGIN = /^(?:begin|start\s+transaction)(?:\s+(?:transaction|work))?\s*;/i;
// `commit` only, never its `end;` synonym: `end;` also terminates a PL/pgSQL
// block, and mistaking a function body's terminator for a transaction commit
// would silently mangle the migration.
const TRAILING_COMMIT = /\bcommit(?:\s+(?:transaction|work))?\s*;$/i;

/**
 * TRANSACTION-NESTING DECISION.
 *
 * Every migration in db/migrations/ opens with its own `begin;` and closes
 * with `commit;` (they were written to be applied one-at-a-time with psql).
 * The runner ALSO needs a transaction per file, because the file's SQL and
 * its schema_migrations insert must commit together or not at all.
 *
 * Postgres does not nest transactions: a `BEGIN` inside an open transaction
 * is a no-op that emits `WARNING: there is already a transaction in
 * progress`, and - far worse - the file's inner `COMMIT` would commit the
 * runner's outer transaction early, so the schema_migrations insert that
 * follows would land in a *separate*, implicitly-started transaction. A
 * crash between the two would leave the schema changed but unrecorded, and
 * the next run would re-apply the file. That is precisely the partial-apply
 * this runner exists to prevent.
 *
 * So: STRIP, don't nest. A leading `begin;` and trailing `commit;` are
 * removed and the runner supplies the transaction itself. The two are only
 * stripped as a PAIR - a file with one and not the other is a bug in the
 * file, and throws rather than being guessed at. Leading/trailing comments
 * and whitespace are skipped when looking for them, so the header comment
 * blocks these files all carry do not defeat detection.
 *
 * Known limitation, documented deliberately: a `commit;` in the MIDDLE of a
 * file (splitting it into several transactions) is not detected and would
 * still break atomicity. No migration does that, and none should - a
 * migration is one atomic unit by definition.
 */
export function stripOuterTransaction(sql: string, filename: string): string {
  const start = skipLeadingTrivia(sql);
  const end = skipTrailingTrivia(sql);
  if (start >= end) return sql;

  const segment = sql.slice(start, end);
  const beginMatch = LEADING_BEGIN.exec(segment);
  const rawCommitMatch = TRAILING_COMMIT.exec(segment);
  // Only a STANDALONE trailing commit counts. Requiring the preceding
  // statement to be terminated rules out a false positive like a column
  // named `..._commit;` closing the file.
  const commitMatch =
    rawCommitMatch && /(^|;)$/.test(segment.slice(0, rawCommitMatch.index).trimEnd())
      ? rawCommitMatch
      : null;

  if (!beginMatch && !commitMatch) return sql;
  if (!beginMatch || !commitMatch) {
    throw new MigrationSyntaxError(
      `Migration ${filename} has an unbalanced transaction block: it ${
        beginMatch ? 'opens with `begin;` but does not end with `commit;`' : 'ends with `commit;` but does not open with `begin;`'
      }. Migrations must either wrap themselves in a matched begin/commit pair or use neither.`,
    );
  }

  const body = sql.slice(start + beginMatch[0].length, end - commitMatch[0].length);
  // Keep the leading comment block: it is the file's documentation and is
  // harmless to send to Postgres, and keeping it means byte offsets in any
  // syntax error Postgres reports still roughly line up with the file.
  return `${sql.slice(0, start)}${body}`;
}

interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
}

/**
 * Read and sort the migration files. Sorted by raw code-unit comparison, NOT
 * localeCompare: locale collation can reorder punctuation (and varies by
 * machine), and the whole point is that every environment applies the same
 * files in the same order.
 */
export async function readMigrationFiles(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const filenames = entries.filter((name) => name.endsWith('.sql')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const files: MigrationFile[] = [];
  for (const filename of filenames) {
    const sql = await readFile(path.join(dir, filename), 'utf8');
    files.push({ filename, sql, checksum: sha256(sql) });
  }
  return files;
}

interface AppliedRow {
  filename: string;
  checksum: string | null;
}

/**
 * Apply every migration not yet recorded in schema_migrations.
 *
 * @param pool - injectable so tests can pass a fake; defaults to the shared
 *               service pool.
 */
export async function runMigrations(pool: Pool = getPool()): Promise<MigrationRunResult> {
  const files = await readMigrationFiles();
  const client: PoolClient = await pool.connect();

  try {
    await client.query(ADVISORY_LOCK_SQL);
    try {
      return await applyPending(client, files);
    } finally {
      // try/finally so a failed migration still releases the lock for the
      // next instance instead of wedging every future deploy.
      await client.query(ADVISORY_UNLOCK_SQL);
    }
  } finally {
    client.release();
  }
}

async function applyPending(client: PoolClient, files: MigrationFile[]): Promise<MigrationRunResult> {
  await client.query(CREATE_SCHEMA_MIGRATIONS_SQL);

  const existing = await client.query<AppliedRow>('select filename, checksum from schema_migrations');
  const appliedChecksums = new Map<string, string | null>(
    existing.rows.map((row) => [row.filename, row.checksum]),
  );

  // Guard against an edit to an already-shipped migration BEFORE applying
  // anything: an all-or-nothing check, so a drifted file cannot be detected
  // halfway through a run that already committed later files.
  for (const file of files) {
    if (!appliedChecksums.has(file.filename)) continue;
    const recorded = appliedChecksums.get(file.filename);
    // A null checksum is a row written before checksums were recorded -
    // nothing to compare against, so it is not evidence of drift.
    if (recorded === null || recorded === undefined) continue;
    if (recorded !== file.checksum) {
      throw new MigrationChecksumError(
        `Migration ${file.filename} has already been applied but its contents have changed ` +
          `(recorded sha256 ${recorded}, on disk ${file.checksum}). A shipped migration must never be ` +
          `edited in place - revert the edit and add a new migration file instead.`,
      );
    }
  }

  // Recorded but no longer on disk: not fatal (a migration deleted before it
  // ever reached this environment is a legitimate state), but worth saying
  // out loud so nobody debugs a mysterious schema difference blind.
  const onDisk = new Set(files.map((file) => file.filename));
  const orphaned = [...appliedChecksums.keys()].filter((filename) => !onDisk.has(filename));
  if (orphaned.length > 0) {
    logger.warn(
      { orphaned },
      'schema_migrations records migrations that no longer exist on disk; leaving them recorded',
    );
  }

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (appliedChecksums.has(file.filename)) {
      skipped.push(file.filename);
      continue;
    }

    const body = stripOuterTransaction(file.sql, file.filename);
    const startedAt = Date.now();

    await client.query('begin');
    try {
      await client.query(body);
      await client.query('insert into schema_migrations (filename, checksum) values ($1, $2)', [
        file.filename,
        file.checksum,
      ]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      logger.error({ err: error, filename: file.filename }, 'migration failed; rolled back');
      throw error;
    }

    applied.push(file.filename);
    logger.info({ filename: file.filename, durationMs: Date.now() - startedAt }, 'applied migration');
  }

  logger.info(
    { appliedCount: applied.length, skippedCount: skipped.length, applied },
    'migration run complete',
  );

  return { applied, skipped };
}

async function main(): Promise<void> {
  try {
    await runMigrations();
  } catch (error) {
    logger.error({ err: error }, 'migration run failed');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

// CLI entrypoint guard. True only when this module is the process entry
// (`tsx src/db/migrate.ts` or `node dist/db/migrate.js`), never when a test
// or another module imports it.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void main();
}
