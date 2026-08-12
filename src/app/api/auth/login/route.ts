import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SupabaseConfigError } from '@/lib/supabase/env';
import {
  checkRateLimit,
  clearFailures,
  clientIpFrom,
  recordFailure,
} from '@/lib/auth/rate-limit';
import { isSameOrigin } from '@/lib/auth/origin';
import { landingUrl, resolveLanding } from '@/lib/auth/landing';
import { opsRoleForSupabaseUser } from '@/lib/auth/opsAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Single generic message — never reveals which field was wrong (Section 9). */
const INVALID_MESSAGE = 'Invalid email or password.';

const bodySchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  password: z.string().min(1).max(200),
  /**
   * Where the caller was heading before it was bounced here. Never trusted:
   * `resolveLanding` re-sanitizes it against the internal allowlist, so a
   * hostile value can only downgrade to the default, never open-redirect.
   */
  next: z.string().max(2048).optional(),
});

function invalid(status = 401) {
  return NextResponse.json(
    { error: INVALID_MESSAGE },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  // State-changing request: require same-origin.
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: 'Invalid request origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Require JSON content type.
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json(
      { error: 'Unsupported content type.' },
      { status: 415, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return invalid(400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return invalid(400);
  }

  const email = parsed.data.email.toLowerCase();
  const { password } = parsed.data;

  // Rate-limit key: IP + normalized email.
  const ip = clientIpFrom(request.headers);
  const rlKey = `${ip}:${email}`;

  const preCheck = await checkRateLimit(rlKey);
  if (preCheck.limited) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(preCheck.retryAfterSeconds),
        },
      },
    );
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      // Misconfiguration — do not leak which variable, do not enumerate.
      return NextResponse.json(
        { error: 'Authentication is not configured.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    const result = await recordFailure(rlKey);
    if (result.limited) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again later.' },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': String(result.retryAfterSeconds),
          },
        },
      );
    }
    return invalid();
  }

  await clearFailures(rlKey);

  // ROLE-CORRECT LANDING. This is now the single front door for the ops
  // console too, so the answer has to say where this particular person
  // belongs — before the collapse every one of the seven ops roles was sent
  // to /project/upsrtc, a product most of them have no business in.
  //
  // Looked up by `data.user.id` rather than through the session helpers: the
  // auth cookies signInWithPassword just issued ride on the outgoing
  // response and are not readable back via `cookies()` in this same request.
  // Never fatal — see src/lib/auth/opsAccess.ts.
  const opsRole = await opsRoleForSupabaseUser(data.user.id);
  const decision = resolveLanding({ requestedNext: parsed.data.next, opsRole });

  // Only safe success information — never the token or any credential. The
  // role itself is deliberately NOT returned: the client has no use for it,
  // and `redirectTo` already carries everything the form needs.
  return NextResponse.json(
    { ok: true, redirectTo: landingUrl(decision) },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
