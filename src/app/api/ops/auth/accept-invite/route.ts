import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOpsRepo, InviteNotAcceptableError } from '@/lib/auth/rbac/repo';
import { hashInviteToken } from '@/lib/auth/rbac/tokens';
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/auth/rbac/passwords';
import { establishOpsSession } from '@/lib/auth/rbac/server';
import { OpsDbConfigError } from '@/lib/db/pool';
import { checkRateLimit, clientIpFrom, recordFailure } from '@/lib/auth/rate-limit';
import { isSameOrigin } from '@/lib/auth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().min(16).max(512),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Consumes a single-use admin-issued invite and creates the ops_users row.
 * The token itself proves possession of the invite (it was emailed to the
 * invited person via the Resend adapter — see docs/olympuss/RBAC.md); there
 * is no separate account to log in with beforehand, by design
 * ("admin-invite only").
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.', 415);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Malformed request body.', 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse('INVALID_BODY', 'Invalid invite acceptance request.', 400);
  }

  const ip = clientIpFrom(request.headers);
  const rlKey = `ops-invite:${ip}`;
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

  const tokenHash = hashInviteToken(parsed.data.token);

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await getOpsRepo().acceptInvite({
      tokenHash,
      name: parsed.data.name,
      passwordHash,
    });

    await getOpsRepo().recordAuditEvent({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'ops_user.invite.accept',
      resourceType: 'ops_user',
      resourceId: user.id,
      ip,
    });

    await establishOpsSession({ id: user.id, email: user.email, role: user.role });

    return NextResponse.json(
      { ok: true, role: user.role, name: user.name },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof InviteNotAcceptableError) {
      recordFailure(rlKey);
      return errorResponse(
        'INVITE_NOT_ACCEPTABLE',
        'This invite link is invalid or has expired.',
        400,
      );
    }
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
