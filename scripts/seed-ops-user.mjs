#!/usr/bin/env node
/**
 * Seed (or re-point) a single non-admin ops account directly.
 *
 * Sibling of scripts/seed-ops-admin.mjs, which exists because the very first
 * admin has no inviter. This one exists for the other case the invite flow
 * cannot serve: AUTOMATION. tests/e2e/pilot-driver-command.spec.ts needs a
 * `pilot_driver` account to log in as (see that file's header), and CI has no
 * mailbox to receive an invite in and no admin session to issue one from.
 *
 *   OPS_DATABASE_URL=postgres://... OPS_SEED_PASSWORD=... \
 *     node scripts/seed-ops-user.mjs --email pilot.driver.qa@example.test \
 *       --name "QA Pilot Driver" --role pilot_driver
 *
 * Deliberate limits, so this never becomes a back door around
 * "admin-invite only" (docs/olympuss/RBAC.md):
 *
 *   * `admin` is REFUSED. The only supported way to create an admin is
 *     seed-ops-admin.mjs (which itself refuses once one exists) or an invite
 *     from an existing admin. This script cannot mint privilege.
 *   * The password never comes from argv — it is read from OPS_SEED_PASSWORD
 *     or, when a TTY is attached, prompted for with echo disabled. An argv
 *     password would land in shell history and in `ps` output.
 *   * Idempotent by email: re-running updates the existing row's password,
 *     name and role instead of failing, so a CI job that re-runs against a
 *     warm database behaves the same as against an empty one.
 *
 * THE SIGN-IN IDENTITY. With `NEXT_PUBLIC_SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` set, this also provisions the Supabase Auth
 * account the row signs in with and links it — which is what lets CI drive
 * `/login`, the single front door, instead of the legacy password endpoint.
 * With neither set it behaves exactly as it always has. That path is confined
 * to the `*.qa@example.test` namespace and REFUSES anything else; see
 * scripts/lib/qa-identity.mjs for why that refusal is in code rather than in
 * a convention.
 *
 * The bcrypt hash is still written either way. It costs nothing, and it keeps
 * the legacy door usable for these accounts for as long as the legacy door
 * exists — which is the point of a fallback.
 */
import bcrypt from 'bcryptjs';
import pg from 'pg';
import readline from 'node:readline';
import { assertDisposableOpsDatabase } from './lib/disposable-db.mjs';
import { identitySeedingEnabled, seedOpsIdentity } from './lib/qa-identity-seed.mjs';

const COST_FACTOR = 12;
const MIN_PASSWORD_LENGTH = 12;

// Mirrors db/migrations/20260806170000__ops_pilot_driver_role.sql's
// ops_users_role_check, minus `admin` (see the header).
const ALLOWED_ROLES = ['driver', 'pilot_driver', 'dispatcher', 'depot', 'control_room', 'planner'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') args.email = argv[++i];
    if (argv[i] === '--name') args.name = argv[++i];
    if (argv[i] === '--role') args.role = argv[++i];
  }
  return args;
}

function readPasswordFromStdin(prompt) {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    const rl = readline.createInterface({ input: process.stdin, terminal: true });
    // @ts-ignore — Node's readline internals; muting echo for a password prompt.
    rl._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function resolvePassword() {
  const fromEnv = process.env.OPS_SEED_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    throw new Error('Set OPS_SEED_PASSWORD (no TTY available to prompt on).');
  }
  return readPasswordFromStdin('Choose a password for this account (input hidden): ');
}

async function main() {
  const { email, name, role } = parseArgs(process.argv.slice(2));
  if (!email || !name || !role) {
    process.stderr.write(
      'Usage: OPS_DATABASE_URL=... OPS_SEED_PASSWORD=... node scripts/seed-ops-user.mjs ' +
        '--email you@example.com --name "Your Name" --role pilot_driver\n',
    );
    process.exit(1);
  }

  if (role === 'admin') {
    process.stderr.write(
      'Refusing to seed an admin here — use scripts/seed-ops-admin.mjs (first admin only) or an admin invite.\n',
    );
    process.exit(1);
  }

  if (!ALLOWED_ROLES.includes(role)) {
    process.stderr.write(`Unknown role "${role}". Expected one of: ${ALLOWED_ROLES.join(', ')}.\n`);
    process.exit(1);
  }

  const connectionString = process.env.OPS_DATABASE_URL;
  if (!connectionString) {
    process.stderr.write('OPS_DATABASE_URL is not set.\n');
    process.exit(1);
  }

  // Before any write, including the password prompt below — this is a CI/
  // automation-only script (real ops accounts come from an admin invite),
  // so a database that already holds real-looking accounts is never a
  // legitimate target for it. See scripts/lib/disposable-db.mjs.
  await assertDisposableOpsDatabase(connectionString);

  const password = await resolvePassword();
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    process.stderr.write(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.\n`);
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });

  try {
    // Before the database write. A refused or failed identity must leave no
    // ops row behind claiming to be seeded: an account that exists and cannot
    // sign in fails much later, somewhere that says nothing about why.
    const supabaseUserId = await seedOpsIdentity({ email, password, role });

    const passwordHash = await bcrypt.hash(password, COST_FACTOR);
    const result = await pool.query(
      `insert into ops_users (email, name, role, password_hash, status, supabase_user_id)
       values ($1, $2, $3, $4, 'active', $5)
       on conflict (email) do update
         set name = excluded.name,
             role = excluded.role,
             password_hash = excluded.password_hash,
             status = 'active',
             disabled_at = null,
             disabled_by = null,
             -- coalesce, not overwrite: a run with no service-role key must
             -- not unlink a row an earlier run linked.
             supabase_user_id = coalesce(excluded.supabase_user_id, ops_users.supabase_user_id),
             updated_at = now()
       returning id`,
      [email, name, role, passwordHash, supabaseUserId],
    );

    process.stdout.write(
      `Seeded ${role} ${email} (id ${result.rows[0].id})` +
        `${supabaseUserId ? ', linked to a Supabase sign-in identity' : ''}.\n`,
    );
    if (!supabaseUserId && !identitySeedingEnabled()) {
      process.stdout.write(
        '  No Supabase configuration in this environment — this account can only use the legacy ops sign-in.\n',
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message ?? error}\n`);
  process.exit(1);
});
