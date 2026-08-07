// Rollout-stage enforcement for command creation (ticket AC1: "control/
// command services respect it without a deploy"). Called from
// src/db/commands.ts#createCommand inside its own transaction, using the
// same PoolClient, so a rejection and its guardrail-breach log entry are
// atomic with (and precede) the insert they block.
//
// Scope: every command already requires a valid, unconsumed
// dispatcherActionId (docs/CONTROL_SERVICE_INTEGRATION.md section 1 -
// unconditionally, regardless of rollout stage), which is itself a human
// approval. That means 'advisory' and beyond are already at the posture
// this ticket asks for by construction; the only stages that change
// createCommand's behaviour are the two pre-command stages,
// 'observation' and 'shadow', where no command may be issued at all.
import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { recordGuardrailBreach } from './guardrailBreaches.js';
import { DEFAULT_ROLLOUT_STAGE } from './rolloutStages.js';
import { ROLLOUT_STAGES_FORBIDDING_COMMANDS, type RolloutStage } from '../models/pilotSchemas.js';

/** Just the fields the gate needs — `actionType` is typed as a plain `string` (rather than reusing CreateCommandRequest's narrower literal union) so this also accepts supersedeCommand's already-resolved `string`-typed `CommandRow.actionType`. */
export interface RolloutGateCommandInput {
  dispatcherActionId: string;
  vehicleId: string;
  actionType: string;
}

/**
 * Resolves the route-direction a command is being issued for from its
 * (already-required) dispatcherActionId — dispatcher_actions.route_direction_id
 * is populated by the web app when the approval is created
 * (ops_dispatcher_actions.route_direction_id on the web side, correlated
 * only across the REST boundary per the Crewban-4/Crewban-9 handoffs, never
 * a shared foreign key). Returns null if the approval carries no
 * route-direction (nothing to gate against — allowed, not blocked, since
 * this ticket cannot invent a route context that doesn't exist).
 */
async function resolveRouteDirectionId(client: PoolClient, dispatcherActionId: string): Promise<string | null> {
  const { rows } = await client.query<{ route_direction_id: string | null }>(
    `select route_direction_id from dispatcher_actions where id = $1`,
    [dispatcherActionId],
  );
  return rows[0]?.route_direction_id ?? null;
}

/**
 * Throws a 403 `rollout_stage_forbids_commands` AppError (and records a
 * guardrail breach) if the command's route-direction is currently in
 * 'observation' or 'shadow'. Reads happen on `client` — inside the same
 * transaction as the command insert this is guarding, before that insert
 * runs — but the guardrail-breach write goes through `breachPool` (a plain
 * `Pool`, defaulting to the shared singleton), deliberately OUTSIDE that
 * transaction: createCommand rolls its transaction back after this throws,
 * and a breach record that only "happened" inside a rolled-back
 * transaction would vanish, defeating AC4's "audit-logged and visible
 * without waiting for day-end".
 */
export async function assertRolloutStageAllowsCommand(
  client: PoolClient,
  input: RolloutGateCommandInput,
  breachPool: Pool = getPool(),
): Promise<void> {
  const routeDirectionId = await resolveRouteDirectionId(client, input.dispatcherActionId);
  if (!routeDirectionId) return;

  const { rows } = await client.query<{ stage: string }>(
    `select stage from route_direction_rollout_stages where route_direction_id = $1 for update`,
    [routeDirectionId],
  );
  const stage = (rows[0]?.stage as RolloutStage | undefined) ?? DEFAULT_ROLLOUT_STAGE;

  if (!ROLLOUT_STAGES_FORBIDDING_COMMANDS.includes(stage)) return;

  await recordGuardrailBreach(
    {
      routeDirectionId,
      breachType: 'rollout_stage_violation',
      severity: 'warning',
      detail: {
        stage,
        vehicleId: input.vehicleId,
        actionType: input.actionType,
        dispatcherActionId: input.dispatcherActionId,
      },
    },
    breachPool,
  );

  throw new AppError(
    'rollout_stage_forbids_commands',
    `route-direction ${routeDirectionId} is in rollout stage "${stage}"; commands are not permitted until it reaches at least "advisory"`,
    403,
    { routeDirectionId, stage },
  );
}
