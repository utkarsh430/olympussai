/**
 * Invite token generation/hashing.
 *
 * Node runtime only (node:crypto). The raw token is returned to the caller
 * exactly once (for the admin to share out of band — see ../../../../db/README.md
 * on email delivery not being wired up yet) and is NEVER persisted; only its
 * SHA-256 digest is stored in ops_invites.token_hash, so a database read
 * alone can never be used to accept someone else's invite.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

/** Generate a fresh, high-entropy invite token (URL-safe base64). */
export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests, to avoid timing side-channels. */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
