// Persistence for controller recommendations.
//
// The `recommendations` table has existed since the core data model and
// nothing has ever written to it. That is the open loop this module closes:
// `mpc/solver.ts` computes a recommendation only when a human opens the
// control room and the web app asks it to, so a corridor drifting apart at
// 03:00 produced a proposal only if somebody happened to be looking at that
// corridor. Detection ran on a timer; the decision did not.
//
// ─── THIS WRITES A PROPOSAL, NEVER AN INSTRUCTION ────────────────────────
//
// A row here is a suggestion with `status = 'proposed'`. It reaches nobody
// on its own and moves no bus. Issuing anything still requires a dispatcher
// approval and `POST /v1/commands`, which refuses to insert a command
// without an unconsumed approval row. Nothing in this file touches
// `commands`, `dispatcher_actions` or the webhook path, and nothing should
// be added that does - the point of closing the loop is to put a proposal
// in front of a human sooner, not to remove the human.
import type { Pool } from 'pg';
import { getPool } from './pool.js';
import type { CandidateAction } from '../mpc/types.js';

export interface RecommendationInput {
  routeDirectionId: string;
  incidentId: string | null;
  candidateActions: CandidateAction[];
  selectedActionType: CandidateAction['actionType'] | null;
  objectiveCost: number | null;
  expectedRecoverySeconds: number | null;
  constraints: Record<string, unknown>;
  controllerVersion: string;
}

/** The fields that decide whether a new proposal says anything new. */
export interface RecommendationFingerprint {
  selectedActionType: string | null;
  vehicleId: string | null;
  holdSeconds: number | null;
  createdAt: string;
}

export async function insertRecommendation(
  input: RecommendationInput,
  pool: Pool = getPool(),
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into recommendations
       (route_direction_id, incident_id, candidate_actions, selected_action_type,
        objective_cost, expected_recovery_seconds, constraints, controller_version, status)
     values ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8, 'proposed')
     returning id`,
    [
      input.routeDirectionId,
      input.incidentId,
      JSON.stringify(input.candidateActions),
      input.selectedActionType,
      input.objectiveCost,
      input.expectedRecoverySeconds,
      JSON.stringify(input.constraints),
      input.controllerVersion,
    ],
  );
  return rows[0]!.id;
}

/**
 * The most recent proposal for this corridor, reduced to what identifies the
 * advice it carried.
 *
 * `candidate_actions -> 0` is the SELECTED action rather than merely the
 * first candidate: `mpc/solver.ts` returns `safeCandidates` in its own
 * selection order and this module persists that array, so index 0 is the
 * action the solver picked. Reading the vehicle out of the payload rather
 * than storing it in a column of its own keeps one source of truth for which
 * bus a recommendation was about.
 */
export async function findLatestRecommendation(
  routeDirectionId: string,
  pool: Pool = getPool(),
): Promise<RecommendationFingerprint | null> {
  const { rows } = await pool.query<{
    selected_action_type: string | null;
    vehicle_id: string | null;
    hold_seconds: string | null;
    created_at: string;
  }>(
    `select selected_action_type,
            candidate_actions -> 0 ->> 'vehicleId'   as vehicle_id,
            candidate_actions -> 0 ->> 'holdSeconds' as hold_seconds,
            created_at
       from recommendations
      where route_direction_id = $1
      order by created_at desc
      limit 1`,
    [routeDirectionId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    selectedActionType: row.selected_action_type,
    vehicleId: row.vehicle_id,
    holdSeconds: row.hold_seconds === null ? null : Number(row.hold_seconds),
    createdAt: row.created_at,
  };
}

/**
 * How different a new proposal must be from the standing one to be worth
 * writing, in seconds of hold.
 *
 * The sweep re-solves every corridor on a timer, and a corridor drifting
 * slowly produces a near-identical recommendation every cycle. Writing all
 * of them would bury the moment the advice actually CHANGED under hundreds
 * of rows saying the same thing, and `recommendations` is append-only and
 * retained - the console's history is what an incident review reads.
 *
 * 30 s is the granularity a hold instruction is given in and roughly the
 * resolution a driver can execute one at, so a change smaller than this is
 * not a different instruction.
 */
export const RECOMMENDATION_HOLD_EPSILON_SECONDS = 30;

/**
 * Whether `next` says anything the standing proposal did not.
 *
 * True when there is no standing proposal, when the action type or the
 * vehicle changed, when the hold moved by more than the epsilon above, or
 * when the standing one is older than `maxAgeSeconds` - the last so a
 * long-running situation still leaves a periodic trace showing the
 * controller was watching it, rather than one row from an hour ago and
 * silence since.
 */
export function isMateriallyNewRecommendation(
  latest: RecommendationFingerprint | null,
  next: { selectedActionType: string | null; vehicleId: string | null; holdSeconds: number | null },
  now: Date,
  maxAgeSeconds: number,
): boolean {
  if (!latest) return true;
  if (latest.selectedActionType !== next.selectedActionType) return true;
  if (latest.vehicleId !== next.vehicleId) return true;

  const ageSeconds = (now.getTime() - new Date(latest.createdAt).getTime()) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds > maxAgeSeconds) return true;

  if (latest.holdSeconds === null || next.holdSeconds === null) {
    return latest.holdSeconds !== next.holdSeconds;
  }
  return Math.abs(latest.holdSeconds - next.holdSeconds) > RECOMMENDATION_HOLD_EPSILON_SECONDS;
}
