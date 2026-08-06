// Command lifecycle REST surface - web -> control-service, service-token
// authenticated (docs/CONTROL_SERVICE_INTEGRATION.md section 1). Covers
// the full lifecycle the "command lifecycle and delivery service" ticket
// asks for:
//   POST   /v1/commands              persist + authorize (dispatcherActionId required)
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
  getCommandById,
  deliverCommand,
  acknowledgeCommand,
  supersedeCommand,
} from '../db/commands.js';
import { listCommandAuditLog } from '../db/commandAudit.js';
import { dispatchWebhook } from '../webhooks/dispatch.js';
import { withSpan } from '../telemetry/sentry.js';
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

      const delivery = await dispatchWebhook({
        type: 'command.created',
        idempotencyKey: command.id,
        data: { command },
      });

      if (!delivery.delivered) {
        logger.warn(
          { commandId: command.id, idempotencyKey: delivery.idempotencyKey },
          'command created but webhook delivery did not succeed; web app will need to reconcile',
        );
      }

      return { command, delivery };
    });

    res.status(201).json({
      command: result.command,
      webhookDelivered: result.delivery.delivered,
    });
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

    const result = await withSpan('command.deliver', 'command.deliver', async () => {
      const command = await deliverCommand(id);
      const delivery = await dispatchWebhook({
        type: 'command.delivered',
        idempotencyKey: `${command.id}:delivered:v${command.version}`,
        data: { command },
      });
      if (!delivery.delivered) {
        logger.warn(
          { commandId: command.id, idempotencyKey: delivery.idempotencyKey },
          'command delivered but webhook notification did not succeed; web app will need to reconcile',
        );
      }
      return { command, delivery };
    });

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
      const delivery = await dispatchWebhook({
        type: 'command.superseded',
        idempotencyKey: `${command.id}:superseded`,
        data: { command, supersedesCommandId: id },
      });
      if (!delivery.delivered) {
        logger.warn(
          { commandId: command.id, idempotencyKey: delivery.idempotencyKey },
          'command superseded but webhook notification did not succeed; web app will need to reconcile',
        );
      }
      return { command, delivery };
    });

    res.status(201).json({ command: result.command, webhookDelivered: result.delivery.delivered });
  }),
);
