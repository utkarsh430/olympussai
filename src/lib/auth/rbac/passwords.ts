/**
 * Ops account password hashing via bcryptjs.
 *
 * Node runtime only — never imported from Edge middleware, mirrors
 * src/lib/auth/password.ts. Distinct from the PIN's verifyPin(): ops accounts
 * hash a full password chosen by the person accepting the invite, not a
 * shared numeric PIN.
 */
import bcrypt from 'bcryptjs';

const COST_FACTOR = 12;

/** Minimum password length enforced when a person sets/accepts a password. */
export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST_FACTOR);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
