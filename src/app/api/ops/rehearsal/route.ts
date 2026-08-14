import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { isSameOrigin } from '@/lib/auth/origin';
import { rehearsalRequestSchema } from '@/models/rehearsal';
import { runRehearsal, ControlServiceResponseShapeError } from '@/lib/controlService/rehearsalData';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/rehearsal - rehearse a control strategy on one real
 * corridor.
 *
 * WHY POST FOR SOMETHING THAT WRITES NOTHING. Same three reasons as
 * /api/ops/control-room/recommendations: it is a computation over a request
 * body, it must never be cached at any layer, and the same-origin and
 * content-type gates are worth having on any operator-initiated call.
 *
 * WHAT IT CANNOT DO. There is no path from this handler to a command, an
 * incident, a headway sample or any other write. The control-service
 * endpoint it calls runs an in-memory simulator over SELECTed corridor data
 * and returns plain JSON; the simulator module itself imports nothing from
 * that service's database, state store or command path.
 *
 * WHY IT IS NOT DEPOT-SCOPED. It returns no vehicle. Every bus in the
 * result is invented by the simulator and carries a `SIM-` identifier;
 * nothing here reads `vehicle_states`, so there is no fleet to narrow. The
 * corridor list it complements is the statewide route-direction list the
 * depot console already reads for the same purpose. If this route ever
 * grows a real-vehicle input, it acquires the depot boundary with it - that
 * is why the point is written down here rather than left to be inferred
 * from the absence of a filter.
 *
 * WHY 404 IS AN ANSWER AND NOT A FAULT. 561 of the 759 seeded corridors
 * have no MEASURED target headway. Every bunching threshold in this system
 * is a ratio of that number, so a run against their sentinel would produce
 * a complete set of confident-looking results from a denominator nobody
 * measured. The control service refuses those corridors through the same
 * reader live detection uses, and that refusal is passed through here with
 * its explanation intact so the surface can print it.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function mapControlServiceError(error: unknown): NextResponse | null {
  if (error instanceof ControlServiceConfigError) {
    return errorResponse('NOT_CONFIGURED', 'The simulator service is not configured.', 503);
  }
  if (error instanceof ControlServiceUnavailableError) {
    return errorResponse(
      'CONTROL_SERVICE_UNAVAILABLE',
      'The simulator service is temporarily unreachable; no run is available right now.',
      503,
    );
  }
  if (error instanceof ControlServiceResponseShapeError) {
    return errorResponse('CONTROL_SERVICE_ERROR', error.message, 502);
  }
  if (error instanceof ControlServiceRequestError) {
    switch (error.code) {
      case 'no_active_policy':
        return errorResponse('UNCALIBRATED_CORRIDOR', error.message, 404);
      case 'corridor_too_short':
      case 'route_direction_not_found':
        return errorResponse(error.code.toUpperCase(), error.message, error.status ?? 404);
      case 'invalid_request':
        return errorResponse('INVALID_BODY', error.message, 400);
      default:
        return errorResponse('CONTROL_SERVICE_ERROR', error.message, error.status ?? 502);
    }
  }
  return null;
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('INVALID_ORIGIN', 'Invalid request origin.', 403);
  }

  // Same authority as the page itself: an ACTIVE ops profile, re-read from
  // ops_users per request. The page guard is not trusted to have run.
  const guard = await requireUpsrtcAccess();
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

  const parsed = rehearsalRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      'INVALID_BODY',
      'routeDirectionId must be a uuid, and every simulation input must be inside its stated range.',
      422,
    );
  }

  try {
    const result = await runRehearsal(parsed.data);
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const mapped = mapControlServiceError(error);
    if (mapped) return mapped;
    throw error;
  }
}
