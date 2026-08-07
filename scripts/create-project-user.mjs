#!/usr/bin/env node
/**
 * Provision an enterprise login account (Supabase Auth) for the UPSRTC
 * project surface at /login.
 *
 * There is no self-service sign-up — every account is created by an admin
 * running this script (or directly in the Supabase dashboard), per this
 * ticket's "admin-provisioned only" requirement. Mirrors the existing
 * `scripts/seed-ops-admin.mjs` pattern for the separate ops RBAC system: the
 * password is read from stdin with echo disabled, never as an argv, so it
 * never lands in shell history or `ps`.
 *
 *   SUPABASE_URL=https://xyz.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/create-project-user.mjs --email you@example.com
 *
 * Falls back to NEXT_PUBLIC_SUPABASE_URL if SUPABASE_URL is unset, so the
 * same .env.local used by `pnpm dev` works without duplicating the URL.
 */
import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';

const MIN_PASSWORD_LENGTH = 12;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') args.email = argv[++i];
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
      if (!answer || answer.length < MIN_PASSWORD_LENGTH) {
        reject(new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`));
        return;
      }
      resolve(answer);
    });
  });
}

async function main() {
  const { email } = parseArgs(process.argv.slice(2));
  if (!email) {
    process.stderr.write(
      'Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-project-user.mjs --email you@example.com\n',
    );
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    process.stderr.write('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set.\n');
    process.exit(1);
  }
  if (!serviceRoleKey) {
    process.stderr.write('SUPABASE_SERVICE_ROLE_KEY is not set.\n');
    process.exit(1);
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const password = await readPasswordFromStdin(
    `Choose a password for ${email} (input hidden): `,
  );

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  process.stdout.write(`Created project user ${email} (id ${data.user.id}).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message ?? error}\n`);
  process.exit(1);
});
