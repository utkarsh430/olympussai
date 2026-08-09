#!/usr/bin/env node
/**
 * Migration runner for this app's OWN Postgres datastore (db/migrations/,
 * OPS_DATABASE_URL — the Supabase instance behind src/lib/db/pool.ts).
 *
 * NOT the control service's database: those two datastores are deliberately
 * isolated (docs/CONTROL_SERVICE_INTEGRATION.md §3) and the control service
 * has its own separate runner at control-service/src/db/migrate.ts. This file
 * is the ops-side twin of that one, kept as plain Node ESM to match the other
 * scripts here (scripts/seed-ops-admin.mjs) rather than dragging a TS toolchain
 * into an operational script.
 *
 *   OPS_DATABASE_URL=postgres://... pnpm migrate:ops
 *
 * Guarantees:
 *   * Applied in LEXICOGRAPHIC filename order (the `YYYYMMDDHHMMSS__name.sql`
 *     convention makes that chronological order too).
 *   * ONE TRANSACTION PER FILE — the file's SQL and its `schema_migrations`
 *     row commit together, so a partially-applied migration is impossible.
 *   * A session-level advisory lock around the whole run, so two concurrent
 *     invocations serialize instead of racing.
 *   * A sha256 checksum per file; a shipped migration edited in place aborts
 *     the run instead of silently letting environments diverge.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');

// hashtext() maps the name to the int4 pg_advisory_lock wants, so the key
// stays readable in source instead of being a magic number. Namespaced per
// datastore — control-service uses 'control_service_migrations' against its
// own database.
const ADVISORY_LOCK_SQL = "select pg_advisory_lock(hashtext('ops_migrations'))";
const ADVISORY_UNLOCK_SQL = "select pg_advisory_unlock(hashtext('ops_migrations'))";

const CREATE_SCHEMA_MIGRATIONS_SQL = `
  create table if not exists schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now(),
    checksum   text
  )
`;

const LEADING_BEGIN = /^(?:begin|start\s+transaction)(?:\s+(?:transaction|work))?\s*;/i;
// `commit` only, never its `end;` synonym: `end;` also terminates a PL/pgSQL
// block, and mistaking a function body's terminator for a transaction commit
// would silently mangle the migration.
const TRAILING_COMMIT = /\bcommit(?:\s+(?:transaction|work))?\s*;$/i;

function sha256(contents) {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

/** Index of the first character that is not whitespace or a SQL comment. */
function skipLeadingTrivia(sql) {
  let i = 0;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
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
function skipTrailingTrivia(sql) {
  let j = sql.length;
  for (;;) {
    while (j > 0 && /\s/.test(sql[j - 1])) j -= 1;
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

/**
 * TRANSACTION-NESTING DECISION (identical to control-service's runner — see
 * the long-form rationale in control-service/src/db/migrate.ts).
 *
 * Every file in db/migrations/ opens with its own `begin;` and closes with
 * `commit;`, because they were written to be applied one-at-a-time by psql.
 * Postgres does not nest transactions: the file's inner `commit` would commit
 * the runner's outer transaction early, leaving the `schema_migrations` insert
 * in a separate implicit transaction — exactly the partial apply this runner
 * exists to prevent. So the outer pair is STRIPPED and the runner supplies the
 * transaction. Stripped only as a matched PAIR; one without the other is a bug
 * in the file and throws rather than being guessed at.
 *
 * Known limitation, documented deliberately: a `commit;` in the MIDDLE of a
 * file is not detected and would still break atomicity. No migration does
 * that, and none should — a migration is one atomic unit by definition.
 */
function stripOuterTransaction(sql, filename) {
  const start = skipLeadingTrivia(sql);
  const end = skipTrailingTrivia(sql);
  if (start >= end) return sql;

  const segment = sql.slice(start, end);
  const beginMatch = LEADING_BEGIN.exec(segment);
  const rawCommitMatch = TRAILING_COMMIT.exec(segment);
  // Only a STANDALONE trailing commit counts — requiring the preceding
  // statement to be terminated rules out a false positive such as a column
  // named `..._commit;` closing the file.
  const commitMatch =
    rawCommitMatch && /(^|;)$/.test(segment.slice(0, rawCommitMatch.index).trimEnd())
      ? rawCommitMatch
      : null;

  if (!beginMatch && !commitMatch) return sql;
  if (!beginMatch || !commitMatch) {
    throw new Error(
      `Migration ${filename} has an unbalanced transaction block: it ${
        beginMatch
          ? 'opens with `begin;` but does not end with `commit;`'
          : 'ends with `commit;` but does not open with `begin;`'
      }. Migrations must either wrap themselves in a matched begin/commit pair or use neither.`,
    );
  }

  const body = sql.slice(start + beginMatch[0].length, end - commitMatch[0].length);
  // Keep the leading comment block: it is the file's documentation, harmless
  // to send to Postgres, and keeping it means offsets in any syntax error
  // Postgres reports still roughly line up with the file.
  return sql.slice(0, start) + body;
}

/**
 * Read and sort the migration files. Sorted by raw code-unit comparison, NOT
 * localeCompare: locale collation can reorder punctuation and varies by
 * machine, and the whole point is that every environment applies the same
 * files in the same order.
 */
async function readMigrationFiles(dir = MIGRATIONS_DIR) {
  const entries = await readdir(dir);
  const filenames = entries
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const files = [];
  for (const filename of filenames) {
    const sql = await readFile(path.join(dir, filename), 'utf8');
    files.push({ filename, sql, checksum: sha256(sql) });
  }
  return files;
}

async function applyPending(client, files) {
  await client.query(CREATE_SCHEMA_MIGRATIONS_SQL);

  const existing = await client.query('select filename, checksum from schema_migrations');
  const appliedChecksums = new Map(existing.rows.map((row) => [row.filename, row.checksum]));

  // Check every already-applied file for drift BEFORE applying anything, so a
  // drifted file cannot be discovered halfway through a run that has already
  // committed later migrations.
  for (const file of files) {
    if (!appliedChecksums.has(file.filename)) continue;
    const recorded = appliedChecksums.get(file.filename);
    // A null checksum is a row written before checksums were recorded —
    // nothing to compare against, so it is not evidence of drift.
    if (recorded === null || recorded === undefined) continue;
    if (recorded !== file.checksum) {
      throw new Error(
        `Migration ${file.filename} has already been applied but its contents have changed ` +
          `(recorded sha256 ${recorded}, on disk ${file.checksum}). A shipped migration must never be ` +
          `edited in place — revert the edit and add a new migration file instead.`,
      );
    }
  }

  // Recorded but no longer on disk: not fatal (a migration deleted before it
  // ever reached this environment is a legitimate state — see
  // db/migrations/20260808100000__ops_users_vehicle_id_index.sql), but worth
  // saying out loud so nobody debugs a schema difference blind.
  const onDisk = new Set(files.map((file) => file.filename));
  const orphaned = [...appliedChecksums.keys()].filter((filename) => !onDisk.has(filename));
  if (orphaned.length > 0) {
    process.stdout.write(
      `warn: schema_migrations records migrations no longer on disk (leaving them recorded): ${orphaned.join(', ')}\n`,
    );
  }

  const applied = [];
  const skipped = [];

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
      process.stderr.write(`failed: ${file.filename} (rolled back)\n`);
      throw error;
    }

    applied.push(file.filename);
    process.stdout.write(`applied: ${file.filename} (${Date.now() - startedAt}ms)\n`);
  }

  return { applied, skipped };
}

export async function runMigrations(pool) {
  const files = await readMigrationFiles();
  const client = await pool.connect();

  try {
    await client.query(ADVISORY_LOCK_SQL);
    try {
      return await applyPending(client, files);
    } finally {
      // try/finally so a failed migration still releases the lock for the
      // next run instead of wedging every future deploy.
      await client.query(ADVISORY_UNLOCK_SQL);
    }
  } finally {
    client.release();
  }
}

async function main() {
  const connectionString = process.env.OPS_DATABASE_URL;
  if (!connectionString) {
    process.stderr.write('OPS_DATABASE_URL is not set.\n');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  try {
    const { applied, skipped } = await runMigrations(pool);
    process.stdout.write(
      `migration run complete: ${applied.length} applied, ${skipped.length} already up to date.\n`,
    );
  } finally {
    await pool.end();
  }
}

// CLI entrypoint guard — true only when this file is the process entry, never
// when something imports it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error?.message ?? error}\n`);
    process.exit(1);
  });
}
