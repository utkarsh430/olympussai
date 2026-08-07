/**
 * Edge-safe Supabase client for `src/middleware.ts`.
 *
 * `@supabase/ssr` reads/writes auth cookies on the `NextRequest`/`NextResponse`
 * pair directly, so this never pulls in `next/headers` or any Node-only code —
 * the same edge-safety rule the PIN system's `src/lib/auth/session.ts`
 * documented for `jose`.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl, SupabaseConfigError } from './env';

export interface MiddlewareSupabase {
  /** Null when Supabase env vars are missing — callers must fail closed. */
  supabase: SupabaseClient | null;
  /** Response carrying any refreshed auth cookies; return this from middleware. */
  supabaseResponse: NextResponse;
}

export function createMiddlewareSupabaseClient(request: NextRequest): MiddlewareSupabase {
  let supabaseResponse = NextResponse.next({ request });

  let url: string;
  let anonKey: string;
  try {
    url = getSupabaseUrl();
    anonKey = getSupabaseAnonKey();
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return { supabase: null, supabaseResponse };
    }
    throw error;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  return { supabase, supabaseResponse };
}

/** Authenticated user for the current request, or null (incl. on misconfig). */
export async function getMiddlewareUser(
  supabase: SupabaseClient | null,
): Promise<User | null> {
  if (!supabase) return null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}
