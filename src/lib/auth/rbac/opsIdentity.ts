/**
 * The Supabase half of an ops account: provisioning a sign-in identity, and
 * writing / clearing / reading the `app_metadata.ops_role` claim.
 *
 * This module is the ONLY place in the app that writes to Supabase Auth on
 * another user's behalf. Everything here needs the service-role key, so
 * everything here is `server-only` and Node-runtime, and every caller is
 * behind `requireOpsRole(['admin'])` or holds a single-use invite token.
 *
 * THE TWO-WRITER CONTRACT, stated once. An ops account's role now lives in
 * two places:
 *
 *   ops_users.role                  AUTHORITY. FK-linked, audited, re-read on
 *                                   every guarded request.
 *   app_metadata.ops_role           CEILING. Rides in the Supabase JWT so
 *                                   Edge middleware can check a role with no
 *                                   database and no network.
 *
 * They must agree, because `resolveOpsSession()` refuses a session whose
 * claim disagrees with the database (src/lib/auth/rbac/server.ts) — in BOTH
 * directions, deliberately, since proceeding on either value when the two
 * writers have diverged is guessing. That refusal is what makes divergence
 * safe; it is also what makes divergence expensive, because the user is
 * locked out until they sign in again. So the writes are not "best effort"
 * on the assignment path: they are one transaction that either lands in both
 * stores or in neither (see repo.assignUserRole and the role route).
 *
 * WHY EVERY WRITE IS READ BACK. `updateUserById` merges `app_metadata`
 * server-side, and a merge that silently no-ops is indistinguishable from a
 * merge that worked if you only look at the absence of an error. Each write
 * below therefore asserts the intended claim in the RESPONSE user before
 * returning. A write that did not apply is a failure, not a success — that is
 * the difference between a dual-write and a hopeful one.
 *
 * WHAT NEVER GOES IN THE TOKEN. Only a role NAME. Not `status`: a disable
 * signal that cannot be trusted is worse than no signal, because someone
 * eventually trusts it. Not `ops_users.id`: the JWT payload is base64, not
 * encrypted, and `sub` already means something else to 27 call sites.
 */
import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { SupabaseConfigError } from '@/lib/supabase/env';
import { OPS_ROLE_CLAIM } from './supabaseClaims';
import { isOpsRole, type OpsRole } from './roles';

/**
 * Why a Supabase-side identity operation failed. Callers map these to
 * responses; nothing here ever decides an authorization outcome.
 */
export type OpsIdentityFailure =
  /** Supabase URL or service-role key is unset in this environment. */
  | 'not_configured'
  /**
   * An account already exists for this email. Deliberately NOT resolved by
   * adopting that account — see `provisionOpsIdentity`.
   */
  | 'email_already_registered'
  /** `supabase_user_id` points at a Supabase user that no longer exists. */
  | 'identity_not_found'
  /** Supabase Auth refused the write (permissions, validation, rate limit). */
  | 'write_rejected'
  /**
   * Supabase Auth accepted the write and the claim still is not what we
   * asked for. Treated as a hard failure — see this module's header.
   */
  | 'write_not_applied'
  /** Network failure or timeout talking to Supabase Auth. */
  | 'unreachable';

export class OpsIdentityError extends Error {
  readonly failure: OpsIdentityFailure;

  constructor(failure: OpsIdentityFailure, message: string) {
    super(message);
    this.name = 'OpsIdentityError';
    this.failure = failure;
  }
}

/**
 * Bound on any single Supabase Auth admin call.
 *
 * Load-bearing on the assignment path: that call runs INSIDE an open
 * Postgres transaction holding a row lock on `ops_users`, so an unbounded
 * wait would pin a pooled connection and a locked row for as long as
 * Supabase Auth is slow. Ten seconds is generous for a single admin action
 * and short enough that a stall fails the assignment (rolling the role
 * change back) rather than degrading the database for everyone else.
 */
const ADMIN_CALL_TIMEOUT_MS = 10_000;

class TimeoutError extends Error {}

async function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError(`Supabase Auth ${label} timed out.`)),
          ADMIN_CALL_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function adminClient(): SupabaseClient {
  try {
    return createSupabaseAdminClient();
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      throw new OpsIdentityError('not_configured', error.message);
    }
    throw error;
  }
}

/** Reads the ops role claim off a Supabase user. Unrecognised values read as null. */
function claimOf(user: User | null | undefined): OpsRole | null {
  const raw = (user?.app_metadata as Record<string, unknown> | undefined)?.[OPS_ROLE_CLAIM];
  return isOpsRole(raw) ? raw : null;
}

/**
 * How long a revoked operator is banned for.
 *
 * 876000h is a hundred years, and it is the value @supabase/auth-js's own
 * `updateUserById` documentation uses to mean "indefinitely" — GoTrue models a
 * ban as a `banned_until` timestamp, so there is no literal "forever" to pass.
 * Lifting it is `ban_duration: 'none'`, which is what a future re-enable path
 * must call; nothing today re-activates a disabled ops account, so nothing
 * today calls it.
 */
const OPS_IDENTITY_BAN_DURATION = '876000h';

/**
 * Whether this identity is currently banned, read from the timestamp GoTrue
 * actually stores. A `banned_until` in the past is not a ban, and treating it
 * as one would let a revocation read back as applied when it had expired.
 */
function isBanned(user: User | null | undefined): boolean {
  const until = user?.banned_until;
  if (typeof until !== 'string' || until.length === 0) return false;
  const expiry = Date.parse(until);
  return Number.isFinite(expiry) && expiry > Date.now();
}

interface AuthErrorish {
  message?: unknown;
  status?: unknown;
  code?: unknown;
}

function describe(error: unknown): string {
  const message = (error as AuthErrorish | null)?.message;
  return typeof message === 'string' && message.length > 0 ? message : 'Supabase Auth error.';
}

/**
 * GoTrue reports a duplicate address as `email_exists` (or, on older
 * deployments, a 422 whose message names it). Matched broadly on purpose:
 * mistaking "already registered" for a generic write failure would send an
 * admin chasing an outage that is not happening.
 */
function isEmailAlreadyRegistered(error: unknown): boolean {
  const e = error as AuthErrorish | null;
  if (e?.code === 'email_exists' || e?.code === 'user_already_exists') return true;
  const message = typeof e?.message === 'string' ? e.message.toLowerCase() : '';
  return (
    e?.status === 422 &&
    (message.includes('already registered') || message.includes('already been registered'))
  );
}

function isUserNotFound(error: unknown): boolean {
  const e = error as AuthErrorish | null;
  if (e?.code === 'user_not_found') return true;
  return e?.status === 404;
}

function rethrow(error: unknown, label: string): never {
  if (error instanceof OpsIdentityError) throw error;
  if (error instanceof TimeoutError) throw new OpsIdentityError('unreachable', error.message);
  throw new OpsIdentityError('unreachable', `Supabase Auth ${label} failed: ${describe(error)}`);
}

/**
 * Create the Supabase Auth account an invited operator will sign in with,
 * carrying their ops role claim from the very first token.
 *
 * `email_confirm: true` because the invite token IS the proof of mailbox
 * control: it was generated server-side, stored only as a sha256 digest, and
 * emailed to exactly this address. Requiring a second confirmation round-trip
 * would prove the same fact twice and strand the operator between two
 * half-finished flows if the second email failed.
 *
 * AN EXISTING ACCOUNT IS A REFUSAL, NOT A MERGE. If the address already has a
 * Supabase account (typically an enterprise project viewer), this fails with
 * `email_already_registered` instead of adopting that account. Adopting it
 * would mean either resetting a stranger's password to whatever was typed
 * into the invite form, or binding an ops profile to an identity whose
 * control was never proven to this flow. Both are account-takeover shapes.
 * Linking an existing identity is an explicit admin action against an
 * already-authenticated user, not something an invite may do implicitly.
 */
export async function provisionOpsIdentity(input: {
  email: string;
  password: string;
  role: OpsRole;
}): Promise<{ supabaseUserId: string }> {
  const admin = adminClient();

  let result: Awaited<ReturnType<SupabaseClient['auth']['admin']['createUser']>>;
  try {
    result = await bounded(
      admin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        app_metadata: { [OPS_ROLE_CLAIM]: input.role },
      }),
      'createUser',
    );
  } catch (error) {
    rethrow(error, 'createUser');
  }

  if (result.error) {
    if (isEmailAlreadyRegistered(result.error)) {
      throw new OpsIdentityError(
        'email_already_registered',
        'A sign-in account already exists for this email address.',
      );
    }
    throw new OpsIdentityError(
      'write_rejected',
      `Supabase Auth refused to create the account: ${describe(result.error)}`,
    );
  }

  const user = result.data?.user;
  if (!user?.id) {
    throw new OpsIdentityError('write_rejected', 'Supabase Auth returned no user.');
  }
  if (claimOf(user) !== input.role) {
    // The account exists but would sign in with no ops ceiling at all. Report
    // it so the caller can undo the whole acceptance rather than hand the
    // operator an account that cannot reach their dashboard.
    throw new OpsIdentityError(
      'write_not_applied',
      'The ops role claim was not stored on the new account.',
    );
  }

  return { supabaseUserId: user.id };
}

/**
 * Compensating undo for `provisionOpsIdentity`, used when the database half
 * of invite acceptance fails after the identity was created.
 *
 * Never throws, and its failure is never fatal: the worst case it leaves
 * behind is a Supabase account with NO linked ops profile, which
 * `resolveOpsSession()` refuses outright (`no_profile`). Returns whether the
 * account was actually removed so the caller can log the difference.
 */
export async function releaseOpsIdentity(supabaseUserId: string): Promise<boolean> {
  try {
    const admin = adminClient();
    const { error } = await bounded(admin.auth.admin.deleteUser(supabaseUserId), 'deleteUser');
    return !error;
  } catch {
    return false;
  }
}

/**
 * Write `app_metadata.ops_role`, merging into whatever else is there.
 *
 * MERGE, NEVER REPLACE: `app_metadata` also carries `provider` and
 * `providers`, which Supabase Auth itself maintains and which decide how the
 * account may sign in. Dropping them is an unrecoverable, silent lockout.
 */
export async function pushOpsRoleClaim(supabaseUserId: string, role: OpsRole): Promise<void> {
  await writeIdentity(supabaseUserId, role, { ban: false });
}

/**
 * Revoke a disabled operator's sign-in identity outright: clear the ops role
 * claim AND ban the account.
 *
 * WHAT REVOKES WHAT, because the three writes are not interchangeable.
 * `ops_users.status` is the revocation FOR THIS PRODUCT: every guarded
 * request on both surfaces re-reads that row, so a disabled account is
 * refused on its very next request whatever token it is holding. A ban adds
 * nothing there and is not a substitute for it.
 *
 * WHAT THE BAN IS FOR is the part the status write cannot reach: a Supabase
 * identity is a credential against the SUPABASE PROJECT, which this app does
 * not exclusively own. Until it is banned, a fired operator keeps a working
 * sign-in, keeps renewing tokens by refresh forever, and keeps whatever the
 * project itself grants a signed-in user. It is also the standing backstop
 * for the profile gate: if `/project/*` ever loses its `ops_users` check
 * again — which is precisely what it was missing until recently — a banned
 * identity still cannot get in.
 *
 * WHAT A BAN ACTUALLY DOES, measured against this project's Supabase instance
 * rather than assumed:
 *
 *   GET /user with the token they already hold   403 user_banned
 *   refresh_token grant                          400 user_banned
 *   a fresh password sign-in                     400 user_banned
 *
 * THE ONE THING IT DOES NOT DO, stated plainly because it is the residual an
 * incident review will ask about: a ban does not invalidate an access token's
 * SIGNATURE. This project signs with ES256, so anything that verifies the
 * token locally keeps accepting it until it expires — 3600s here, measured.
 * Inside this app that grants nothing: the only local verifier is the Edge
 * ceiling, and the Node guard behind it re-reads `ops_users` and refuses. At
 * the Supabase project level the worst case is up to one token lifetime of
 * RLS-scoped access with a token already in hand; this app keeps no data
 * there (its own Postgres is reached with `pg`), so there is nothing behind
 * it. Closing even that would mean DELETING the identity, which destroys the
 * account and its history for a one-hour window; a ban is reversible.
 *
 * ONE WRITE, NOT TWO. The claim clear and the ban go out in a single
 * `updateUserById` on purpose: two admin calls have a state between them
 * where the ceiling is gone but the account is still live, and a second call
 * that fails leaves a half-revocation nobody is looking at. Both halves are
 * read back off the same response.
 *
 * Lifting this is `ban_duration: 'none'`. Nothing re-activates a disabled ops
 * account today; whoever builds that path has to lift the ban there, or the
 * re-enabled operator will hold an ops profile they cannot sign in to.
 */
export async function revokeOpsIdentity(supabaseUserId: string): Promise<void> {
  await writeIdentity(supabaseUserId, null, { ban: true });
}

/**
 * Write `app_metadata.ops_role` — and, on a revocation, the ban — merging
 * into whatever else is already on the account.
 *
 * The role is written as an explicit `null` when clearing rather than by
 * omitting the key, because `updateUserById` merges: an omitted key is "leave
 * it alone", which on a revocation path is exactly the wrong reading. `null`
 * is not a valid ops role, so it reads back as "no ceiling" whether Supabase
 * merged or replaced.
 *
 * `ban_duration` is likewise only ever SENT on a revocation. Sending it on
 * the role-assignment path would let an ordinary role change silently decide
 * a ban question it has no opinion about.
 */
async function writeIdentity(
  supabaseUserId: string,
  role: OpsRole | null,
  { ban }: { ban: boolean },
): Promise<void> {
  const admin = adminClient();
  const current = await fetchUser(admin, supabaseUserId);

  const existing = (current.app_metadata ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...existing, [OPS_ROLE_CLAIM]: role };

  let result: Awaited<ReturnType<SupabaseClient['auth']['admin']['updateUserById']>>;
  try {
    result = await bounded(
      admin.auth.admin.updateUserById(supabaseUserId, {
        app_metadata: next,
        ...(ban ? { ban_duration: OPS_IDENTITY_BAN_DURATION } : {}),
      }),
      'updateUserById',
    );
  } catch (error) {
    rethrow(error, 'updateUserById');
  }

  if (result.error) {
    if (isUserNotFound(result.error)) {
      throw new OpsIdentityError(
        'identity_not_found',
        'The linked sign-in account no longer exists.',
      );
    }
    throw new OpsIdentityError(
      'write_rejected',
      `Supabase Auth refused the identity write: ${describe(result.error)}`,
    );
  }

  if (claimOf(result.data?.user) !== role) {
    throw new OpsIdentityError(
      'write_not_applied',
      'Supabase Auth accepted the role claim write but the claim did not change.',
    );
  }

  // Read back separately from the claim: a merge that applied the metadata
  // and dropped the ban would otherwise pass as a complete revocation, and
  // the half it dropped is the half that closes the enterprise surface.
  if (ban && !isBanned(result.data?.user)) {
    throw new OpsIdentityError(
      'write_not_applied',
      'Supabase Auth accepted the revocation but the account is not banned.',
    );
  }
}

/**
 * The ops role currently baked into this identity's tokens, or null when it
 * carries none. Reads the stored `app_metadata` rather than a token, so it
 * reports what the NEXT token will say — which is what a drift check needs.
 */
export async function readOpsRoleClaim(supabaseUserId: string): Promise<OpsRole | null> {
  const admin = adminClient();
  return claimOf(await fetchUser(admin, supabaseUserId));
}

async function fetchUser(admin: SupabaseClient, supabaseUserId: string): Promise<User> {
  let result: Awaited<ReturnType<SupabaseClient['auth']['admin']['getUserById']>>;
  try {
    result = await bounded(admin.auth.admin.getUserById(supabaseUserId), 'getUserById');
  } catch (error) {
    rethrow(error, 'getUserById');
  }

  if (result.error) {
    if (isUserNotFound(result.error)) {
      throw new OpsIdentityError(
        'identity_not_found',
        'The linked sign-in account no longer exists.',
      );
    }
    throw new OpsIdentityError(
      'write_rejected',
      `Supabase Auth refused to read the account: ${describe(result.error)}`,
    );
  }

  const user = result.data?.user;
  if (!user?.id) {
    throw new OpsIdentityError('identity_not_found', 'The linked sign-in account no longer exists.');
  }
  return user;
}
