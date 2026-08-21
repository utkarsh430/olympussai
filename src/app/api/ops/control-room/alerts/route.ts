import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';
import { ControlServiceResponseShapeError } from '@/lib/controlService/commands';
import { readAlertFeed, ALERT_PAGE_LIMIT } from '@/lib/controlService/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * GET /api/ops/control-room/alerts — every open bunching alert on the
 * network, worst and soonest first.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * Bunching detection has run on a timer since the core data model. Until this
 * route the only way to see what it found was the console's per-corridor
 * panel, which required an operator to have already chosen the corridor the
 * incident was on. Across ~1,020 active route-directions that made noticing a
 * matter of luck. This is the read that shows the whole population at once.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────
 *
 * Propose anything. The feed says WHAT is wrong and WHERE; it runs no control
 * law and returns no hold. Asking for a solution is a separate, explicit act
 * by a human on one alert (POST /api/ops/control-room/recommendations), and
 * turning that proposal into a live instruction still needs a dispatcher's
 * approval and the APPROVAL_MISMATCH cross-check on top.
 *
 * That separation is not ceremony. Solving is the expensive half - a solve
 * per corridor per page load would run the control laws across the entire
 * network every time an operator glanced at the list, and the resulting
 * proposals would go stale in the 90 s the safety filter gives them while
 * nobody was reading them. Detection is cheap and standing; solving is
 * on-demand and fresh.
 *
 * ─── ROLE ────────────────────────────────────────────────────────────────
 *
 * `control_room` only, matching the recommendations route this feed leads
 * into. The segment-derived default already resolves to exactly that, so no
 * OPS_API_ROLE_OVERRIDES entry is needed or wanted - see
 * src/lib/auth/rbac/roles.ts on why the override map must only ever widen a
 * segment's role deliberately.
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  try {
    const { feed, stale, ageMs } = await readAlertFeed(ALERT_PAGE_LIMIT);
    return NextResponse.json(
      { ...feed, stale, ageMs },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ControlServiceConfigError) {
      return errorResponse('NOT_CONFIGURED', 'The control service is not configured.', 503);
    }
    // Only reachable with no last-good feed to fall back on - i.e. this
    // process has never had a successful read. Everything after that serves
    // the previous feed flagged stale, because an alert list that empties
    // itself during an outage is indistinguishable from an all-clear.
    if (error instanceof ControlServiceUnavailableError) {
      return errorResponse('UNAVAILABLE', 'The control service did not answer, so this list is unknown - not empty.', 503);
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
