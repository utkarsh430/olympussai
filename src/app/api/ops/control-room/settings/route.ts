import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { isSameOrigin } from '@/lib/auth/origin';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';
import { ControlServiceResponseShapeError } from '@/lib/controlService/commands';
import { readControlSettings, writeControlSettings } from '@/lib/controlService/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  weighOccupancy: z.boolean(),
  /**
   * Why. Required and non-empty, matching control-service's own schema and
   * the precedent ops_kill_switches set: a change to what the controller
   * optimises across the whole network is always an explained human decision.
   * The value of this row in six months is entirely in this field.
   *
   * Note `updatedBy` is NOT accepted here. It comes from the session below.
   */
  updateReason: z.string().trim().min(1).max(2000),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function mapUpstreamError(error: unknown): Response {
  if (error instanceof ControlServiceConfigError) {
    return errorResponse('NOT_CONFIGURED', 'The control service is not configured.', 503);
  }
  if (error instanceof ControlServiceUnavailableError) {
    return errorResponse(
      'UNAVAILABLE',
      'The control service did not answer, so the current setting is unknown.',
      503,
    );
  }
  if (error instanceof ControlServiceResponseShapeError) {
    return errorResponse('BAD_UPSTREAM', 'The control service answered in an unrecognised shape.', 502);
  }
  if (error instanceof ControlServiceRequestError) {
    return errorResponse('UPSTREAM_REFUSED', error.message, 502);
  }
  throw error;
}

/**
 * GET /api/ops/control-room/settings — what the controller is currently
 * optimising, and who last changed it.
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  try {
    return NextResponse.json(await readControlSettings(), {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return mapUpstreamError(error);
  }
}

/**
 * PUT /api/ops/control-room/settings — flip the occupancy switch.
 *
 * ─── WHY THE ACTOR IS NOT IN THE BODY ────────────────────────────────────
 *
 * `updatedBy` is taken from the resolved session, never from the request.
 * An audit field a client can set is not an audit field — it records whatever
 * the caller typed, which is precisely the value it has no reason to be
 * trusted on. This is the same reason dispatcher approvals carry the
 * server-resolved operator rather than a submitted name.
 *
 * ─── AND WHY THE SAME-ORIGIN GATE ────────────────────────────────────────
 *
 * This is a state-changing request on a control surface, so it goes through
 * the same origin check as every other operator-initiated control-room write.
 * Flipping this switch changes how the engine decides on every corridor.
 */
export async function PUT(request: NextRequest): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  if (!isSameOrigin(request)) {
    return errorResponse('FORBIDDEN', 'Cross-origin requests are not allowed here.', 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Expected a JSON body.', 400);
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      'INVALID_BODY',
      'A reason is required for changing what the controller optimises.',
      400,
    );
  }

  try {
    const settings = await writeControlSettings({
      weighOccupancy: parsed.data.weighOccupancy,
      updatedBy: guard.claims.email,
      updateReason: parsed.data.updateReason,
    });
    return NextResponse.json(settings, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return mapUpstreamError(error);
  }
}
