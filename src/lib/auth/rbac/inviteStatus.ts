/**
 * Pure invite-status derivation — deliberately dependency-free (no
 * `server-only`, no db/pool import) so it is unit-testable without a
 * database, same reasoning as session.ts/config.ts (see repo.ts's own
 * comment on why the DB-backed repo stays separate from the branching
 * logic it's built on).
 */

export type OpsInviteStatus = 'pending' | 'expired' | 'accepted' | 'revoked';

export interface InviteStatusInput {
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

/** Derives the display status of an invite from its timestamps. */
export function deriveInviteStatus(invite: InviteStatusInput): OpsInviteStatus {
  if (invite.acceptedAt) return 'accepted';
  if (invite.revokedAt) return 'revoked';
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'pending';
}
