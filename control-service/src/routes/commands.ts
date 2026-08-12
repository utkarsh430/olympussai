// Command lifecycle REST surface - web -> control-service, service-token
// authenticated (docs/CONTROL_SERVICE_INTEGRATION.md section 1). Covers
// the full lifecycle the "command lifecycle and delivery service" ticket
// asks for:
//   POST   /v1/commands              persist + authorize (dispatcherActionId required)
//   GET    /v1/commands/active       the one delivered, not-yet-acked command for ?vehicleId=
//   GET    /v1/commands/by-dispatcher-action/:dispatcherActionId
//                                    the command an approval authorized (reconciliation)
//   GET    /v1/commands/:id          current state
//   GET    /v1/commands/:id/audit    full, ordered audit trail (command_audit_log)
//   POST   /v1/commands/:id/deliver  authorized -> delivered (refuses expired/unauthorized)
//   POST   /v1/commands/:id/ack      driver ack: accept/unable/unsafe, no penalty either way
//   POST   /v1/commands/:id/supersede  re-issue as version+1, cancelling the prior one
// Every state-changing step dispatches a signed webhook back to the web
// app, timed end-to-end by its own `command.*` Sentry span.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import {
  createCommandRequestSchema,
  acknowledgeCommandRequestSchema,
  supersedeCommandRequestSchema,
} from '../models/schemas.js';
import {
  createCommand,
  deliverCommand,
  getCommandById,
  getCommandByDispatcherActionId,
  getActiveDeliveredCommandForVehicle,
  acknowledgeCommand,
  supersedeCommand,
  type CommandRow,
} from '../db/commands.js';
import { listCommandAuditLog } from '../db/commandAudit.js';
import { dispatchWebhook, type DispatchResult, type WebhookEvent } from '../webhooks/dispatch.js';
import { deliverAndNotify, buildDeliveredWebhookEvent } from '../commands/deliverAndNotify.js';
import { withSpan, Sentry } from '../telemetry/sentry.js';
import { logger } from '../lib/logger.js';

export const commandsRouter = Router();

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });

/** Returns the validated `:id` param, or sends a 400 and returns undefined. Caller must check for undefined and return. */
function requireIdParam(req: Request, res: Response): string | undefined {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    sendError(res, new AppError('invalid_request', 'id must be a valid UUID', 400, parsed.error.flatten()));
    return undefined;
  }
  return parsed.data.id;
}

/**
 * Attempts to deliver a just-created/just-superseded command inline,
 * without ever letting the delivery attempt fail the caller's own
 * response: the command is already committed and (for create) the
 * dispatcher approval it consumed cannot be un-consumed, so the operator
 * needs the id back regardless. A failure here leaves the command in
 * `authorized`, which `commandDeliverySweep` (src/scheduler/
 * commandDeliverySweep.ts) will retry - `authorized` is the state a
 * *failed* delivery rests in, not an error state in its own right.
 */
async function attemptInlineDelivery(commandId: string): Promise<{ command: CommandRow; delivery: DispatchResult } | null> {
  try {
    return await deliverAndNotify(commandId);
  } catch (err) {
    logger.error(
      { err, commandId },
      'inline delivery immediately after create/supersede failed; commandDeliverySweep will retry it',
    );
    Sentry.captureException(err);
    return null;
  }
}

/**
 * The DB half of "create, then deliver inline" - deliberately just the
 * transition (deliverCommand), not deliverAndNotify: POST /v1/commands
 * fires the corresponding webhook itself, without awaiting it (see the
 * handler below for why). Mirrors attemptInlineDelivery's never-throw
 * contract: a failure here leaves the command in `authorized`, which
 * commandDeliverySweep will retry.
 */
async function attemptInlineDeliveryCommit(commandId: string): Promise<CommandRow | null> {
  try {
    return await deliverCommand(commandId);
  } catch (err) {
    logger.error(
      { err, commandId },
      'inline delivery immediately after create failed; commandDeliverySweep will retry it',
    );
    Sentry.captureException(err);
    return null;
  }
}

/** Fires a webhook without making the caller wait for it - see POST /v1/commands's own comment for why create needs this and supersede/deliver/ack do not (yet). */
function notifyWithoutWaiting(event: WebhookEvent): void {
  void dispatchWebhook(event).then((delivery) => {
    if (!delivery.delivered) {
      logger.warn(
        { eventType: event.type, idempotencyKey: delivery.idempotencyKey },
        'command event webhook did not succeed; web app will need to reconcile',
      );
    }
  });
}

commandsRouter.post(
  '/v1/commands',
  asyncHandler(async (req, res) => {
    const parsed = createCommandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(
        res,
        new AppError('invalid_request', 'Invalid command payload', 400, parsed.error.flatten()),
      );
      return;
    }

    const result = await withSpan('command.dispatch', 'command.dispatch', async () => {
      const command = await createCommand(parsed.data);
      // Awaited: this is the actual state a caller must be able to trust in
      // the response body (`command.status`/`deliveredAt`, `delivered`) -
      // one indexed UPDATE, not the slow part.
      const deliveredCommand = await attemptInlineDeliveryCommit(command.id);

      // The webhooks are notifications, not part of what this response's
      // correctness depends on: the command (and its delivery, if it
      // succeeded above) are already durably committed by this point.
      // Awaiting dispatchWebhook here used to make this response wait up to
      // its own worst case (MAX_ATTEMPTS retries x its own request timeout,
      // plus backoff) for EACH of two webhooks, against the web client's 8s
      // timeout (src/lib/controlService/client.ts) - proven live to time
      // out AFTER the command had already committed and delivered, so the
      // operator was told the approval "was not consumed and can be
      // re-issued" while the driver already had the instruction on screen.
      // Fire-and-forget instead: a web app that never receives either event
      // reconciles the same way it already does for a dropped inline
      // delivery attempt or a crashed process (commandDeliverySweep, or a
      // later read of the command's own state).
      notifyWithoutWaiting({ type: 'command.created', idempotencyKey: command.id, data: { command } });
      if (deliveredCommand) {
        notifyWithoutWaiting(buildDeliveredWebhookEvent(deliveredCommand));
      }

      return {
        command: deliveredCommand ?? command,
        delivered: deliveredCommand !== null,
      };
    });

    res.status(201).json({
      command: result.command,
      delivered: result.delivered,
    });
  }),
);

const activeCommandQuerySchema = z.object({ vehicleId: z.string().min(1, 'vehicleId is required') });

// Registered ahead of GET /v1/commands/:id so the literal segment "active"
// is never swallowed by that route's :id param (which would otherwise 400
// it as "not a valid UUID" instead of reaching this handler).
commandsRouter.get(
  '/v1/commands/active',
  asyncHandler(async (req, res) => {
    const parsed = activeCommandQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, new AppError('invalid_request', 'vehicleId query param is required', 400, parsed.error.flatten()));
      return;
    }

    const command = await getActiveDeliveredCommandForVehicle(parsed.data.vehicleId);
    res.status(200).json({ command });
  }),
);

const dispatcherActionParamSchema = z.object({
  dispatcherActionId: z.string().uuid('dispatcherActionId must be a valid UUID'),
});

/**
 * The command a given dispatcher action authorized, or 404 if it never
 * authorized one.
 *
 * Reconciliation endpoint, not a convenience read. POST /v1/commands can
 * succeed and commit while its caller never sees the 201 — the web app's
 * client has an 8s timeout and a circuit breaker
 * (src/lib/controlService/client.ts), so this is expected rather than
 * theoretical. On retry the caller re-sends the same dispatcherActionId and
 * gets a 409 `dispatcher_action_already_used` from the UNIQUE constraint;
 * this endpoint is the only way for it to then find out WHICH command it
 * already created, instead of leaving a live command unattributed or issuing
 * a duplicate one against the same bus.
 *
 * Registered ahead of GET /v1/commands/:id purely for readability — the
 * literal three-segment path cannot collide with that two-segment route.
 */
commandsRouter.get(
  '/v1/commands/by-dispatcher-action/:dispatcherActionId',
  asyncHandler(async (req, res) => {
    const parsed = dispatcherActionParamSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(
        res,
        new AppError('invalid_request', 'dispatcherActionId must be a valid UUID', 400, parsed.error.flatten()),
      );
      return;
    }

    const command = await getCommandByDispatcherActionId(parsed.data.dispatcherActionId);
    if (!command) {
      sendError(
        res,
        new AppError(
          'command_not_found',
          `no command has been created against dispatcher action ${parsed.data.dispatcherActionId}`,
          404,
        ),
      );
      return;
    }
    res.status(200).json({ command });
  }),
);

commandsRouter.get(
  '/v1/commands/:id',
  asyncHandler(async (req, res) => {
    const id = requireIdParam(req, res);
    if (!id) return;

    const command = await getCommandById(id);
    if (!command) {
      sendError(res, new AppError('command_not_found', `command ${id} not found`, 404));
      return;
    }
    res.status(200).json({ command });
  }),
);

commandsRouter.get(
  '/v1/commands/:id/audit',
  asyncHandler(async (req, res) => {
    const id = requireIdParam(req, res);
    if (!id) return;

    const command = await getCommandById(id);
    if (!command) {
      sendError(res, new AppError('command_not_found', `command ${id} not found`, 404));
      return;
    }
    const auditLog = await listCommandAuditLog(id);
    res.status(200).json({ commandId: id, command, auditLog });
  }),
);

commandsRouter.post(
  '/v1/commands/:id/deliver',
  asyncHandler(async (req, res) => {
    const id = requireIdParam(req, res);
    if (!id) return;

    const result = await withSpan('command.deliver', 'command.deliver', () => deliverAndNotify(id));

    res.status(200).json({ command: result.command, webhookDelivered: result.delivery.delivered });
  }),
);

commandsRouter.post(
  '/v1/commands/:id/ack',
  asyncHandler(async (req, res) => {
    const id = requireIdParam(req, res);
    if (!id) return;

    const parsed = acknowledgeCommandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(
        res,
        new AppError('invalid_request', 'Invalid acknowledgement payload', 400, parsed.error.flatten()),
      );
      return;
    }

    const result = await withSpan('command.acknowledge', 'command.acknowledge', async () => {
      const command = await acknowledgeCommand(id, parsed.data);
      const delivery = await dispatchWebhook({
        type: 'command.acknowledged',
        idempotencyKey: `${command.id}:ack:${command.acknowledgedAt ?? Date.now()}`,
        data: { command },
      });
      if (!delivery.delivered) {
        logger.warn(
          { commandId: command.id, idempotencyKey: delivery.idempotencyKey },
          'command acknowledged but webhook notification did not succeed; web app will need to reconcile',
        );
      }
      return { command, delivery };
    });

    res.status(200).json({ command: result.command, webhookDelivered: result.delivery.delivered });
  }),
);

commandsRouter.post(
  '/v1/commands/:id/supersede',
  asyncHandler(async (req, res) => {
    const id = requireIdParam(req, res);
    if (!id) return;

    const parsed = supersedeCommandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(
        res,
        new AppError('invalid_request', 'Invalid supersede payload', 400, parsed.error.flatten()),
      );
      return;
    }

    const result = await withSpan('command.supersede', 'command.supersede', async () => {
      const command = await supersedeCommand(id, parsed.data);

      // Same treatment as POST /v1/commands: the version+1 row is just as
      // undelivered as a brand-new command's, so it needs the same inline
      // delivery attempt, and the two webhook deliveries the same
      // Promise.all concurrency rather than sequential dispatch.
      const [supersededDelivery, deliveryOutcome] = await Promise.all([
        dispatchWebhook({
          type: 'command.superseded',
          idempotencyKey: `${command.id}:superseded`,
          data: { command, supersedesCommandId: id },
        }),
        attemptInlineDelivery(command.id),
      ]);

      if (!supersededDelivery.delivered) {
        logger.warn(
          { commandId: command.id, idempotencyKey: supersededDelivery.idempotencyKey },
          'command superseded but webhook notification did not succeed; web app will need to reconcile',
        );
      }

      return {
        command: deliveryOutcome?.command ?? command,
        delivered: deliveryOutcome !== null,
        webhookDelivered: supersededDelivery.delivered,
      };
    });

    res.status(201).json({
      command: result.command,
      delivered: result.delivered,
      webhookDelivered: result.webhookDelivered,
    });
  }),
);
