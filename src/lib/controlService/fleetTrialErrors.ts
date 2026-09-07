import 'server-only';

/**
 * How a control-service failure reaches the simulator console, in words an
 * operator can act on.
 *
 * Shared by the two fleet-trial routes rather than exported from one of them:
 * a Next route module may only export its handlers and its segment config, so
 * a helper two routes need lives here.
 *
 * ─── THE DISTINCTION THIS FILE EXISTS FOR ────────────────────────────────
 *
 * THREE conditions were one message. This client's own doc comments described
 * `ControlServiceUnavailableError` as meaning "unreachable, timed out, or
 * circuit open" - and an operator reading "temporarily unreachable" cannot
 * tell whether to go and look at the service, wait a moment, or escalate.
 *
 * "The service could not be reached" and "we stopped waiting" were the pair
 * that went wrong in practice. The console set a 30 s budget against a comment
 * claiming a trial took "a couple of seconds"; measured, the inter-city preset
 * at 1,000 buses per phase takes about 32. So the console timed out its own
 * trial and reported the healthy, answering service as unreachable - and the
 * run it had given up on finished and was cached on the other side. The two
 * have opposite fixes: one needs somebody to look at the service, the other
 * needs nothing but a moment's patience.
 */
import { NextResponse } from 'next/server';
import { ControlServiceResponseShapeError } from '@/lib/controlService/fleetTrial';
import {
  ControlServiceCircuitOpenError,
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceTimeoutError,
  ControlServiceUnavailableError,
} from '@/lib/controlService/client';

export function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function mapControlServiceError(error: unknown): NextResponse | null {
  if (error instanceof ControlServiceConfigError) {
    return errorResponse('NOT_CONFIGURED', 'The simulator service is not configured.', 503);
  }
  // Both of these extend ControlServiceUnavailableError, so both must be
  // tested BEFORE it or they collapse back into the message they were split
  // out of.
  if (error instanceof ControlServiceCircuitOpenError) {
    return errorResponse(
      'CONTROL_SERVICE_CIRCUIT_OPEN',
      `The console has stopped calling the simulator service after ${error.failures} failures in a row, and will keep refusing for about ${Math.ceil(
        error.openForMs / 1000,
      )} more seconds. Running a trial again now will not get through — this one needs somebody to look at the service.`,
      503,
    );
  }
  if (error instanceof ControlServiceTimeoutError) {
    return errorResponse(
      'CONTROL_SERVICE_TIMEOUT',
      'The console stopped waiting for this trial. The simulator service was answering, so the run is probably still going — give it a moment and reload to pick it up as the stored result.',
      504,
    );
  }
  if (error instanceof ControlServiceUnavailableError) {
    return errorResponse(
      'CONTROL_SERVICE_UNAVAILABLE',
      'The simulator service is temporarily unreachable; no trial can be run right now.',
      503,
    );
  }
  if (error instanceof ControlServiceResponseShapeError) {
    return errorResponse('CONTROL_SERVICE_ERROR', error.message, 502);
  }
  if (error instanceof ControlServiceRequestError) {
    if (error.code === 'invalid_request') return errorResponse('INVALID_BODY', error.message, 400);
    // One trial at a time, refused by the control service. Its own code
    // because nothing is wrong: somebody's run is in flight, and the console
    // says so rather than reporting a failure.
    if (error.code === 'trial_already_running') {
      return errorResponse('TRIAL_ALREADY_RUNNING', error.message, 409);
    }
    if (error.code === 'trial_failed') {
      return errorResponse('TRIAL_FAILED', error.message, 500);
    }
    return errorResponse('CONTROL_SERVICE_ERROR', error.message, error.status ?? 502);
  }
  return null;
}
