import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { generateInviteToken, hashInviteToken } from '@/lib/auth/rbac/tokens';
import { OPS_ROLES } from '@/lib/auth/rbac/roles';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Admins may invite any of the five operational roles, or another admin —
// OPS_ROLES already includes 'admin', so no extra union is needed.
const inviteRoleSchema = z.enum(OPS_ROLES);

const bodySchema = z.object({
  email: z.string().email().max(254),
  role: inviteRoleSchema,
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://olympuss.us';
}

/**
 * Create an admin invite. Only role guarded by 'admin' can call this — the
 * database also refuses non-admin callers implicitly (invited_by must be a
 * valid ops_users.id, and only admins reach this branch of the app), but the
 * guard is the enforced control (docs/CONTROL_SERVICE_INTEGRATION.md's
 * "Auth boundary: explicit, enforced at the API layer" principle applied
 * here to a first-party admin surface instead of the control-service one).
 *
 * The accept URL (containing the raw, one-time token) is returned ONLY in
 * this response, to the admin who created the invite; it is never persisted
 * anywhere and never logged. Email delivery is not wired up yet (no vendor
 * dependency is configured in this repo) — see db/README.md and the
 * follow-up ticket filed alongside this one. Until then, the admin is
 * expected to share the link out of band.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

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
    return errorResponse('INVALID_BODY', 'A valid email and role are required.', 400);
  }

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  try {
    const repo = getOpsRepo();
    const invite = await repo.createInvite({
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: guard.claims.sub,
      tokenHash,
      expiresAt,
    });

    // Audit write happens before the response is returned; if this throws,
    // the invite is still in the database but unattributed-audit is treated
    // as a failure of the whole request (fail closed) — the 500 tells the
    // admin to retry rather than silently accepting an unaudited invite.
    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.invite.create',
      resourceType: 'ops_invite',
      resourceId: invite.id,
      metadata: { email: invite.email, role: invite.role },
      ip: clientIpFrom(request.headers),
    });

    const acceptUrl = new URL('/ops/accept-invite', siteUrl());
    acceptUrl.searchParams.set('token', token);

    return NextResponse.json(
      {
        ok: true,
        inviteId: invite.id,
        expiresAt: invite.expiresAt,
        acceptUrl: acceptUrl.toString(),
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    // Unique-violation on ops_invites_pending_email_idx → a live invite already exists.
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      return errorResponse(
        'INVITE_ALREADY_PENDING',
        'This email already has a pending invite.',
        409,
      );
    }
    throw error;
  }
}
