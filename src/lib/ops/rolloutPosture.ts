/**
 * What a rollout stage MEANS, for the surfaces that let an admin change one.
 *
 * ─── WHY THIS IS NOT A DISPLAY CONCERN ───────────────────────────────────
 *
 * A route-direction's rollout stage is a safety posture, not a label. The
 * control service refuses to create ANY command for a corridor sitting in
 * `observation` or `shadow` — it records a `rollout_stage_violation` guardrail
 * breach and answers 403 (control-service/src/pilot/gate.ts). Everything from
 * `advisory` up is permitted, because by then every command already carries a
 * human-approved dispatcher action.
 *
 * So the two directions of a stage change are not symmetric, and an admin
 * screen that renders them as one dropdown is lying about what it does:
 *
 *   PROMOTION  widens what the system may do to a live corridor. It is the
 *              deliberate act the pilot cadence is built around.
 *   DEMOTION   narrows it, and crossing back below `advisory` STOPS COMMANDS
 *              REACHING DRIVERS on that corridor. That is an operational
 *              intervention with an audience — dispatchers will watch their
 *              approvals start failing — and it needs a reason recorded at the
 *              moment it is made, not reconstructed afterwards from the audit
 *              trail.
 *
 * This module is where both facts live, once, so the admin console and its
 * tests read the same rule the control service enforces rather than each
 * re-deriving it from the order of an enum.
 *
 * ─── THE MIRROR IS LOAD-BEARING ──────────────────────────────────────────
 *
 * `STAGES_FORBIDDING_COMMANDS` mirrors
 * `control-service/src/models/pilotSchemas.ts`'s
 * `ROLLOUT_STAGES_FORBIDDING_COMMANDS`. The two services share no code — they
 * do not even share a database (docs/CONTROL_SERVICE_INTEGRATION.md) — so this
 * is a copy, and a copy of a safety rule that drifts is worse than no copy at
 * all: the console would cheerfully tell an admin that commands are flowing on
 * a corridor the control service is refusing. `src/tests/unit/rolloutPosture.test.ts`
 * reads the control service's own source and fails if the two disagree.
 */
import type { RolloutStage } from '@/models/control';

/**
 * Every stage, weakest posture first. This order is the definition of
 * "promotion" and "demotion" on this surface, and it matches the enum in both
 * services' schemas.
 */
export const ROLLOUT_STAGE_ORDER: readonly RolloutStage[] = [
  'observation',
  'shadow',
  'advisory',
  'limited_auto',
  'expanded',
];

/**
 * The stage a route-direction has when nothing has been set for it.
 * Mirrors `DEFAULT_ROLLOUT_STAGE` in control-service/src/pilot/rolloutStages.ts —
 * and it is the SAFE end of the scale on purpose: an unmapped corridor
 * forbids commands rather than permitting them.
 */
export const DEFAULT_ROLLOUT_STAGE: RolloutStage = 'observation';

/** Stages at which the control service refuses to create commands at all. */
export const STAGES_FORBIDDING_COMMANDS: readonly RolloutStage[] = ['observation', 'shadow'];

/** Whether a corridor at this stage may have commands issued for it. */
export function permitsCommands(stage: RolloutStage): boolean {
  return !STAGES_FORBIDDING_COMMANDS.includes(stage);
}

/** Position on the scale. Higher is a wider posture. */
export function stageRank(stage: RolloutStage): number {
  return ROLLOUT_STAGE_ORDER.indexOf(stage);
}

export type StageChangeDirection = 'promotion' | 'demotion' | 'unchanged';

/**
 * Which way a proposed change moves the posture.
 *
 * `unchanged` is a real answer and not a no-op: re-setting the same stage is
 * how an admin re-stamps a reason, and the rollout-stage endpoint accepts it.
 */
export function stageChangeDirection(from: RolloutStage, to: RolloutStage): StageChangeDirection {
  const delta = stageRank(to) - stageRank(from);
  if (delta > 0) return 'promotion';
  if (delta < 0) return 'demotion';
  return 'unchanged';
}

/**
 * Whether this change takes a corridor from "commands permitted" to "commands
 * refused".
 *
 * This is the one transition the console must never let through casually: it
 * is a demotion whose effect is immediate and whose visible symptom, to
 * everybody except the admin who made it, is dispatcher approvals failing on a
 * live corridor. `expanded -> advisory` is also a demotion, and it is not this
 * — nothing stops working.
 */
export function withdrawsCommandAuthority(from: RolloutStage, to: RolloutStage): boolean {
  return permitsCommands(from) && !permitsCommands(to);
}

/** Short label for a stage. Sentence case; the UI decides its own casing. */
export const ROLLOUT_STAGE_LABEL: Record<RolloutStage, string> = {
  observation: 'Observation',
  shadow: 'Shadow',
  advisory: 'Advisory',
  limited_auto: 'Limited auto',
  expanded: 'Expanded',
};

/**
 * What each stage actually permits, in one sentence an admin can act on.
 *
 * Written from the enforcement point rather than from the pilot plan: these
 * describe what the control service will and will not do, which is the only
 * thing a stage decides.
 */
export const ROLLOUT_STAGE_MEANING: Record<RolloutStage, string> = {
  observation:
    'Detection only. Commands for this corridor are refused and logged as a guardrail breach.',
  shadow:
    'The engine recommends, nothing is sent. Commands for this corridor are refused and logged as a guardrail breach.',
  advisory: 'Commands permitted, each one still requiring a human approval first.',
  limited_auto: 'Commands permitted, with a narrowed automatic band on top of human approval.',
  expanded: 'Commands permitted across the full band.',
};
