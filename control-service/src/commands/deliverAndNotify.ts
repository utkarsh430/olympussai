// The single delivery event in this system: transitions a command
// `authorized` -> `delivered` (src/db/commands.ts#deliverCommand) and
// dispatches the `command.delivered` webhook that tells the web app it
// happened. Every path that can deliver a command - POST
// /v1/commands/:id/deliver, the inline delivery run immediately after
// POST /v1/commands and POST /v1/commands/:id/supersede commit, and the
// commandDeliverySweep backstop (src/scheduler/commandDeliverySweep.ts) -
// goes through this one function, so the idempotency key format
// (`${command.id}:delivered:v${command.version}`) can never drift between
// call sites. That format is load-bearing: it is the primary key of
// ops_control_service_webhook_events on the web side, and a different
// format there silently defeats deduplication rather than erroring.
//
// This is also the intended hook point for a future SMS notification
// channel: whatever tells the web app a command was delivered is exactly
// the moment a driver-facing SMS (for a device that isn't polling the PWA)
// would need to fire too.
import { deliverCommand, type CommandRow } from '../db/commands.js';
import { dispatchWebhook, type DispatchResult } from '../webhooks/dispatch.js';
import { logger } from '../lib/logger.js';

export interface DeliverAndNotifyResult {
  command: CommandRow;
  delivery: DispatchResult;
}

/**
 * The `command.delivered` webhook event for `command`, in one place so its
 * idempotency key format (`${id}:delivered:v${version}`) can never drift
 * between the callers that need to dispatch it - deliverAndNotify below, and
 * POST /v1/commands's own create-response path (routes/commands.ts), which
 * fires this same event but deliberately does not await it (see that
 * route's comment for why: dispatchWebhook's own worst case was proven to
 * blow the web client's response budget even though the command had
 * already committed and delivered).
 */
export function buildDeliveredWebhookEvent(command: CommandRow): {
  type: 'command.delivered';
  idempotencyKey: string;
  data: { command: CommandRow };
} {
  return {
    type: 'command.delivered',
    idempotencyKey: `${command.id}:delivered:v${command.version}`,
    data: { command },
  };
}

/**
 * Delivers `id` and notifies the web app. Propagates whatever
 * `deliverCommand` throws (404/409/410 AppErrors) unchanged - callers that
 * must not fail their own response on a delivery error (the inline
 * post-supersede attempt, POST /v1/commands/:id/deliver) catch around this
 * call themselves rather than this function swallowing anything.
 */
export async function deliverAndNotify(id: string): Promise<DeliverAndNotifyResult> {
  const command = await deliverCommand(id);
  const delivery = await dispatchWebhook(buildDeliveredWebhookEvent(command));
  if (!delivery.delivered) {
    logger.warn(
      { commandId: command.id, idempotencyKey: delivery.idempotencyKey },
      'command delivered but webhook notification did not succeed; web app will need to reconcile',
    );
  }
  return { command, delivery };
}
