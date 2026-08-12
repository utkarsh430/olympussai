/**
 * Ops account password hashing via bcryptjs.
 *
 * Node runtime only — never imported from Edge middleware.
 *
 * TWO KINDS OF ACCOUNT NOW LIVE IN ops_users. Accounts created before the
 * auth systems were collapsed carry a real bcrypt hash and sign in through
 * POST /api/ops/auth/login. Accounts created by accepting an invite since
 * then hold their password in Supabase Auth instead and carry the sentinel
 * below in `password_hash`, because the column is `not null` and the row must
 * still exist. `verifyPassword` refuses that sentinel explicitly, so the two
 * kinds can coexist through the cutover without the legacy login path ever
 * becoming a second, weaker door into a Supabase-managed account.
 */
import bcrypt from 'bcryptjs';

const COST_FACTOR = 12;

/** Minimum password length enforced when a person sets/accepts a password. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Stored in `ops_users.password_hash` for an account whose credential lives
 * in Supabase Auth. Not a hash and not derived from anything: it is a marker
 * that says "this account has no local password".
 *
 * It is deliberately not bcrypt-shaped. A bcrypt-shaped placeholder would be
 * a hash of *something*, and the only way to be sure nobody can ever present
 * that something is not to have one.
 */
export const SUPABASE_MANAGED_PASSWORD_HASH = 'supabase-managed:no-local-password';

/** True when this account's credential lives in Supabase Auth, not here. */
export function isSupabaseManagedPasswordHash(hash: string): boolean {
  return hash === SUPABASE_MANAGED_PASSWORD_HASH;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST_FACTOR);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Explicit, not incidental. bcrypt.compare against a non-bcrypt string
  // already returns false (or throws into the catch below), but relying on
  // that would make "Supabase-managed accounts cannot use the legacy login"
  // a property of bcryptjs's error handling rather than a property of this
  // app. Someone hardening the catch could delete the guarantee by accident.
  if (isSupabaseManagedPasswordHash(hash)) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
