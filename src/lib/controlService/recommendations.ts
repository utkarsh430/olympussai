import 'server-only';

/**
 * The decision engine, reachable from the product for the first time.
 *
 * control-service has carried a five-tier headway controller since the core
 * data model landed (control-service/src/mpc/: terminal dispatch regulation,
 * two-way holding, self-equalizing fallback, a hard safety filter, and an
 * occupancy-weighted advisory), exposed at POST /v1/mpc/solve. No route
 * handler, lib module or component in this app had ever called it. An
 * operator's only way to act was to hand-type an action type, a vehicle id
 * and a route-direction uuid into a free-text form. This module is the
 * missing call.
 *
 * Layered on fetchControlService like every other client here, so it
 * inherits the 8s timeout and the shared circuit breaker
 * (src/lib/controlService/client.ts). Zod-validated before anything trusts
 * the shape, like createCommand.ts — fetchControlService only guarantees
 * that valid JSON came back.
 *
 * NO CACHING, AND THAT IS THE POINT. Every other read client in this
 * directory (observabilityData.ts, routeBoardData.ts, pilotData.ts) keeps a
 * short TtlCache and serves the last good snapshot when the control service
 * is unreachable, because a dashboard showing slightly old numbers beats a
 * dashboard showing nothing. A recommendation is not a dashboard number. The
 * solver's hard safety filter grades every candidate's freshness against the
 * wall clock at solve time (control-service/src/mpc/safety.ts, 90s bound), so
 * a cached recommendation is one whose own safety verdict has quietly
 * expired — it would keep proposing a hold on a bus nobody has heard from,
 * with the "safe" stamp it earned when the reading was fresh. When the
 * engine cannot be reached, the honest answer is that there is no
 * recommendation right now, and the caller says so.
 *
 * NOTHING HERE ISSUES ANYTHING. The result is a proposal. Turning one into a
 * live command still goes the whole way round the existing path: a human
 * dispatcher approval, the APPROVAL_MISMATCH cross-check, the kill switch,
 * and POST /api/ops/control-room/commands. See that route.
 */
import { fetchControlService } from './client';
import { ControlServiceResponseShapeError } from './commands';
import { mpcSolveResultSchema, type MpcSolveResult } from '@/models/control';

export { ControlServiceResponseShapeError };

const SOLVE_PATH = '/v1/mpc/solve';

/**
 * Runs one decision-engine cycle for a route-direction and returns what it
 * proposed, what it refused, and why.
 *
 * Throws rather than degrading, so the caller can tell the operator which of
 * these it is:
 *   ControlServiceConfigError       the engine is not configured at all
 *   ControlServiceUnavailableError  the family below; catching it still
 *                                   catches all three
 *   ControlServiceTimeoutError      THIS request ran out of its own time;
 *                                   the service may be healthy and working
 *   ControlServiceCircuitOpenError  this process has stopped calling, after
 *                                   a measured streak of real failures
 *   ControlServiceRequestError      the engine answered and refused;
 *                                   `code: 'no_active_policy'` (404) means
 *                                   this route-direction has no active
 *                                   route_policies row, so there is no
 *                                   target headway to regulate toward and
 *                                   no control law can run
 *   ControlServiceResponseShapeError  the answer did not match the contract
 */
export async function solveRouteDirection(routeDirectionId: string): Promise<MpcSolveResult> {
  const payload = await fetchControlService(SOLVE_PATH, {
    method: 'POST',
    body: { routeDirectionId },
  });
  const parsed = mpcSolveResultSchema.safeParse(payload);
  if (!parsed.success) throw new ControlServiceResponseShapeError(SOLVE_PATH);
  return parsed.data;
}

/**
 * Why the engine settled on what it settled on, derived from the result the
 * solver already returned rather than by re-running its selection rule.
 *
 *  - `terminal_dispatch_priority`  a safe terminal-dispatch hold existed, and
 *    terminal dispatch is the control hierarchy's default first line: it is
 *    always preferred over mid-route holding, even when a mid-route candidate
 *    scores lower, because holding a bus that is already stationary at the
 *    origin is the least disruptive lever available.
 *  - `lowest_cost_mid_route`  no terminal candidate was available, so the
 *    cheapest safe two-way / self-equalizing hold won.
 *  - `all_candidates_rejected`  the control laws did propose actions and the
 *    hard safety filter refused every one. THIS IS NOT "nothing is wrong" —
 *    it is the engine declining to act on unsafe inputs, and the rejection
 *    reasons are the operator's evidence.
 *  - `no_candidates`  no control law produced anything: on a headway-managed
 *    route this normally means the service is spaced at or beyond target and
 *    there is nothing to regulate.
 */
export type SelectionBasis =
  | 'terminal_dispatch_priority'
  | 'lowest_cost_mid_route'
  | 'all_candidates_rejected'
  | 'no_candidates';

export function selectionBasisFor(result: MpcSolveResult): SelectionBasis {
  if (result.selectedAction) {
    return result.selectedAction.actionType === 'terminal_dispatch_hold'
      ? 'terminal_dispatch_priority'
      : 'lowest_cost_mid_route';
  }
  return result.candidateActions.length > 0 ? 'all_candidates_rejected' : 'no_candidates';
}
