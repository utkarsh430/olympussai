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

// `depotId` is nullable so an admin can explicitly unassign an operator
// (e.g. before disabling them or moving them to another depot) — omitting
// the field entirely is a validation error, not treated as "leave
// unchanged", so the request body always states the caller's full intent.
// Deliberately a uuid rather than a depot name: the assignment is an
// authorization boundary, and a boundary keyed on a free-text name accepts a
// typo as a valid depot that simply owns no vehicles.
const bodySchema = z.object({
  depotId: z.string().uuid().nullable(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /api/ops/admin/users/:id/depot
 *
 * Admin-only assignment of a `depot`-role operator to a depot
 * (db/migrations/20260812150000__ops_depot_ownership.sql). Deliberately the
 * same shape as its sibling POST /api/ops/admin/users/:id/vehicle rather
 * than a new convention: same-origin check, admin guard, uuid params,
 * content-type gate, explicit nullable body, 404 on unknown target, audit
 * event, `{ ok: true, ... }`.
 *
 * This is the ONLY write path to ops_users.depot_id outside of invite-time
 * assignment (repo.acceptInvite). No depot-facing route may set their own
 * depot_id, and that is precisely what makes the depot dashboard and
 * GET /api/ops/fleet/schedule safe to trust the session's own user row for
 * scoping instead of anything in the request — the same property the vehicle
 * assignment gives the pilot-driver command routes.
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
    return errorResponse('INVALID_BODY', 'depotId (uuid or null) is required.', 400);
  }

  try {
    const repo = getOpsRepo();
    const target = await repo.findUserById(targetId);
    if (!target) {
      return errorResponse('NOT_FOUND', 'User not found.', 404);
    }

    // Checked before the write even though ops_users_depot_id_fkey would
    // also reject it: a foreign-key violation surfaces as an unhandled 500,
    // and an admin mistyping a depot deserves a clear 404 rather than an
    // apparent server fault.
    if (parsed.data.depotId !== null) {
      const depot = await repo.findDepotById(parsed.data.depotId);
      if (!depot) {
        return errorResponse('DEPOT_NOT_FOUND', 'Depot not found.', 404);
      }
    }

    const updated = await repo.setUserDepot(targetId, parsed.data.depotId);
    if (!updated) {
      return errorResponse('NOT_FOUND', 'User not found.', 404);
    }

    await repo.recordAuditEvent({
      actorUserId: guard.claims.sub,
      actorRole: guard.claims.role,
      action: 'admin.user.depot_assign',
      resourceType: 'ops_user',
      resourceId: updated.id,
      metadata: { email: updated.email, depotId: updated.depotId },
      ip: clientIpFrom(request.headers),
    });

    return NextResponse.json(
      { ok: true, id: updated.id, depotId: updated.depotId },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }
}
