import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { generateInviteToken, hashInviteToken } from '@/lib/auth/rbac/tokens';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';
import { buildAcceptUrl } from '@/lib/auth/rbac/inviteUrl';
import { sendEmail } from '@/lib/email/resend';
import { renderInviteEmail } from '@/lib/email/inviteEmailTemplate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same as invite creation

const paramsSchema = z.object({ id: z.string().uuid() });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Resend an outstanding invite. Since the raw invite token is never
 * persisted (only its SHA-256 digest is — see tokens.ts), a resend cannot
 * reuse the original link: it mints a fresh token, rotates
 * ops_invites.token_hash/expires_at (invalidating the previous link), and
 * re-sends the branded email through the same Resend adapter used at invite
 * creation (src/lib/email/resend.ts). Refuses (404/409) once the invite has
 * been accepted or revoked — those are terminal states, not "resend" states.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return errorResponse('INVALID_BODY', 'Invalid invite id.', 400);
  }
  const inviteId = parsedParams.data.id;

  try {
    const repo = getOpsRepo();
    const existing = await repo.findInviteById(inviteId);
    if (!existing) {
      return errorResponse('NOT_FOUND', 'Invite not found.', 404);
    }
    if (existing.acceptedAt) {
      return errorResponse(
        'INVITE_ALREADY_ACCEPTED',
        'This invite has already been accepted.',
        409,
      );
    }
    if (existing.revokedAt) {
      return errorResponse('INVITE_REVOKED', 'This invite has been revoked.', 409);
    }

    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await repo.regenerateInviteToken({ id: inviteId, tokenHash, expiresAt });
    if (!invite) {
      // Lost a race with acceptance/revocation between the read above and now.
      return errorResponse('NOT_FOUND', 'Invite is no longer pending.', 409);
    }

    const acceptUrl = buildAcceptUrl(token);
    const emailTemplate = renderInviteEmail({
      role: invite.role,
      acceptUrl: acceptUrl.toString(),
      expiresAt: invite.expiresAt,
    });
    const emailResult = await sendEmail({
      to: invite.email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });

    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.invite.resend',
      resourceType: 'ops_invite',
      resourceId: invite.id,
      metadata: { email: invite.email, role: invite.role, emailDelivered: emailResult.ok },
      ip: clientIpFrom(request.headers),
    });

    if (!emailResult.ok) {
      console.error('[ops/admin/invites/resend] email delivery failed', {
        inviteId: invite.id,
        error: emailResult.error,
      });
      // The token rotation already happened and is not rolled back — the
      // invite remains valid (with its new expiry), just not yet delivered.
      return NextResponse.json(
        {
          ok: true,
          delivered: false,
          inviteId: invite.id,
          expiresAt: invite.expiresAt,
          error: {
            code: 'EMAIL_DELIVERY_FAILED',
            message:
              'The invite link was refreshed, but the email could not be sent. Try resending again shortly.',
          },
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: true, delivered: true, inviteId: invite.id, expiresAt: invite.expiresAt },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
