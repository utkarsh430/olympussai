/**
 * PIN verification via bcryptjs.
 *
 * Node runtime only — bcryptjs is not imported from Edge middleware. The raw
 * PIN is compared against PROJECT_PIN_HASH; the plaintext PIN never appears in
 * source, only the hash lives in the environment.
 */
import bcrypt from 'bcryptjs';

/** Constant-time-ish bcrypt comparison of a candidate PIN against the hash. */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pin, hash);
  } catch {
    return false;
  }
}
