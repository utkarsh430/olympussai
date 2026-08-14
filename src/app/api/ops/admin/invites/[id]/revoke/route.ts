import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { clientIpFrom } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /api/ops/admin/invites/:id/revoke
 *
 * Cancel an outstanding invite.
 *
 * ─── WHY THIS ROUTE HAD TO EXIST ─────────────────────────────────────────
 *
 * Revocation has been in the schema and honoured by the accept path since the
 * RBAC migration — `acceptInvite` refuses a revoked invite, and the
 * one-live-invite-per-email index deliberately excludes revoked rows — but
 * nothing could ever set `revoked_at`. So the state was enforced and
 * unreachable, and the combination had a sharp edge: an invite sent to the
 * wrong address, or with the wrong role, could not be cancelled, AND the
 * one-live-invite-per-email rule then refused the corrected invite until the
 * mistake expired seven days later. Resending only rotates the token; it
 * cannot change the role, which is baked into the row.
 *
 * Revoking is therefore both halves of the fix: the wrong link stops working
 * immediately, and the address is freed for a correct invite in the same
 * moment.
 *
 * The row is stamped, never deleted. An invite issued to the wrong person is
 * exactly the record an audit wants to keep, and `ops_users.invite_id`
 * references it.
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
      // Terminal, and the remedy is a different one entirely: the account
      // exists, so access is withdrawn by disabling the operator.
      return errorResponse(
        'INVITE_ALREADY_ACCEPTED',
        'This invite has already been accepted, so there is no link left to cancel. ' +
          'Disable the account instead to withdraw their access.',
        409,
      );
    }
    if (existing.revokedAt) {
      return errorResponse('INVITE_ALREADY_REVOKED', 'This invite has already been revoked.', 409);
    }

    const invite = await repo.revokeInvite(inviteId);
    if (!invite) {
      // Lost a race with an acceptance between the read above and the write.
      // The account now exists; saying so is more useful than a bare 409.
      return errorResponse(
        'INVITE_ALREADY_ACCEPTED',
        'This invite was accepted a moment ago, so it could not be cancelled. ' +
          'Disable the account instead to withdraw their access.',
        409,
      );
    }

    // Audited before the response, same posture as invite creation: an
    // unattributed revocation is treated as a failure of the whole request
    // rather than a quiet success.
    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.invite.revoke',
      resourceType: 'ops_invite',
      resourceId: invite.id,
      metadata: { email: invite.email, role: invite.role },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      { ok: true, inviteId: invite.id, revokedAt: invite.revokedAt },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
