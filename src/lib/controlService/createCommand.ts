import 'server-only';

/**
 * The one WRITE that actually issues an operational command: this app ->
 * control-service POST /v1/commands, plus the reconciliation read that makes
 * retrying it safe.
 *
 * Deliberately its own module rather than an addition to
 * src/lib/controlService/commands.ts: that file's doc comment scopes it to
 * the driver PWA's read-and-ack calls ("this app only ever reads/acks
 * commands"), which is no longer true of the app as a whole but is still
 * true of that module. Both layer on fetchControlService
 * (src/lib/controlService/client.ts) so they share its 8s timeout and
 * circuit breaker.
 *
 * THE BRIDGE. Until this module existed a human approval could never
 * authorize a real command. This app records approvals in its own
 * ops_dispatcher_actions table; control-service refuses to insert into
 * `commands` without a matching, unconsumed row in ITS OWN dispatcher_actions
 * table (dispatcher_action_id NOT NULL UNIQUE plus a BEFORE INSERT trigger),
 * and no control-service code path ever created one. createControlServiceCommand
 * closes that by mirroring THIS app's ops_dispatcher_actions.id into control's
 * dispatcher_actions inline on the same request, written in the same
 * transaction as the command.
 *
 * EXACTLY-ONCE, for free. Because the mirrored id is ours and control's
 * commands.dispatcher_action_id is already UNIQUE, a retry of the same
 * approval cannot create a second command: it hits a 23505 that control maps
 * to a 409 `dispatcher_action_already_used`. The caller
 * (src/app/api/ops/control-room/commands/route.ts) treats that 409 as "the
 * first attempt actually landed", calls fetchCommandByDispatcherAction to
 * learn which command that was, and reports success. A control-generated id
 * would have made every retry-after-timeout a second live command on the same
 * bus — and with an 8s timeout in front of this call, timeouts are routine.
 *
 * Every response is Zod-validated here before a route handler trusts its
 * shape; fetchControlService only guarantees that valid JSON came back.
 */
import { fetchControlService, ControlServiceRequestError } from './client';
import { ControlServiceResponseShapeError } from './commands';
import {
  commandResponseSchema,
  createCommandResponseSchema,
  type Command,
  type CreateCommandRequest,
} from '@/models/control';

export { ControlServiceResponseShapeError };

const CREATE_PATH = '/v1/commands';

/**
 * Issues one command against a human approval. `input.dispatcherAction` is
 * the inline mirror of that approval (see
 * src/models/control.ts#controlDispatcherActionSchema) — omit it only if the
 * approval is already known to exist in control-service's own
 * dispatcher_actions table, which for this app is never.
 *
 * Rejections that reach the caller unchanged, all of them meaningful:
 *   409 `dispatcher_action_already_used`  this approval already authorized a
 *                                         command — reconcile, do not retry
 *   409 `vehicle_has_active_command`      that bus already has one in flight
 *   403 `rollout_stage_forbids_commands`  route is still observation/shadow
 *   422 `dispatcher_action_invalid`       unknown or already-consumed approval
 *   422 `route_direction_required`        approval carries no route-direction,
 *                                         so the rollout gate is unenforceable
 *   422 `unknown_route_direction` / `unknown_vehicle`  ids this service has
 *                                         never heard of
 */
export async function createControlServiceCommand(input: CreateCommandRequest): Promise<Command> {
  const payload = await fetchControlService(CREATE_PATH, { method: 'POST', body: input });
  const parsed = createCommandResponseSchema.safeParse(payload);
  if (!parsed.success) throw new ControlServiceResponseShapeError(CREATE_PATH);
  return parsed.data.command;
}

/**
 * The command a given dispatcher action already authorized, or null if it
 * never authorized one.
 *
 * The reconciliation half of the exactly-once story above. A 404 here is a
 * normal answer ("no command exists for that approval"), not an error — every
 * other failure still throws, because "the control service is unreachable"
 * must never be mistaken for "nothing was created".
 */
export async function fetchCommandByDispatcherAction(dispatcherActionId: string): Promise<Command | null> {
  const path = `/v1/commands/by-dispatcher-action/${encodeURIComponent(dispatcherActionId)}`;
  try {
    const payload = await fetchControlService(path, { method: 'GET' });
    const parsed = commandResponseSchema.safeParse(payload);
    if (!parsed.success) throw new ControlServiceResponseShapeError(path);
    return parsed.data.command;
  } catch (error) {
    if (error instanceof ControlServiceRequestError && error.status === 404) return null;
    throw error;
  }
}
