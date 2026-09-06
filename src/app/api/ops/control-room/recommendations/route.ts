import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isSameOrigin } from '@/lib/auth/origin';
import { ENGINE_ACTION_TYPES, ENGINE_ADVISORY_ACTION_TYPES } from '@/models/control';
import {
  solveRouteDirection,
  selectionBasisFor,
  ControlServiceResponseShapeError,
} from '@/lib/controlService/recommendations';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/control-room/recommendations — ask the decision engine what
 * it would do about one route-direction, right now.
 *
 * WHY THIS ROUTE EXISTS. control-service has run a real five-tier headway
 * controller since the core data model landed, and until this route nothing
 * in the product had ever called it. The control room's only command entry
 * point was a free-text form in which an operator typed an action type, a
 * vehicle registration and a route-direction uuid from memory
 * (src/components/ops/control-room/ControlRoomCommandForm.tsx). The
 * intelligence was already built and simply unreachable.
 *
 * WHY POST FOR A READ. The solve mutates nothing — it reads the in-memory
 * state store plus the active-command set. It is a POST because it is a
 * computation over a request body, because it must never be cached at any
 * layer (the engine's safety filter grades candidate freshness against the
 * clock at solve time, so a replayed response carries an expired verdict),
 * and because the same-origin and content-type gates every other operator-
 * initiated control-room call goes through are worth having on the one call
 * that tells an operator which bus to hold.
 *
 * WHAT IT DOES NOT DO, ON PURPOSE:
 *
 *  - It never issues anything. There is no path from this handler to a
 *    command. A returned action is a proposal; making it real still needs a
 *    human dispatcher approval and POST /api/ops/control-room/commands,
 *    where the APPROVAL_MISMATCH cross-check compares the command against
 *    the approval field by field. That check is untouched by this work and
 *    keeps working the same way for an engine-originated proposal as for a
 *    hand-typed one, because an engine proposal reaches it as ordinary
 *    request fields with no privileged path: an operator who approves
 *    `two_way_hold` on UP25FT4823 and then submits anything else is still
 *    refused. Prefilling that form from `selectedAction` is the point of
 *    this endpoint; bypassing the approval is not, and cannot be done from
 *    here.
 *  - It never persists. Nothing is written to control-service's
 *    `recommendations` table (see the note on `persistence` in the response
 *    contract, and the handover notes for the recommendation on when it
 *    should be).
 *  - It never widens the fleet boundary. `control_room` only, which
 *    src/lib/ops/depotAccess.ts already resolves to the statewide scope;
 *    a `depot`-role caller is refused here by role, so this route cannot be
 *    the hole in the depot ownership boundary. It also takes no depot
 *    parameter of any kind, and returns only vehicles the engine itself
 *    named for the requested route-direction.
 */

const bodySchema = z.object({
  routeDirectionId: z.string().uuid(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Maps a decision-engine failure onto this app's codes, keeping the distinctions an operator acts on differently. */
function mapControlServiceError(error: unknown): NextResponse | null {
  if (error instanceof ControlServiceConfigError) {
    return errorResponse('NOT_CONFIGURED', 'The decision engine is not configured.', 503);
  }
  if (error instanceof ControlServiceUnavailableError) {
    return errorResponse(
      'CONTROL_SERVICE_UNAVAILABLE',
      'The decision engine is temporarily unreachable; no recommendation is available right now.',
      503,
    );
  }
  if (error instanceof ControlServiceResponseShapeError) {
    return errorResponse('CONTROL_SERVICE_ERROR', error.message, 502);
  }
  if (error instanceof ControlServiceRequestError) {
    switch (error.code) {
      case 'no_active_policy':
        // Not a fault. This route-direction has no active route_policies row,
        // so there is no target headway to regulate toward and no control law
        // can run. The operator needs to know that specifically, because the
        // fix is a policy, not a retry.
        return errorResponse('NO_ACTIVE_POLICY', error.message, 404);
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

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    // Same self-identifying refusal POST .../commands gives for the same
    // field, and for a related reason: the route-direction is what the
    // engine's whole answer is scoped to, and what the kill-switch read
    // below is checked against.
    return errorResponse(
      'ROUTE_DIRECTION_REQUIRED',
      'routeDirectionId is required and must be a uuid.',
      422,
    );
  }
  const { routeDirectionId } = parsed.data;

  let result;
  try {
    result = await solveRouteDirection(routeDirectionId);
  } catch (error) {
    const mapped = mapControlServiceError(error);
    if (mapped) return mapped;
    throw error;
  }

  // Whether a command could be issued at all right now, read from this app's
  // own kill-switch table — the same read POST .../commands does before it
  // dispatches. Returned alongside the recommendation so the console cannot
  // offer an "approve this" affordance for an action the very next request
  // would refuse with KILL_SWITCH_ENGAGED. It never suppresses or alters the
  // recommendation: an operator watching a halted route still needs to see
  // what the engine thinks is happening.
  let commandsBlockedBy: {
    scope: 'network' | 'route';
    routeDirectionId: string | null;
    reason: string;
    engagedAt: string;
  } | null = null;
  try {
    const [blocking] = await getOpsRepo().getActiveKillSwitches(routeDirectionId);
    if (blocking) {
      commandsBlockedBy = {
        scope: blocking.scope,
        routeDirectionId: blocking.routeDirectionId,
        reason: blocking.reason,
        engagedAt: blocking.engagedAt,
      };
    }
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    throw error;
  }

  return NextResponse.json(
    {
      routeDirectionId: result.routeDirectionId,
      solvedAt: new Date().toISOString(),
      controllerVersion: result.controllerVersion,
      /**
       * The complete set of actions this engine can ever propose — three
       * action types. Sent on every response so a console can state the
       * boundary from DATA instead of hardcoding a claim that could drift.
       *
       * That drift is not hypothetical: this comment used to name
       * `boarding_limit` among the human-originated instructions, and the
       * engine now generates it (alighting-only). The console never repeated
       * the stale claim, because `humanOriginatedActions` derives the
       * human-only set by SUBTRACTING this list rather than hardcoding it —
       * which is exactly the drift that design was for.
       */
      engineActionTypes: ENGINE_ACTION_TYPES,
      /**
       * What the engine WORKS OUT but never ranks — pace guidance.
       *
       * Sent as its own list rather than folded into `engineActionTypes`
       * because the two carry different promises. An entry in that list is
       * ranked, approvable and delivered to a driver's screen; an entry here
       * is computed, shown to a dispatcher, and has no delivery path at all.
       * Merging them would have the consoles promise an in-cab display this
       * system does not have.
       *
       * A console subtracts BOTH from the nine dispatchable types to decide
       * what nothing generates. Before this field existed that subtraction
       * used one list, and both consoles told an operator that nothing in
       * this system works out speed guidance while the alert panel two
       * clicks away was rendering exactly that.
       */
      engineAdvisoryActionTypes: ENGINE_ADVISORY_ACTION_TYPES,
      selectedAction: result.selectedAction,
      selectionBasis: selectionBasisFor(result),
      objectiveCost: result.objectiveCost,
      expectedRecoverySeconds: result.expectedRecoverySeconds,
      candidateActions: result.candidateActions,
      safeCandidates: result.safeCandidates,
      rejectedCandidates: result.rejectedCandidates,
      predictiveAdvisory: result.predictiveAdvisory,
      /**
       * The two levers that fix bunching without adding delay, forwarded so
       * the console can offer them alongside the hold. Neither is auto-
       * selected — see AlertSolutionPanel's `AlternativeActions` for why
       * ranking them against the holds would misrepresent both.
       */
      boardingLimitCandidates: result.boardingLimitCandidates,
      paceAdvisories: result.paceAdvisories,
      constraints: result.constraints,
      commandsBlockedBy,
      /** Nothing about this solve was written down. A console must not describe it as an audited record. */
      persistence: 'none' as const,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
