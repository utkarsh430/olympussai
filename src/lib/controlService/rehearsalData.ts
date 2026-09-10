import 'server-only';

/**
 * Control-strategy rehearsal: the corridor picker's data, and the run.
 *
 * Layered on fetchControlService like every other client here, so it
 * inherits the 8s timeout and the shared circuit breaker, and Zod-validated
 * before anything trusts the shape.
 *
 * NO CACHING, and for a different reason from recommendations.ts. A
 * rehearsal is deterministic: the same corridor, inputs and seed always
 * produce the same answer, so a cache would be safe. It has none because
 * there is nothing to cache FOR - the operator changes an input precisely
 * in order to get a different answer, and the run costs single-digit
 * milliseconds on the control service. A cache here would only add a way for
 * the surface to show a result that does not match the inputs beside it.
 *
 * NOTHING HERE ISSUES ANYTHING, and unlike recommendations.ts that is not a
 * discipline but a structural fact: the endpoint this calls runs an isolated
 * in-memory simulator over SELECTed data. There is no code path from it to a
 * command, an incident, or any write at all.
 */
import { fetchControlService } from './client';
import { ControlServiceResponseShapeError } from './commands';
import { routeDirectionsResponseSchema, type RouteDirectionMeta } from '@/models/control';
import { rehearsalResultSchema, type RehearsalRequest, type RehearsalResult } from '@/models/rehearsal';

export { ControlServiceResponseShapeError };

/**
 * Every corridor, with whether it can be rehearsed at all.
 *
 * `hasActivePolicy` is the SAME flag the depot console's corridor list and
 * the live headway endpoint agree on: it is false exactly when
 * `calibration_source = 'none'`, which is the 561 route-directions carrying
 * a sentinel target headway rather than a measured one. The picker uses it
 * to say so up front instead of letting an operator choose a corridor and
 * then be refused - and the refusal still exists behind it, because a list
 * is a convenience and never the boundary.
 *
 * `undefined` means an older control service that does not report policy
 * state at all, which is not the same as false and is not flattened into it.
 */
export async function listRehearsalCorridors(): Promise<RouteDirectionMeta[]> {
  const raw = await fetchControlService('/v1/route-directions');
  const parsed = routeDirectionsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ControlServiceResponseShapeError(
      `Control service returned an unexpected route-direction list: ${parsed.error.message}`,
    );
  }
  return parsed.data.routeDirections;
}

/**
 * Runs one rehearsal.
 *
 * Throws rather than degrading, so the caller can tell the operator which of
 * these it is:
 *   ControlServiceConfigError       the control service is not configured
 *   ControlServiceUnavailableError  the family below; catching it still
 *                                   catches all three
 *   ControlServiceTimeoutError      THIS request ran out of its own time;
 *                                   the service may be healthy and working
 *   ControlServiceCircuitOpenError  this process has stopped calling, after
 *                                   a measured streak of real failures
 *   ControlServiceRequestError      it answered and refused;
 *                                   `code: 'no_active_policy'` (404) is the
 *                                   important one - this corridor has no
 *                                   MEASURED target headway, so there is
 *                                   nothing to simulate against and the
 *                                   answer is a refusal, not a default.
 */
export async function runRehearsal(request: RehearsalRequest): Promise<RehearsalResult> {
  const { routeDirectionId, ...inputs } = request;
  const raw = await fetchControlService(
    `/v1/route-directions/${encodeURIComponent(routeDirectionId)}/rehearsal`,
    { method: 'POST', body: inputs },
  );

  const parsed = rehearsalResultSchema.safeParse(raw);
  if (!parsed.success) {
    // Refused rather than rendered partially. This surface's entire claim is
    // that a reader can tell a measurement from a model; a payload whose
    // provenance manifest did not arrive intact cannot support that claim,
    // and showing the numbers without it would be the exact failure the
    // whole design exists to prevent.
    throw new ControlServiceResponseShapeError(
      `Control service returned an unexpected rehearsal result: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
