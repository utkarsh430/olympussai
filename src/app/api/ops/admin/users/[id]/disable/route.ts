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
 * Disable an ops user (revoke access without deleting the audit history
 * attributed to them). Admin-only; refuses an admin disabling their own
 * account when they are the last active admin, so a tenant can never lock
 * itself out of invite management.
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
    return errorResponse('INVALID_BODY', 'Invalid user id.', 400);
  }
  const targetId = parsedParams.data.id;

  try {
    const repo = getOpsRepo();
    const target = await repo.findUserById(targetId);
    if (!target) {
      return errorResponse('NOT_FOUND', 'User not found.', 404);
    }

    if (target.role === 'admin' && target.status === 'active') {
      const adminCount = await repo.countAdmins();
      if (adminCount <= 1) {
        return errorResponse('LAST_ADMIN', 'Cannot disable the last active admin account.', 409);
      }
    }

    const updated = await repo.disableUser(targetId, guard.claims.sub);
    if (!updated) {
      return errorResponse('NOT_FOUND', 'User not found.', 404);
    }

    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.user.disable',
      resourceType: 'ops_user',
      resourceId: updated.id,
      metadata: { disabledEmail: updated.email, disabledRole: updated.role },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      { ok: true, id: updated.id, status: updated.status },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
