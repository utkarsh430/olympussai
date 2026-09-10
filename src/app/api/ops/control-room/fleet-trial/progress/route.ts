import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { readFleetTrialProgress } from '@/lib/controlService/fleetTrial';
import { errorResponse, mapControlServiceError } from '@/lib/controlService/fleetTrialErrors';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/control-room/fleet-trial/progress - what the running trial is doing.
 *
 * ─── WHY THIS CAN BE ANSWERED AT ALL ─────────────────────────────────────
 *
 * `runFleetTrial` on the control service is a synchronous 30-second
 * computation, so for most of this repo's life that process answered NOTHING
 * while a trial ran - not this, not `/healthz`, not another console's read.
 * It answers now because the trial runs on a worker thread there. This route
 * is the reason that change was made.
 *
 * ─── GET, AND WHY THE SAME-ORIGIN GATE IS NOT HERE ───────────────────────
 *
 * Unlike the POST beside it this is a read: it starts nothing, changes
 * nothing, and returns a run id, a count and a clock. It carries no CSRF
 * surface to protect, so it takes the same shape as every other ops read -
 * role-guarded, never cached.
 *
 * ─── WHAT A FAILURE HERE MEANS, WHICH IS ALMOST NOTHING ──────────────────
 *
 * The console treats a failed poll as "no detail this second", never as a
 * failed trial: the POST is what decides whether the run succeeded, and a
 * progress read that fails while the trial is fine would otherwise report a
 * healthy run as broken. That rule lives in the console; this route's job is
 * only to answer honestly or say it could not.
 */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['control_room']);
  if (!guard.ok) return guard.response;

  try {
    const progress = await readFleetTrialProgress();
    return NextResponse.json(progress, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const mapped = mapControlServiceError(error);
    if (mapped) return mapped;
    return errorResponse('CONTROL_SERVICE_ERROR', 'The trial progress could not be read.', 502);
  }
}
