// Unit coverage for the migration runner (src/db/migrate.ts): lexicographic
// ordering, the one-transaction-per-file wrapper (including the strip of each
// file's own begin/commit so transactions are never nested), idempotent
// re-runs, checksum-drift detection, and the advisory lock that keeps two
// instances booting at once from racing.
//
// Mocks a minimal Pool/PoolClient in the same style as
// commandLifecycleDb.test.ts - branching on the SQL text rather than call
// order. No live database: what a mocked pool can prove is the runner's own
// sequencing and gating, which is exactly what this file asserts. Postgres's
// own transactional/DDL behaviour is Postgres's job.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import {
  runMigrations,
  readMigrationFiles,
  stripOuterTransaction,
  MigrationChecksumError,
  MigrationSyntaxError,
} from '../src/db/migrate.js';

interface RecordedCall {
  sql: string;
  values?: unknown[];
}

interface FakeDbOptions {
  /** Rows the runner should see in schema_migrations. */
  existing?: { filename: string; checksum: string | null }[];
  /** Return an Error to make a particular statement fail. */
  failOn?: (sql: string) => Error | null;
}

function fakeDb(options: FakeDbOptions = {}) {
  const calls: RecordedCall[] = [];

  const query = vi.fn((sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith('select filename, checksum from schema_migrations')) {
      return Promise.resolve({ rows: options.existing ?? [] });
    }
    const failure = options.failOn?.(sql) ?? null;
    if (failure) return Promise.reject(failure);
    return Promise.resolve({ rows: [] });
  });

  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

  return {
    pool,
    query,
    calls,
    release: client.release,
    /** Filenames passed to `insert into schema_migrations`, in order. */
    insertedFilenames(): string[] {
      return calls
        .filter((call) => call.sql.trim().toLowerCase().startsWith('insert into schema_migrations'))
        .map((call) => String(call.values?.[0]));
    },
    sqlTexts(): string[] {
      return calls.map((call) => call.sql.trim().toLowerCase());
    },
  };
}

describe('stripOuterTransaction', () => {
  it('removes a file-level begin/commit pair so the runner never nests transactions', () => {
    const sql = '-- header comment\nbegin;\n\nalter table t add column c text;\n\ncommit;\n';
    const stripped = stripOuterTransaction(sql, 'x.sql');

    expect(stripped).toContain('alter table t add column c text;');
    expect(stripped.toLowerCase()).not.toMatch(/^\s*begin;/m);
    expect(stripped.toLowerCase()).not.toMatch(/^\s*commit;/m);
  });

  it('leaves a file with no transaction block untouched', () => {
    const sql = '-- header\ncreate index if not exists i on t (c);\n';
    expect(stripOuterTransaction(sql, 'x.sql')).toBe(sql);
  });

  it('throws on an unbalanced begin/commit rather than guessing', () => {
    expect(() => stripOuterTransaction('begin;\nselect 1;\n', 'x.sql')).toThrow(MigrationSyntaxError);
    expect(() => stripOuterTransaction('select 1;\ncommit;\n', 'x.sql')).toThrow(MigrationSyntaxError);
  });

  it('ignores trailing comments when locating the closing commit', () => {
    const sql = 'begin;\nselect 1;\ncommit;\n-- trailing note\n';
    const stripped = stripOuterTransaction(sql, 'x.sql');
    expect(stripped.toLowerCase()).not.toContain('commit;');
    expect(stripped).toContain('select 1;');
  });

  it('does not mistake a mid-statement word ending in "commit" for the closing commit', () => {
    const sql = 'create table t (last_commit text);\n';
    expect(stripOuterTransaction(sql, 'x.sql')).toBe(sql);
  });
});

describe('readMigrationFiles', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cs-migrate-order-'));
    // Written in deliberately non-lexicographic order, and including a
    // non-.sql file that must be ignored.
    await writeFile(path.join(dir, '20260901000000__c.sql'), 'select 3;\n');
    await writeFile(path.join(dir, '20260101000000__a.sql'), 'select 1;\n');
    await writeFile(path.join(dir, '20260201000000__b.sql'), 'select 2;\n');
    await writeFile(path.join(dir, 'README.md'), 'not a migration\n');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sorts lexicographically by filename and ignores non-.sql files', async () => {
    const files = await readMigrationFiles(dir);
    expect(files.map((file) => file.filename)).toEqual([
      '20260101000000__a.sql',
      '20260201000000__b.sql',
      '20260901000000__c.sql',
    ]);
  });

  it('checksums file contents, so two files with different bodies differ', async () => {
    const files = await readMigrationFiles(dir);
    const checksums = new Set(files.map((file) => file.checksum));
    expect(checksums.size).toBe(files.length);
    expect(files[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('runMigrations', () => {
  it('applies every pending migration in lexicographic filename order', async () => {
    const db = fakeDb();
    const expected = (await readMigrationFiles()).map((file) => file.filename);

    const result = await runMigrations(db.pool);

    expect(expected.length).toBeGreaterThan(0);
    expect(result.applied).toEqual(expected);
    expect(result.skipped).toEqual([]);
    // The recorded order must match the applied order, not just the return value.
    expect(db.insertedFilenames()).toEqual(expected);
    // Sanity check the sort is genuinely ascending, independent of readdir order.
    expect([...expected].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(expected);
  });

  it('creates schema_migrations before reading it', async () => {
    const db = fakeDb();
    await runMigrations(db.pool);

    const texts = db.sqlTexts();
    const createIndex = texts.findIndex((sql) => sql.includes('create table if not exists schema_migrations'));
    const selectIndex = texts.findIndex((sql) => sql.startsWith('select filename, checksum from schema_migrations'));

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(selectIndex).toBeGreaterThan(createIndex);
  });

  it('wraps each file in its own transaction, with the schema_migrations insert inside it', async () => {
    const db = fakeDb();
    const files = await readMigrationFiles();

    await runMigrations(db.pool);

    const texts = db.sqlTexts();
    const begins = texts.filter((sql) => sql === 'begin');
    const commits = texts.filter((sql) => sql === 'commit');
    expect(begins).toHaveLength(files.length);
    expect(commits).toHaveLength(files.length);
    expect(texts.filter((sql) => sql === 'rollback')).toHaveLength(0);

    // For the first file: begin -> body -> insert -> commit, in that order.
    const firstBegin = texts.indexOf('begin');
    const firstInsert = texts.findIndex((sql) => sql.startsWith('insert into schema_migrations'));
    const firstCommit = texts.indexOf('commit');
    expect(firstBegin).toBeLessThan(firstInsert);
    expect(firstInsert).toBeLessThan(firstCommit);

    // The migration bodies sent to Postgres must not carry their own
    // begin/commit - nesting those would commit the runner's transaction
    // early and leave the insert outside it.
    const bodies = db.calls
      .map((call) => call.sql)
      .filter((sql) => sql.includes('--') && sql.length > 200);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body.toLowerCase()).not.toMatch(/^\s*begin;/m);
      expect(body.toLowerCase()).not.toMatch(/^\s*commit;/m);
    }
  });

  it('applies nothing on a second run (idempotent)', async () => {
    const files = await readMigrationFiles();
    const db = fakeDb({
      existing: files.map((file) => ({ filename: file.filename, checksum: file.checksum })),
    });

    const result = await runMigrations(db.pool);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(files.map((file) => file.filename));
    expect(db.insertedFilenames()).toEqual([]);
    expect(db.sqlTexts().filter((sql) => sql === 'begin')).toHaveLength(0);
  });

  it('applies only the files missing from schema_migrations', async () => {
    const files = await readMigrationFiles();
    const [first, ...rest] = files;
    expect(first).toBeDefined();

    const db = fakeDb({ existing: [{ filename: first!.filename, checksum: first!.checksum }] });
    const result = await runMigrations(db.pool);

    expect(result.skipped).toEqual([first!.filename]);
    expect(result.applied).toEqual(rest.map((file) => file.filename));
  });

  it('aborts naming the file when an already-applied migration was edited in place', async () => {
    const files = await readMigrationFiles();
    const drifted = files[1] ?? files[0];
    expect(drifted).toBeDefined();

    const db = fakeDb({
      existing: files.map((file) => ({
        filename: file.filename,
        checksum: file.filename === drifted!.filename ? 'deadbeef'.repeat(8) : file.checksum,
      })),
    });

    await expect(runMigrations(db.pool)).rejects.toBeInstanceOf(MigrationChecksumError);
    await expect(runMigrations(db.pool)).rejects.toThrow(drifted!.filename);
  });

  it('detects drift before applying anything, so a later pending file is not committed first', async () => {
    const files = await readMigrationFiles();
    expect(files.length).toBeGreaterThan(1);
    const last = files[files.length - 1];

    // First file drifted; the last file is still pending. Nothing may be
    // applied - the drift check has to run ahead of the apply loop.
    const db = fakeDb({
      existing: [{ filename: files[0]!.filename, checksum: 'f'.repeat(64) }],
    });

    await expect(runMigrations(db.pool)).rejects.toBeInstanceOf(MigrationChecksumError);
    expect(db.insertedFilenames()).toEqual([]);
    expect(db.sqlTexts()).not.toContain('begin');
    expect(last).toBeDefined();
  });

  it('tolerates a null recorded checksum instead of treating it as drift', async () => {
    const files = await readMigrationFiles();
    const db = fakeDb({
      existing: files.map((file) => ({ filename: file.filename, checksum: null })),
    });

    const result = await runMigrations(db.pool);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(files.map((file) => file.filename));
  });

  it('takes and releases the advisory lock around the run', async () => {
    const db = fakeDb();
    await runMigrations(db.pool);

    const texts = db.sqlTexts();
    const lockIndex = texts.findIndex((sql) => sql.includes("pg_advisory_lock(hashtext('control_service_migrations'))"));
    const unlockIndex = texts.findIndex((sql) =>
      sql.includes("pg_advisory_unlock(hashtext('control_service_migrations'))"),
    );

    expect(lockIndex).toBe(0);
    expect(unlockIndex).toBe(texts.length - 1);
    expect(db.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back the failing file, releases the lock and the client, and rethrows', async () => {
    const boom = new Error('syntax error at or near "alter"');
    const db = fakeDb({
      failOn: (sql) => (sql.includes('create table') && !sql.includes('schema_migrations') ? boom : null),
    });

    await expect(runMigrations(db.pool)).rejects.toThrow('syntax error');

    const texts = db.sqlTexts();
    expect(texts).toContain('rollback');
    // The lock must still be released - otherwise one bad migration wedges
    // every future deploy.
    expect(texts.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(db.release).toHaveBeenCalledTimes(1);
    // Nothing after the failure was attempted.
    expect(texts.filter((sql) => sql === 'commit')).toHaveLength(0);
  });
});
