/**
 * The Supabase half of seeding an ops account, shared by
 * scripts/seed-ops-user.mjs and scripts/seed-ops-admin.mjs.
 *
 * WHY THE SEED SCRIPTS NEEDED ONE AT ALL. Both of them write a bcrypt hash
 * into `ops_users.password_hash` and stop, which was enough while
 * POST /api/ops/auth/login was the door CI drove. It is not the door any
 * more: the e2e suites now sign in at `/login`, which is Supabase Auth, and a
 * seeded row with no `supabase_user_id` and no `app_metadata.ops_role` cannot
 * get through either the Edge ceiling or the profile lookup behind it.
 *
 * OFF UNLESS A SERVICE-ROLE KEY IS PRESENT. With no key this is a no-op and
 * the scripts behave exactly as they always have, so local development and
 * anything still driving the legacy door are untouched.
 *
 * AND, WHEN IT IS ON, CONFINED TO THE QA NAMESPACE — this is the load-bearing
 * part. CI runs against the project's real Supabase directory, which holds
 * real people's logins. A seed script that could create or overwrite an
 * identity for an arbitrary address is a script that can reset a real
 * person's password from a pull request. `assertQaIdentity` refuses anything
 * outside `*.qa@example.test`, and it refuses rather than skipping: silently
 * seeding the row without the identity would produce an account that fails to
 * sign in three jobs later, with nothing pointing at why.
 *
 * Real accounts are provisioned by an admin invite. That is not a limitation
 * of this module; it is the product's rule (docs/olympuss/RBAC.md), and
 * automation is not an exception to it.
 */
import { createClient } from '@supabase/supabase-js';
import { assertQaIdentity, upsertQaIdentity } from './qa-identity.mjs';

/** The Supabase project URL, or null when this environment has none. */
function supabaseUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  return url && url.trim() ? url.trim() : null;
}

function serviceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key && key.trim() ? key.trim() : null;
}

/** Whether this environment is configured to provision sign-in identities. */
export function identitySeedingEnabled() {
  return Boolean(supabaseUrl() && serviceRoleKey());
}

/**
 * Provision (or re-point) the sign-in identity for a seeded ops account.
 *
 * @returns {Promise<string|null>} The Supabase user id to store in
 *   `ops_users.supabase_user_id`, or null when identity seeding is off.
 */
export async function seedOpsIdentity({ email, password, role }) {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) {
    if (key && !url) {
      // A key with no URL is a half-configured environment, and silently
      // skipping would hand CI a row that cannot sign in.
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is set but NEXT_PUBLIC_SUPABASE_URL is not. Set both, or neither.',
      );
    }
    return null;
  }

  // Before the client is even built. There is no branch below this line that
  // can be reached with an address the namespace does not admit.
  assertQaIdentity(
    email,
    'provision a sign-in identity from a seed script (real accounts come from an admin invite)',
  );

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { supabaseUserId } = await upsertQaIdentity(admin, { email, password, opsRole: role });
  return supabaseUserId;
}
