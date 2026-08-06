/**
 * Connection pool for this app's OWN Postgres datastore (db/migrations/).
 *
 * Node runtime only — `pg` opens raw TCP sockets and is never imported from
 * Edge middleware (mirrors the existing bcrypt/next-headers Node-only rule in
 * src/lib/auth/*). This is a completely separate database from the control
 * service's Postgres/PostGIS store: this app never holds write credentials to
 * that one (docs/CONTROL_SERVICE_INTEGRATION.md §3, control-service/README.md).
 */
import 'server-only';
import { Pool } from 'pg';

/** Thrown when OPS_DATABASE_URL is missing so every caller fails closed. */
export class OpsDbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsDbConfigError';
  }
}

let pool: Pool | null = null;

/**
 * Lazily create (once per process) and return the ops datastore pool. Throws
 * OpsDbConfigError if OPS_DATABASE_URL is unset — callers must let this
 * propagate to a 503, never silently skip the audit/persistence step.
 */
export function getOpsPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.OPS_DATABASE_URL;
  if (!connectionString || !connectionString.trim()) {
    throw new OpsDbConfigError('OPS_DATABASE_URL is not configured');
  }

  pool = new Pool({
    connectionString,
    // Fits inside the existing 15s poll / 10s upstream timeout envelope
    // (docs/CONTROL_SERVICE_INTEGRATION.md §2) — an ops write must never hang
    // a request indefinitely.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 8_000,
    max: 10,
  });

  return pool;
}
