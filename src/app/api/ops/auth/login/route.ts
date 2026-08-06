import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { verifyPassword } from '@/lib/auth/rbac/passwords';
import { establishOpsSession } from '@/lib/auth/rbac/server';
import { OpsDbConfigError } from '@/lib/db/pool';
import { checkRateLimit, clearFailures, clientIpFrom, recordFailure } from '@/lib/auth/rate-limit';
import { isSameOrigin } from '@/lib/auth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Single generic message — never reveals which field was wrong. */
const INVALID_MESSAGE = 'Invalid email or password.';

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

function invalid(status = 401) {
  return NextResponse.json(
    { error: { code: 'INVALID_CREDENTIALS', message: INVALID_MESSAGE } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'Invalid request origin.' } },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json(
      { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type.' } },
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

  const { email, password } = parsed.data;
  const ip = clientIpFrom(request.headers);
  const rlKey = `ops:${ip}:${email.toLowerCase()}`;

  const preCheck = checkRateLimit(rlKey);
  if (preCheck.limited) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
      {
        status: 429,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': String(preCheck.retryAfterSeconds) },
      },
    );
  }

  let user;
  try {
    user = await getOpsRepo().findUserByEmail(email);
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return NextResponse.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Ops authentication is not configured.' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }

  // Always run the bcrypt comparison against a real-shaped hash, even when the
  // user does not exist, so response timing does not distinguish "no such
  // account" from "wrong password".
  const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO0rQPmuk9YRXWnQpZlEnLfBQ.2h3zJTa';
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || user.status !== 'active' || !passwordMatches) {
    const result = recordFailure(rlKey);
    if (result.limited) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
        {
          status: 429,
          headers: { 'Cache-Control': 'no-store', 'Retry-After': String(result.retryAfterSeconds) },
        },
      );
    }
    return invalid();
  }

  clearFailures(rlKey);
  await establishOpsSession({ id: user.id, email: user.email, role: user.role });

  return NextResponse.json(
    { ok: true, role: user.role, name: user.name },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
