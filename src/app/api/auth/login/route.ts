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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Single generic message — never reveals which field was wrong (Section 9). */
const INVALID_MESSAGE = 'Invalid email or password.';

const bodySchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  password: z.string().min(1).max(200),
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

  const preCheck = checkRateLimit(rlKey);
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
    const result = recordFailure(rlKey);
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

  clearFailures(rlKey);

  // Only safe success information — never the token or any credential.
  return NextResponse.json(
    { ok: true },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
