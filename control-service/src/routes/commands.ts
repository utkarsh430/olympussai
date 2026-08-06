// POST /v1/commands - web -> control-service, service-token authenticated.
// Creates a command authorized by a dispatcherActionId
// (docs/CONTROL_SERVICE_INTEGRATION.md section 1, non-negotiable) and
// dispatches a signed webhook back to the web app acknowledging delivery,
// timed end-to-end by the `command.dispatch` Sentry span.
import { Router } from 'express';
import { asyncHandler, AppError, sendError } from '../lib/errors.js';
import { createCommandRequestSchema } from '../models/schemas.js';
import { createCommand } from '../db/commands.js';
import { dispatchWebhook } from '../webhooks/dispatch.js';
import { withSpan } from '../telemetry/sentry.js';
import { logger } from '../lib/logger.js';

export const commandsRouter = Router();

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
