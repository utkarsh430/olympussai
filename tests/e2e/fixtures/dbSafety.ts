/**
 * Thin re-export of scripts/lib/disposable-db.mjs for the e2e suites below,
 * which connect DIRECTLY to CONTROL_SERVICE_DATABASE_URL / OPS_DATABASE_URL
 * over `pg` for their own fixture setup (see each spec's file header)
 * rather than going through the running apps.
 *
 * That direct connection is exactly where a stray environment variable —
 * this repo's live control-service or ops database instead of a throwaway
 * CI container — starts writing fixtures into, and (per
 * ops-dashboard-pages.spec.ts) DISABLING real accounts in. See
 * scripts/lib/disposable-db.mjs for what "disposable" means and why this
 * checks content rather than trusting an env var.
 */
export {
  assertDisposableOpsDatabase,
  assertDisposableControlServiceDatabase,
} from '../../../scripts/lib/disposable-db.mjs';
