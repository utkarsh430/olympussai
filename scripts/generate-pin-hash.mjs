#!/usr/bin/env node
/**
 * Generate a bcrypt hash for a project PIN.
 *
 *   npm run generate-pin-hash -- <pin>
 *
 * Prints ONLY the hash to stdout so it can be captured into an environment
 * variable. The raw PIN is read from argv and never stored or logged. Use the
 * output as PROJECT_PIN_HASH in an uncommitted .env.local (or your host's
 * environment settings) — never commit the raw PIN or the hash to Git.
 */
import bcrypt from 'bcryptjs';

const COST_FACTOR = 12;

const pin = process.argv[2];

if (!pin || !pin.trim()) {
  process.stderr.write('Usage: npm run generate-pin-hash -- <pin>\n');
  process.exit(1);
}

const hash = bcrypt.hashSync(String(pin), COST_FACTOR);

// Bcrypt hashes contain '$' separators. In a local .env.local the dotenv
// loader (dotenv-expand) treats '$' as variable expansion and will corrupt the
// value — escape each '$' as '\$' there. Host env UIs (e.g. Vercel) store the
// value literally, so paste the hash unescaped in those. Note goes to stderr so
// stdout stays a clean, pipeable hash.
process.stderr.write(
  'Note: in .env.local, escape every "$" in this hash as "\\$" (dotenv expands $).\n' +
    '      In host env settings (Vercel etc.) paste it unescaped.\n',
);
process.stdout.write(`${hash}\n`);
