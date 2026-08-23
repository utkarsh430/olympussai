import 'server-only';

/**
 * The fleet trial: reading it, and running one.
 *
 * Layered on `fetchControlService` like every other client here, so it
 * inherits the shared circuit breaker.
 *
 * ─── WHY THE TIMEOUT IS RAISED, AND ONLY HERE ────────────────────────────
 *
 * The shared default is 8 s, sized for a live read on an operator's polling
 * loop. A trial simulates a thousand buses across twenty scenario runs and
 * takes a couple of seconds on the control service, but it is a COMPUTATION an
 * operator has deliberately started rather than a poll, and the failure mode of
 * timing it out is the worst available one: the work completes on the service,
 * is cached there, and the operator is told it failed. The raised budget is
 * still finite, and it is passed per call rather than by changing the shared
 * default - nothing else in this console should wait 30 s for anything.
 *
 * ─── NOTHING HERE ISSUES ANYTHING ────────────────────────────────────────
 *
 * Structural, not a discipline. The endpoint this calls builds its corridor by
 * arithmetic and runs pure functions over it: there is no code path from it to
 * a command, an incident, a headway sample, or any write at all - it does not
 * even read the database.
 */
import { fetchControlService } from './client';
import { ControlServiceResponseShapeError } from './commands';
import {
  fleetTrialReportSchema,
  type FleetTrialReport,
  type FleetTrialRequest,
} from '@/models/fleetTrial';

export { ControlServiceResponseShapeError };

/** Long enough for a thousand-bus run, short enough that a hung service still fails. */
const FLEET_TRIAL_TIMEOUT_MS = 30_000;

function parse(raw: unknown): FleetTrialReport {
  const parsed = fleetTrialReportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ControlServiceResponseShapeError(
      `Control service returned an unexpected fleet trial report: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/**
 * The last trial the control service ran, or null when it has run none.
 *
 * Null is a real state and is NOT an error: a freshly restarted service has no
 * report, and the page's job then is to offer to run one rather than to show a
 * failure. Every other failure still throws.
 */
export async function readLatestFleetTrial(): Promise<FleetTrialReport | null> {
  try {
    return parse(await fetchControlService('/v1/fleet-trial/latest'));
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'no_trial_run'
    ) {
      return null;
    }
    throw error;
  }
}

export async function runFleetTrial(request: FleetTrialRequest): Promise<FleetTrialReport> {
  return parse(
    await fetchControlService('/v1/fleet-trial', {
      method: 'POST',
      body: request,
      timeoutMs: FLEET_TRIAL_TIMEOUT_MS,
    }),
  );
}
