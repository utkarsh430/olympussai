// Backstop delivery sweep: retries commands stuck in `authorized`.
//
// The primary delivery path is in-process and immediate - POST
// /v1/commands and POST /v1/commands/:id/supersede both attempt delivery
// (src/commands/deliverAndNotify.ts) right after their own commit. This
// sweep exists only for the case that path can't cover: a crash between
// the commit and the inline attempt, or an inline attempt that threw.
// `authorized` is the state a *failed* delivery rests in by design (see
// src/db/commands.ts#createCommand's doc comment) - this is what makes
// that state self-healing rather than a stuck queue.
import { listCommandsAwaitingDelivery } from '../db/commands.js';
import { deliverAndNotify, type DeliverAndNotifyResult } from '../commands/deliverAndNotify.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { Sentry } from '../telemetry/sentry.js';

/**
 * At most this many candidates per sweep. A single indexed WHERE clause
 * with this LIMIT is cheap regardless, but an unbounded batch would let one
 * sweep tick hold the pool for arbitrarily long during a pathological
 * backlog - bounding it means a backlog drains over several ticks instead.
 */
const SWEEP_BATCH_LIMIT = 50;

export interface CommandDeliverySweepResult {
  candidates: number;
  delivered: number;
  lostRace: number;
  failed: number;
}

export interface CommandDeliverySweepDeps {
  listCandidates?: (limit: number) => Promise<string[]>;
  deliver?: (id: string) => Promise<DeliverAndNotifyResult>;
}

/**
 * 409 `vehicle_has_active_command`/`command_not_authorized` and 410
 * `command_expired` mean the inline path (or another sweep tick) already
 * won the race on this command, or its TTL beat this sweep to it. Neither
 * is a bug - it is expected-and-ignorable, never a reason to abort the
 * batch.
 */
function isExpectedRaceLoss(err: unknown): boolean {
  return err instanceof AppError && (err.status === 409 || err.status === 410);
}

/**
 * One sweep. Never rejects for a single command's failure - one bad row
 * (a lost race, or a genuine delivery error) must not abort delivery for
 * the rest of the batch.
 */
export async function runCommandDeliverySweep(
  deps: CommandDeliverySweepDeps = {},
): Promise<CommandDeliverySweepResult> {
  const listCandidates = deps.listCandidates ?? listCommandsAwaitingDelivery;
  const deliver = deps.deliver ?? deliverAndNotify;

  const candidateIds = await listCandidates(SWEEP_BATCH_LIMIT);

  let delivered = 0;
  let lostRace = 0;
  let failed = 0;

  for (const id of candidateIds) {
    try {
      await deliver(id);
      delivered += 1;
    } catch (err) {
      if (isExpectedRaceLoss(err)) {
        lostRace += 1;
        continue;
      }
      failed += 1;
      logger.error({ err, commandId: id }, 'commandDeliverySweep failed to deliver a candidate; sweep continues');
      Sentry.captureException(err);
    }
  }

  const result: CommandDeliverySweepResult = { candidates: candidateIds.length, delivered, lostRace, failed };
  if (result.candidates > 0) {
    logger.info(result, 'commandDeliverySweep complete');
  }
  return result;
}
