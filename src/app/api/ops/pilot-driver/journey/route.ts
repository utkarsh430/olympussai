import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { fetchVehicleArrivals } from '@/lib/controlService/arrivals';
import { getOpsVehicleSchedule } from '@/lib/ops/fleetData';
import { joinScheduleToArrivals, type JourneyStop } from '@/lib/ops/driverJourney';
import {
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Upcoming stops shown to the driver. Enough for the next stretch of the working, not the whole day. */
const STOP_LIMIT = 6;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * GET /api/ops/pilot-driver/journey
 *
 * Everything the driver's route screen needs, in one request: the measured
 * per-stop prediction, and the published timetable beside it.
 *
 * ─── WHY THIS EXISTS ALONGSIDE /arrivals ─────────────────────────────────
 *
 * /api/ops/pilot-driver/arrivals is the pure prediction contract and stays
 * exactly as it is - nothing here changes it, and its own tests keep it
 * honest. This route composes that same reader with the upstream timetable,
 * because the screen needs both and they must be about the SAME bus.
 *
 * That last point is the reason this is one server-side route rather than two
 * client fetches. The timetable endpoint (/api/ops/fleet/schedule) takes a
 * registration from the caller and is open to every operational role, so a
 * client composing the two could - by accident or by editing a request - put
 * one bus's timetable beside another bus's predictions. Here both halves are
 * resolved from the caller's own ops_users row and cannot diverge. Like the
 * arrivals route, this takes NO parameters at all.
 *
 * ─── THE TWO HALVES ARE NOT EQUALS ───────────────────────────────────────
 *
 * The prediction is the payload; the timetable is context.
 *
 *   • A control-service failure is an OUTAGE: 503/502, no envelope. It is a
 *     different fact from "we looked and cannot predict this bus", and
 *     collapsing them would let an outage read on a driver's screen as a calm
 *     "no arrival times right now".
 *   • A timetable failure degrades to `schedule: null` and costs the driver
 *     nothing that was measured. Losing the upstream must not take the
 *     working predictions down with it.
 *
 * ─── THE STRUCTURAL GUARANTEE, PRESERVED ─────────────────────────────────
 *
 * `stops` is always present and is EMPTY whenever the prediction is a refusal,
 * exactly as `arrivals` is in the underlying envelope. A consumer that ignores
 * `prediction.status` and just maps the list renders nothing. The failure mode
 * of misreading this API is a blank space, never a confident wrong number.
 */
export interface DriverJourneyResponse {
  vehicleId: string;
  /** Every eta in `stops` is relative to THIS instant, not to when the client received it. */
  generatedAt: string;
  horizonSeconds: number;
  stopLimit: number;
  /**
   * The prediction envelope WITHOUT its arrivals - those are in `stops`,
   * joined to the timetable. Deliberately not duplicated: two copies of the
   * same list is two things that can disagree.
   */
  prediction: Record<string, unknown>;
  /** One entry per predicted stop, in the prediction's own order. Always empty on a refusal. */
  stops: JourneyStop[];
  /** The working this bus is on, for context above the stop list. Null when the upstream had nothing. */
  schedule: {
    routeName: string | null;
    originName: string | null;
    destinationName: string | null;
    /** Where the timetable came from, so the screen can say when it is a cached or fixture reading. */
    source: string;
    stale: boolean;
  } | null;
}

export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['pilot_driver']);
  if (!guard.ok) return guard.response;

  try {
    const user = await getOpsRepo().findUserById(guard.claims.sub);
    if (!user || !user.vehicleId) {
      return errorResponse(
        'VEHICLE_NOT_ASSIGNED',
        'No vehicle is assigned to your account yet. Contact your admin.',
        409,
      );
    }

    const vehicleId = user.vehicleId;
    const arrivals = await fetchVehicleArrivals(vehicleId, { limit: STOP_LIMIT });

    // Only after the prediction has succeeded, and never allowed to fail the
    // request. `getOpsVehicleSchedule` reports upstream trouble in its own
    // `error` field rather than throwing, but it reaches the network, so the
    // catch is here as well - a timetable is not worth a driver's arrival
    // times.
    const scheduleResult = await getOpsVehicleSchedule(vehicleId).catch(() => null);
    const schedule = scheduleResult?.schedule ?? null;

    const { arrivals: predictedStops, ...predictionContext } = arrivals.prediction;

    const body: DriverJourneyResponse = {
      vehicleId: arrivals.vehicleId,
      generatedAt: arrivals.generatedAt,
      horizonSeconds: arrivals.horizonSeconds,
      stopLimit: arrivals.stopLimit,
      prediction: predictionContext,
      stops: joinScheduleToArrivals(predictedStops, schedule?.stops ?? []),
      schedule: schedule
        ? {
            routeName: schedule.routeName,
            originName: schedule.originName,
            destinationName: schedule.destinationName,
            source: scheduleResult!.source,
            stale: scheduleResult!.stale,
          }
        : null,
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Ops authentication is not configured.', 503);
    }
    if (error instanceof ControlServiceConfigError) {
      return errorResponse('NOT_CONFIGURED', 'Control service is not configured.', 503);
    }
    if (error instanceof ControlServiceUnavailableError) {
      return errorResponse(
        'CONTROL_SERVICE_UNAVAILABLE',
        'Arrival times are unavailable because the control service cannot be reached.',
        503,
      );
    }
    if (error instanceof ControlServiceRequestError) {
      return errorResponse('CONTROL_SERVICE_ERROR', error.message, error.status ?? 502);
    }
    throw error;
  }
}
