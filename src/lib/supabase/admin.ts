/**
 * Service-role Supabase client — the only credential that can write another
 * user's `app_metadata` or create an account on their behalf.
 *
 * Node runtime only, and deliberately `server-only`: this key bypasses RLS
 * entirely, so a single accidental import from an Edge-safe module (or worse,
 * a client component) would put it in a bundle. `server-only` turns that
 * mistake into a build failure instead of an incident, and
 * src/tests/unit/middlewareEdgeSafety.test.ts walks the import graph from
 * middleware.ts and fails if anything reachable from it pulls this in.
 *
 * WHY THIS IS A NEW MODULE RATHER THAN A REUSE OF createSupabaseServerClient.
 * That one is bound to the *caller's* cookies and carries the anon key: it
 * acts as the signed-in user. Everything in this file acts as the project
 * administrator on behalf of an ops admin who has already been authorized by
 * `requireOpsRole(['admin'])`. Those are different principals and must not
 * share a client.
 *
 * Until now the service-role key was used by exactly one script
 * (scripts/create-project-user.mjs) and by no request-serving route handler,
 * a property README.md states explicitly. Collapsing the two auth systems
 * changes that: provisioning an invited operator's sign-in identity and
 * writing their role claim are both admin-authenticated *request* paths.
 * The key stays server-only and is still never sent to the browser, but the
 * README claim is no longer true and is corrected there.
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceRoleKey, getSupabaseUrl } from './env';

/**
 * A Supabase client authenticated as the service role.
 *
 * No session persistence and no token auto-refresh: this client represents no
 * user, is created per operation, and must never write a session anywhere.
 *
 * Throws `SupabaseConfigError` when the project URL or the service-role key
 * is unset — callers surface that as a configuration failure (503), never as
 * an authorization result.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
