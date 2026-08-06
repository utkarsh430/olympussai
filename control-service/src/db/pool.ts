// Single shared pg Pool for this service's own datastore
// (CONTROL_SERVICE_DATABASE_URL). Never the web app's Supabase connection -
// the two datastores are intentionally isolated
// (docs/CONTROL_SERVICE_INTEGRATION.md section 3).
import { Pool } from 'pg';
import { loadEnv } from '../config/env.js';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;
  const env = loadEnv();
  pool = new Pool({
    connectionString: env.CONTROL_SERVICE_DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Bounds any single query so a slow/hung statement can't block a
    // request indefinitely (integration contract section 2, "handler-level
    // timeout so a slow downstream effect cannot hang the request").
    statement_timeout: 10_000,
  });
  return pool;
}

/** Liveness/readiness DB round-trip. Cheap, no table access. */
export async function pingDb(): Promise<void> {
  await getPool().query('select 1');
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
