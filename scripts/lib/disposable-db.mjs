/**
 * Refuses to let CI/automation write fixtures into a database that is not
 * genuinely disposable, for the two datastores this repo's CI workflow
 * provisions throwaway containers for: OPS_DATABASE_URL (db/migrations/)
 * and CONTROL_SERVICE_DATABASE_URL (control-service/db/migrations/).
 *
 * ─── WHY THIS MODULE EXISTS ──────────────────────────────────────────────
 *
 * .github/workflows/ci-web.yml points its throwaway service containers at
 * fixed ports (55432 / 55433 at the time this was written). Those ports are
 * only a GitHub-runner convention — on a machine that ALSO runs this
 * project's real datastores on the same ports (a developer's or an agent's
 * own box, running the live control-service + ops app locally), the exact
 * same env vars this workflow sets point at REAL data instead. Nothing
 * stops a copy-pasted command, `act`, or a future agent from doing exactly
 * that; one already did, on this repo, the same day this module was
 * written.
 *
 * Moving the ports is necessary but not sufficient — a port is a
 * convention, and the next collision (a differently-numbered local
 * instance, a renumbered CI service, `act` reusing a host port) is only a
 * matter of time. This module is the guard a wrong port number cannot get
 * past: it inspects what is actually IN the database before anything
 * writes to it, and refuses if it looks real.
 *
 * ─── WHY NOT (JUST) AN OPT-IN ENV VAR ────────────────────────────────────
 *
 * An env var CI sets (`CI=true`, a bespoke `ALLOW_FIXTURE_WRITES=1`, ...) was
 * considered and rejected as the primary guard. The whole failure mode this
 * exists to prevent is someone sourcing the CI job's env and running its
 * commands locally — which reproduces every env var the job sets, including
 * any "CI says this is safe" flag, right along with the dangerous ports. A
 * flag that travels with the copy-paste is not a guard against the
 * copy-paste. Inspecting the target's actual CONTENT does not have that
 * hole: a genuinely fresh, disposable database always passes (it has
 * nothing real in it to find), and a genuinely live one always fails,
 * regardless of which env vars happen to be set. No opt-out is provided —
 * see scripts/lib/qa-identity.mjs for the same posture applied to Supabase
 * Auth: refuse rather than trust a flag.
 *
 * ─── WHAT "DISPOSABLE" MEANS FOR EACH DATASTORE ──────────────────────────
 *
 *   ops:             every row in `ops_users` is inside the QA identity
 *                     namespace (scripts/lib/qa-identity.mjs's
 *                     *.qa@example.test), OR the table does not exist yet
 *                     (a database before its first migration).
 *   control-service: at most a handful of active route-directions carry a
 *                     route_shape (see MAX_DISPOSABLE_ROUTE_DIRECTIONS_WITH_SHAPE),
 *                     OR the tables do not exist yet. "Handful" rather than
 *                     zero because a future test fixture may legitimately
 *                     seed one or two; the real network this guards against
 *                     runs in the hundreds (759 route-directions the day
 *                     this was written) — see control-service/src/db/rehydrate.ts's
 *                     NetworkCounts, the same signal /readyz gates on.
 *
 * ─── WHAT THIS MODULE DELIBERATELY DOES NOT GUARD ────────────────────────
 *
 * Schema migrations (scripts/migrate-ops.mjs, control-service/src/db/migrate.ts)
 * are NOT guarded here. Unlike seeding, applying migrations is a normal part
 * of a REAL production deploy — control-service/render.yaml runs
 * `node dist/db/migrate.js` as `preDeployCommand` against the live database
 * on every deploy, and db/README.md documents `pnpm migrate:ops` the same
 * way for the ops side. Migrations are also already idempotent and
 * checksum-verified by design (one transaction per file, drift on an
 * already-applied file aborts the run). Gating that path on "looks
 * disposable" would break every real deploy; the actual danger this module
 * exists for is fixture SEEDING and TEST WRITES, which have no legitimate
 * reason to ever touch a live database.
 */
import pg from 'pg';
import { isQaIdentityEmail } from './qa-identity.mjs';

/** Thrown instead of returning a value, so a caller that ignores the result still cannot proceed. */
export class NotDisposableDatabaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotDisposableDatabaseError';
  }
}

/** Postgres SQLSTATE for "relation does not exist" — a database before its migrations have run. */
const UNDEFINED_TABLE = '42P01';

/** host:port/dbname only — never credentials — for use in a refusal message. */
function describeTarget(connectionString) {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return '(connection string could not be parsed)';
  }
}

/** `a***@realcompany.com` — enough to be convincing in a log line, not a PII dump. */
function maskEmail(email) {
  const at = String(email).indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

async function withClient(connectionString, fn) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 8_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Refuse unless every `ops_users` row is inside the QA identity namespace
 * (or the table does not exist yet). Called before any script or test
 * writes an ops fixture — see this module's header for which callers.
 *
 * @param {string} connectionString OPS_DATABASE_URL.
 */
export async function assertDisposableOpsDatabase(connectionString) {
  if (!connectionString || !connectionString.trim()) {
    throw new Error('assertDisposableOpsDatabase: no connection string given.');
  }
  const target = describeTarget(connectionString);

  await withClient(connectionString, async (client) => {
    let rows;
    try {
      ({ rows } = await client.query('select email from ops_users'));
    } catch (error) {
      if (error?.code === UNDEFINED_TABLE) return; // fresh database, nothing to protect yet
      throw error;
    }

    const strays = rows.map((row) => row.email).filter((email) => !isQaIdentityEmail(email));
    if (strays.length === 0) return;

    const sample = strays.slice(0, 3).map(maskEmail).join(', ');
    throw new NotDisposableDatabaseError(
      `Refusing to write ops fixtures into ${target}: found ${strays.length} ops_users row(s) ` +
        `outside the QA identity namespace (*.qa@example.test) — e.g. ${sample}` +
        `${strays.length > 3 ? ', …' : ''}. This looks like a real database, not one created fresh ` +
        'for this run. If this genuinely is a disposable database, every row it contains must ' +
        'already be inside the QA namespace before fixtures are written to it — real accounts are ' +
        'provisioned by an admin invite, never by automation.',
    );
  });
}

/**
 * A throwaway CI database seeds at most a handful of route-directions with
 * a shape directly (today, none — see tests/e2e/fixtures/controlServiceFixtures.ts's
 * seedGatedRouteDirection, which never inserts a route_shapes row at all).
 * The real network this guards against is two to three orders of magnitude
 * larger. Named and exported so raising it later is a deliberate, reviewed
 * decision rather than a quiet edit.
 */
export const MAX_DISPOSABLE_ROUTE_DIRECTIONS_WITH_SHAPE = 5;

/**
 * Refuse unless the control-service database has no non-trivial seeded
 * network (or its tables do not exist yet). Mirrors the exact "network
 * counts" signal control-service/src/db/rehydrate.ts computes for /readyz,
 * so this guard and that readiness gate agree on what "seeded" means.
 *
 * @param {string} connectionString CONTROL_SERVICE_DATABASE_URL.
 */
export async function assertDisposableControlServiceDatabase(connectionString) {
  if (!connectionString || !connectionString.trim()) {
    throw new Error('assertDisposableControlServiceDatabase: no connection string given.');
  }
  const target = describeTarget(connectionString);

  await withClient(connectionString, async (client) => {
    let rows;
    try {
      ({ rows } = await client.query(
        `select count(*)::int as n
           from route_directions rd
           join route_shapes rs on rs.route_direction_id = rd.id
          where rd.is_active`,
      ));
    } catch (error) {
      if (error?.code === UNDEFINED_TABLE) return; // fresh database, nothing to protect yet
      throw error;
    }

    const count = rows[0]?.n ?? 0;
    if (count > MAX_DISPOSABLE_ROUTE_DIRECTIONS_WITH_SHAPE) {
      throw new NotDisposableDatabaseError(
        `Refusing to write control-service fixtures into ${target}: it already has ${count} active ` +
          `route-direction(s) carrying a route_shape — more than the ` +
          `${MAX_DISPOSABLE_ROUTE_DIRECTIONS_WITH_SHAPE} a throwaway CI database should ever have. ` +
          'This looks like a real seeded network, not one created fresh for this run.',
      );
    }
  });
}
