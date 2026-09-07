import 'server-only';

/**
 * The fleet trial: reading it, and running one.
 *
 * Layered on `fetchControlService` like every other client here, so it
 * inherits the shared circuit breaker - with ONE exemption, described below,
 * that exists because sharing it turned out to be the expensive part.
 *
 * ─── WHY THE TIMEOUT IS RAISED, AND ONLY HERE ────────────────────────────
 *
 * The shared default is 8 s, sized for a live read on an operator's polling
 * loop. A trial is a COMPUTATION an operator has deliberately started rather
 * than a poll, and this header already named the failure mode of timing one
 * out - "the work completes on the service, is cached there, and the operator
 * is told it failed" - and then set a budget that produced it anyway, because
 * the trial was believed to take "a couple of seconds". MEASURED, the
 * inter-city preset at 1,000 buses per phase takes about 32 s against what was
 * a 30 s budget. The prediction was right; the number was wrong.
 *
 * Two things follow, and neither is just a bigger number. The budget is now
 * 180 s, and a timeout on this call is reported as `ControlServiceTimeoutError`
 * rather than as an unreachable service - they have opposite fixes, and the
 * console says which one this is. And this call's own deadline no longer
 * counts toward the SHARED breaker: it trips at three failures and is read by
 * every control-service consumer in the process, so three trials in a row
 * would have taken the alert inbox and the command path dark over a service
 * that never missed a beat.
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
  fleetTrialProgressSchema,
  type FleetTrialReport,
  type FleetTrialProgressResponse,
  type FleetTrialRequest,
} from '@/models/fleetTrial';

export { ControlServiceResponseShapeError };

/**
 * Long enough for a thousand-bus run, short enough that a hung service fails.
 *
 * THIS NUMBER WAS WRONG AND THE WRONGNESS WAS EXPENSIVE. It was 30 s, chosen
 * against a comment that said a trial "takes a couple of seconds". Measured,
 * the inter-city preset at 1,000 buses per phase takes about 32 - so the
 * console reliably timed out its own trial, reported the healthy service it
 * was talking to as unreachable, and sent a supervisor looking at the wrong
 * machine while the run it had abandoned completed and was cached.
 *
 * 180 s is sized from the measurement at the LARGEST run this console can ask
 * for - the 400 km inter-city preset at 1,000 buses per phase, the maximum the
 * request schema accepts - which took 32.9 s end to end over HTTP. That is
 * about five and a half times headroom, and it is deliberately not tight: the
 * budget is not an estimate of how long a trial takes, it is a bound on how
 * long this client waits before deciding nothing is coming at all. The
 * operator is not staring at an unmarked wait either way, because the console
 * polls `readFleetTrialProgress` and shows the stage, the run count and the
 * elapsed time throughout - so nothing is bought by making it tight, and a
 * repeat of the 30-vs-32 failure is what is bought by getting it wrong.
 */
const FLEET_TRIAL_TIMEOUT_MS = 180_000;

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
      // A deadline WE chose for a call we know is slow. It is reported as a
      // timeout rather than an outage, and it does not move the breaker the
      // whole console shares - see `deadlineIsOurs`.
      deadlineIsOurs: true,
    }),
  );
}

/**
 * What the trial running right now is doing, or that none is.
 *
 * Polled by the console about once a second while a run is in flight, so it
 * keeps the SHARED 8 s budget: a progress read that is slow is a read this
 * console should give up on and try again, not one to wait out.
 *
 * This endpoint answers DURING a trial, which is not a small claim -
 * `runFleetTrial` on the control service is synchronous and used to block that
 * process entirely for the thirty seconds it ran. It answers because the trial
 * now runs on a worker thread there.
 */
export async function readFleetTrialProgress(): Promise<FleetTrialProgressResponse> {
  const parsed = fleetTrialProgressSchema.safeParse(
    await fetchControlService('/v1/fleet-trial/progress'),
  );
  if (!parsed.success) {
    throw new ControlServiceResponseShapeError(
      `Control service returned an unexpected fleet trial progress payload: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
