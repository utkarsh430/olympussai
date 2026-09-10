import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { isSameOrigin } from '@/lib/auth/origin';
import { fleetTrialRequestSchema } from '@/models/fleetTrial';
import { runFleetTrial } from '@/lib/controlService/fleetTrial';
import { errorResponse, mapControlServiceError } from '@/lib/controlService/fleetTrialErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/control-room/fleet-trial - run the controller trial.
 *
 * WHY POST FOR SOMETHING THAT WRITES NOTHING. Same reasons as
 * /api/ops/rehearsal: it is a computation over a request body, it must never
 * be cached at any layer, and the same-origin and content-type gates are worth
 * having on any operator-initiated call.
 *
 * WHY control_room ONLY. The trial's subject is the control laws themselves,
 * and the question it answers - should the network be run this way - is the
 * control room's to ask. It is not depot-scoped because it returns no real
 * vehicle: every bus in the result is invented by the simulator and carries a
 * `BUS-` identifier. The role is derived from the URL segment by
 * `rolesForOpsApiPath`, and `requireOpsRole` below is the authoritative check.
 */

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  const guard = await requireOpsRole(['control_room']);
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

  const parsed = fleetTrialRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      'INVALID_BODY',
      'Every trial input must be inside its stated range, and every scenario must be one the library defines.',
      422,
    );
  }

  try {
    const report = await runFleetTrial(parsed.data);
    return NextResponse.json(report, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const mapped = mapControlServiceError(error);
    if (mapped) return mapped;
    throw error;
  }
}
