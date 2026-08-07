/**
 * Server-side Supabase client for Route Handlers and Server Components.
 *
 * Uses the Next.js `cookies()` API (Node runtime) — mirrors the pattern the
 * PIN system used in `src/lib/auth/server.ts`, now backed by Supabase Auth's
 * own session cookies instead of a hand-rolled HS256 JWT. Middleware does NOT
 * use this module (it is not Edge-safe); see `./middleware.ts` for that path.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from './env';

/** Create a Supabase client bound to the current request's cookies. */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `set` throws when called from a Server Component render (cookies
          // are read-only there). Safe to ignore — middleware refreshes the
          // session on the next navigation/request.
        }
      },
    },
  });
}

/**
 * Read and verify the current authenticated user, or null if absent/invalid.
 * Uses `getUser()` (not `getSession()`) so the result is re-validated against
 * Supabase Auth on every call rather than trusting an unverified cookie —
 * fails closed (never throws) on misconfiguration, same contract as the PIN
 * system's `isAuthorizedProject()`.
 */
export async function getSupabaseUser(): Promise<User | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}
