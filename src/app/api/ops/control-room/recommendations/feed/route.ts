import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';
import { ControlServiceResponseShapeError } from '@/lib/controlService/commands';
import {
  readStandingProposals,
  StandingProposalFeedDisabledError,
  STANDING_PROPOSAL_PAGE_LIMIT,
} from '@/lib/controlService/standingProposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * GET /api/ops/control-room/recommendations/feed — what the automatic decision
 * cycle currently says about every corridor it has looked at.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * control-service's `scheduler/decisionCycle.ts` has run every 90 seconds
 * since it landed, solving every eligible corridor and writing a
 * `recommendations` row. Nothing read that table. The only importer of the
 * write module in the whole service was the cycle itself, whose
 * `findLatestRecommendation` feeds its own duplicate check; no route served it
 * and no console fetched it. So every proposal a dispatcher ever saw came from
 * the SYNCHRONOUS solve on the sibling POST route, taken when they opened a
 * corridor themselves — which is precisely the "somebody has to be looking at
 * the right corridor at the right moment" problem the automatic cycle exists
 * to remove. Its output was written and discarded.
 *
 * ─── WHY IT IS A DIFFERENT ROUTE FROM ITS OWN PARENT ─────────────────────
 *
 * `POST /api/ops/control-room/recommendations` asks the engine what it would
 * do about ONE corridor, right now, and returns a proposal whose safety
 * verdict is graded against the current clock. This route returns records of
 * what the engine already said, across the network, each stamped with its own
 * age. They are different objects with different lifetimes and the same
 * handler could not honestly serve both: one is a live answer, the other is
 * history that says where to look. Nesting it under the same segment keeps the
 * RBAC derivation right — `control_room`, from the URL segment, with no
 * OPS_API_ROLE_OVERRIDES entry needed or wanted.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────
 *
 * Solve. It reads rows; it runs no control law. A solve per corridor per page
 * load would run the laws across the whole network every time an operator
 * glanced at a list, and every proposal would lapse in the 90 s the safety
 * filter gives it while nobody was reading.
 *
 * Issue. There is no path from this handler to a command, and the response
 * shape cannot carry an approvable candidate — see
 * `src/models/recommendationFeed.ts` on why the summary is structural and not
 * a convention. Turning any of this into an instruction still requires an
 * explicit live solve and a dispatcher approval through the unchanged path.
 *
 * ─── BEHIND A FLAG, DEFAULT OFF ──────────────────────────────────────────
 *
 * `RECOMMENDATION_FEED_ENABLED`. Off, this route answers 404 — the same thing
 * this path answered before it existed — without constructing a request,
 * reading a cache or touching the control service. The control service has its
 * own switch of the same name and does not mount its endpoint either.
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  try {
    const { feed, stale, ageMs } = await readStandingProposals(STANDING_PROPOSAL_PAGE_LIMIT);
    return NextResponse.json(
      { ...feed, stale, ageMs },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // Indistinguishable from the route not existing, on purpose: default-off
    // must not leave a discoverable endpoint that answers differently.
    if (error instanceof StandingProposalFeedDisabledError) {
      return errorResponse('NOT_FOUND', 'Not found.', 404);
    }
    if (error instanceof ControlServiceConfigError) {
      return errorResponse('NOT_CONFIGURED', 'The control service is not configured.', 503);
    }
    // Only reachable with no last-good feed to fall back on — this process has
    // never had a successful read. After that the previous feed is served
    // flagged stale, because a list that empties during an outage adds a third
    // meaning to a rendering that already has to distinguish "the controller
    // proposed nothing" from "the controller is not running".
    if (error instanceof ControlServiceUnavailableError) {
      return errorResponse(
        'UNAVAILABLE',
        'The control service did not answer, so what the automatic controller has proposed is unknown - not nothing.',
        503,
      );
    }
    if (error instanceof ControlServiceResponseShapeError) {
      return errorResponse('BAD_UPSTREAM', 'The control service answered in a shape this app does not recognise.', 502);
    }
    if (error instanceof ControlServiceRequestError) {
      return errorResponse('UPSTREAM_REFUSED', error.message, 502);
    }
    throw error;
  }
}
