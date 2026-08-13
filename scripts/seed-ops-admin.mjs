#!/usr/bin/env node
/**
 * Seed the first ops admin account.
 *
 * Every ops_users row after the first is created by accepting an admin
 * invite (POST /api/ops/auth/accept-invite) — there is no self-service
 * signup, per this ticket's "admin-invite only" acceptance criterion. The
 * very first admin has no inviter, so it is created directly here.
 *
 *   OPS_DATABASE_URL=postgres://... node scripts/seed-ops-admin.mjs \
 *     --email you@example.com --name "Your Name"
 *
 * Refuses to run if an active admin already exists. The password is read
 * from stdin with echo disabled (never as an argv, so it never lands in
 * shell history or `ps`), which also makes it pipeable:
 *
 *   printf '%s\n' "$ADMIN_PASSWORD" | node scripts/seed-ops-admin.mjs ...
 *
 * A pipe that ends without ever delivering a line is an ERROR, not an empty
 * password. It used to be neither: readline simply never called back, `main`
 * fell off the end of the event loop, and the process exited 0 having created
 * nothing. A seeding step that reports success and seeds no admin is the
 * worst of the three possible outcomes — CI goes green, and the failure
 * surfaces later as an unrelated sign-in error.
 *
 * THE SIGN-IN IDENTITY. With `NEXT_PUBLIC_SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` set, this also provisions the Supabase Auth
 * account the admin signs in with and links it, so CI can drive `/login`
 * rather than the legacy password endpoint. That path is confined to the
 * `*.qa@example.test` namespace and refuses anything else — see
 * scripts/lib/qa-identity.mjs. Seeding a REAL first admin still works
 * unchanged; it simply gets no Supabase identity from here, which is correct:
 * a real administrator's login is created deliberately, not by a script that
 * a pull request can run.
 */
import bcrypt from 'bcryptjs';
import pg from 'pg';
import readline from 'node:readline';
import { identitySeedingEnabled, seedOpsIdentity } from './lib/qa-identity-seed.mjs';
import { isQaIdentityEmail } from './lib/qa-identity.mjs';

const COST_FACTOR = 12;
const MIN_PASSWORD_LENGTH = 12;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') args.email = argv[++i];
    if (argv[i] === '--name') args.name = argv[++i];
  }
  return args;
}

function readPasswordFromStdin(prompt) {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    const rl = readline.createInterface({ input: process.stdin, terminal: true });
    // @ts-ignore — Node's readline internals; muting echo for a password prompt.
    rl._writeToOutput = () => {};

    let answered = false;
    const finish = (answer) => {
      if (answered) return;
      answered = true;
      rl.close();
      process.stdout.write('\n');
      if (!answer || answer.length < MIN_PASSWORD_LENGTH) {
        reject(new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`));
        return;
      }
      resolve(answer);
    };

    rl.question('', finish);
    // stdin ended without a line. An interactive Ctrl-D and a pipe whose last
    // byte is not a newline both land here; both mean "no password was given",
    // and both must stop the run rather than let it exit successfully having
    // done nothing.
    rl.on('close', () => finish(''));
  });
}

async function main() {
  const { email, name } = parseArgs(process.argv.slice(2));
  if (!email || !name) {
    process.stderr.write(
      'Usage: OPS_DATABASE_URL=... node scripts/seed-ops-admin.mjs --email you@example.com --name "Your Name"\n',
    );
    process.exit(1);
  }

  const connectionString = process.env.OPS_DATABASE_URL;
  if (!connectionString) {
    process.stderr.write('OPS_DATABASE_URL is not set.\n');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });

  try {
    const existing = await pool.query(
      "select count(*)::int as n from ops_users where role = 'admin' and status = 'active'",
    );
    if ((existing.rows[0]?.n ?? 0) > 0) {
      process.stderr.write('An active admin already exists. Refusing to seed another via this script — use an admin invite instead.\n');
      process.exit(1);
    }

    const password = await readPasswordFromStdin('Choose a password for this admin (input hidden): ');

    // Only for a QA address. A real first admin keeps the original behaviour
    // (bcrypt row, no identity) rather than being refused outright — this
    // script is still the supported way to bootstrap a real deployment, and
    // that bootstrap must not start depending on a service-role key.
    const supabaseUserId =
      identitySeedingEnabled() && isQaIdentityEmail(email)
        ? await seedOpsIdentity({ email, password, role: 'admin' })
        : null;

    const passwordHash = await bcrypt.hash(password, COST_FACTOR);

    const result = await pool.query(
      `insert into ops_users (email, name, role, password_hash, status, supabase_user_id)
       values ($1, $2, 'admin', $3, 'active', $4)
       returning id`,
      [email, name, passwordHash, supabaseUserId],
    );

    process.stdout.write(
      `Seeded admin ${email} (id ${result.rows[0].id})` +
        `${supabaseUserId ? ', linked to a Supabase sign-in identity' : ''}.\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message ?? error}\n`);
  process.exit(1);
});
