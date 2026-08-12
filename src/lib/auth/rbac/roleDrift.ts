/**
 * Detect ops profiles whose database role disagrees with the role baked into
 * their Supabase tokens.
 *
 * WHY THIS EXISTS. A role now lives in two stores that are written together
 * (POST /api/ops/admin/users/:id/role) but can still fall apart afterwards
 * through paths this app does not control: someone editing `app_metadata` in
 * the Supabase dashboard, a user deleted there but not here, or a row changed
 * by hand with psql. `resolveOpsSession()` refuses a session whose claim
 * disagrees with the database, so divergence is never an escalation — it is a
 * lockout, and a silent one, presenting to the operator as "I sign in and it
 * immediately says my session is out of date". That symptom is almost
 * impossible to diagnose from the outside and trivial to diagnose from here.
 *
 * WHAT IT READS. `app_metadata` as stored, not a token — so it reports what
 * the NEXT token will carry. A user's current token can still be stale for up
 * to one access-token lifetime after a repair; that is expected and is not
 * drift.
 *
 * WHAT IT IS NOT. Read-only, and deliberately so. It names the accounts and
 * the disagreement; repairing one is an audited admin action
 * (POST /api/ops/admin/users/:id/role with the role the database already
 * holds re-pushes the claim). A checker that silently repaired would decide
 * which of the two stores was right — and the whole reason a mismatch is
 * refused rather than resolved is that neither is knowable from here.
 */
import 'server-only';
import { getOpsRepo, type OpsUserRecord } from './repo';
import { OpsIdentityError, readOpsRoleClaim } from './opsIdentity';
import type { OpsRole } from './roles';

export type OpsRoleDriftKind =
  /**
   * Active, linked, and the token carries no ops role at all. The database
   * still decides the role, so API routes and pages work — but Edge
   * middleware has no ceiling to check, so the ops surface is unreachable
   * through the Supabase front door. The normal state of every account that
   * has not been backfilled yet.
   */
  | 'claim_missing'
  /** The claim names a different role than the database. Every request is refused. */
  | 'claim_stale'
  /**
   * The account is disabled but its identity still carries an ops role.
   * Not an access path — `ops_users.status` is checked first and refuses it —
   * but a leftover that should not be there, and evidence that a disable did
   * not finish clearing the token side.
   */
  | 'claim_lingering'
  /** `supabase_user_id` points at a Supabase user that no longer exists. Cannot sign in. */
  | 'identity_missing'
  /** Supabase Auth could not be read for this account. Unknown, not clean. */
  | 'unreadable';

export interface OpsRoleDrift {
  opsUserId: string;
  email: string;
  supabaseUserId: string;
  databaseRole: OpsRole;
  databaseStatus: OpsUserRecord['status'];
  /** The role in `app_metadata`, or null when it carries none / could not be read. */
  claimRole: OpsRole | null;
  kind: OpsRoleDriftKind;
  /** Present only for `unreadable`, naming what Supabase Auth said. */
  detail?: string;
}

export interface OpsRoleDriftReport {
  checkedAt: string;
  /** Every ops profile, linked or not. */
  totalUsers: number;
  /** Profiles bound to a Supabase identity — the only ones that can drift. */
  linkedUsers: number;
  /**
   * Profiles with no Supabase identity yet. Not drift: they carry no claim
   * because they have nowhere to carry one. Counted so a report of "0 drift"
   * cannot be mistaken for "everything is linked".
   */
  unlinkedUsers: number;
  drift: OpsRoleDrift[];
}

/**
 * How many identities to read at once. Supabase Auth rate-limits the admin
 * API, and this runs against every linked account; a small window keeps a
 * routine check from looking like an attack while still finishing quickly on
 * a roster this size.
 */
const READ_CONCURRENCY = 5;

export async function findOpsRoleDrift(): Promise<OpsRoleDriftReport> {
  const users = await getOpsRepo().listUsers();
  const linked = users.filter(
    (user): user is OpsUserRecord & { supabaseUserId: string } => user.supabaseUserId !== null,
  );

  const drift: OpsRoleDrift[] = [];
  for (let start = 0; start < linked.length; start += READ_CONCURRENCY) {
    const window = linked.slice(start, start + READ_CONCURRENCY);
    const results = await Promise.all(window.map((user) => inspect(user)));
    for (const result of results) {
      if (result) drift.push(result);
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    totalUsers: users.length,
    linkedUsers: linked.length,
    unlinkedUsers: users.length - linked.length,
    drift,
  };
}

async function inspect(
  user: OpsUserRecord & { supabaseUserId: string },
): Promise<OpsRoleDrift | null> {
  const base = {
    opsUserId: user.id,
    email: user.email,
    supabaseUserId: user.supabaseUserId,
    databaseRole: user.role,
    databaseStatus: user.status,
  };

  let claimRole: OpsRole | null;
  try {
    claimRole = await readOpsRoleClaim(user.supabaseUserId);
  } catch (error) {
    if (error instanceof OpsIdentityError && error.failure === 'identity_not_found') {
      return { ...base, claimRole: null, kind: 'identity_missing' };
    }
    // An account that could not be checked is reported as unknown, never
    // omitted. Omitting it would let an outage read as a clean bill of health.
    return {
      ...base,
      claimRole: null,
      kind: 'unreadable',
      detail: error instanceof Error ? error.message : 'Unknown error.',
    };
  }

  if (user.status !== 'active') {
    return claimRole === null ? null : { ...base, claimRole, kind: 'claim_lingering' };
  }
  if (claimRole === null) {
    return { ...base, claimRole, kind: 'claim_missing' };
  }
  if (claimRole !== user.role) {
    return { ...base, claimRole, kind: 'claim_stale' };
  }
  return null;
}
