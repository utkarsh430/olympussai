#!/usr/bin/env node
/**
 * Remove the Supabase Auth identities a CI run created, and prove they are
 * gone.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   QA_IDENTITY_SCOPE=<run-id>-<attempt> \
 *     node scripts/qa-identity-teardown.mjs
 *
 * WHAT IT CAN AND CANNOT TOUCH. Everything here goes through
 * scripts/lib/qa-identity.mjs, which takes no address from a caller: it lists
 * the directory, keeps only `*.qa@example.test`, and re-asserts each record
 * before deleting it. This script therefore has no argument, environment
 * variable or code path that could aim it at a real account. Read that
 * module's header before changing anything here.
 *
 * `QA_IDENTITY_SCOPE` NARROWS, IT DOES NOT WIDEN. With it, only this run's
 * own identities are removed, so a teardown cannot delete a concurrently
 * running job's fixtures. Without it every QA identity in the namespace goes,
 * which is what a manual "clean the directory" run wants.
 *
 * THE STALE SWEEP is what keeps the directory from filling up with logins
 * from runs that were cancelled before their teardown could run (which
 * `cancel-in-progress` makes routine). It only ever considers identities
 * inside the namespace that are older than `QA_IDENTITY_STALE_HOURS`,
 * defaulting to a value comfortably longer than the workflow's own timeout so
 * it can never reap a job that is still going.
 *
 * EXIT CODE. Non-zero if anything it tried to delete is still there
 * afterwards. A teardown that reports success while leaving accounts behind
 * is worse than one that fails: the next run collides with the leftovers and
 * the reason is three jobs away.
 */
import { createClient } from '@supabase/supabase-js';
import { removeQaIdentities } from './lib/qa-identity.mjs';

const DEFAULT_STALE_HOURS = 6;

function requireEnv(name, ...fallbacks) {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  process.stderr.write(`${name} is not set.\n`);
  process.exit(1);
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const scope = process.env.QA_IDENTITY_SCOPE?.trim() || null;
  const staleHours = Number(process.env.QA_IDENTITY_STALE_HOURS ?? DEFAULT_STALE_HOURS);

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const mine = await removeQaIdentities(admin, scope ? { scope } : {});
  report(scope ? `this run (${scope})` : 'the whole QA namespace', mine);

  // Leftovers from cancelled runs. Deliberately a second, separate pass: the
  // run's own identities must be removed even if the stale sweep is disabled
  // or fails.
  let stale = { deleted: [], failed: [], remaining: [] };
  if (scope && Number.isFinite(staleHours) && staleHours > 0) {
    stale = await removeQaIdentities(admin, { olderThanMs: staleHours * 60 * 60 * 1000 });
    report(`stale QA identities older than ${staleHours}h`, stale);
  }

  const leftBehind = [...mine.remaining, ...stale.remaining];
  if (leftBehind.length > 0) {
    process.stderr.write(
      `Teardown could not remove ${leftBehind.length} QA identity/identities: ` +
        `${leftBehind.join(', ')}. The next run will collide with them.\n`,
    );
    process.exit(1);
  }
}

function report(what, result) {
  process.stdout.write(
    `${what}: deleted ${result.deleted.length}` +
      (result.deleted.length ? ` (${result.deleted.join(', ')})` : '') +
      (result.failed.length ? `, ${result.failed.length} failed` : '') +
      `, ${result.remaining.length} still present\n`,
  );
  for (const failure of result.failed) {
    process.stderr.write(`  could not delete ${failure.email}: ${failure.reason}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message ?? error}\n`);
  process.exit(1);
});
