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

/**
 * What a stage is called on screen.
 *
 * ─── WHY THESE ARE NOT THE ENUM NAMES ────────────────────────────────────
 *
 * The wire values (`observation`, `shadow`, `advisory`, `limited_auto`,
 * `expanded`) are a pilot-programme vocabulary. They tell a reader who already
 * knows the programme which rung of it a corridor is on, and they tell an
 * administrator who does not know it nothing at all — least of all the one
 * thing the setting actually decides, which is whether an instruction can
 * reach a driver on that corridor.
 *
 * So the label answers that question instead, and the enum is untouched: it is
 * what the control service enforces on and what every audit row already holds.
 * Renaming the display and keeping the wire value is the whole point — a
 * migration of the enum would rewrite history that says what somebody actually
 * did.
 *
 * Kept short enough for a table cell and a tally grid. The sentence version is
 * ROLLOUT_STAGE_MEANING, which is what a reader gets before they change one.
 */
export const ROLLOUT_STAGE_LABEL: Record<RolloutStage, string> = {
  observation: 'Watch only',
  shadow: 'Watch and suggest',
  advisory: 'Instructions with approval',
  limited_auto: 'Instructions, narrow auto',
  expanded: 'Instructions, full band',
};

/**
 * What each stage actually permits, in one sentence an admin can act on.
 *
 * Written from the enforcement point rather than from the pilot plan: these
 * describe what the control service will and will not do, which is the only
 * thing a stage decides.
 *
 * "Blocked by a safety rule" rather than "guardrail breach", deliberately.
 * These are refusals the system RECORDED — nothing got through — and "breach"
 * reads as something that did.
 */
export const ROLLOUT_STAGE_MEANING: Record<RolloutStage, string> = {
  observation:
    'Watching only. Every instruction for this corridor is refused, and each attempt is recorded as blocked by a safety rule.',
  shadow:
    'The engine works out what it would suggest, and nothing is sent to any driver. Every instruction for this corridor is refused, and each attempt is recorded as blocked by a safety rule.',
  advisory: 'Instructions are allowed, and each one still needs a person to approve it first.',
  limited_auto: 'Instructions are allowed, with a narrower automatic band on top of that approval.',
  expanded: 'Instructions are allowed across the full band.',
};

/**
 * The label for a stage value that came out of STORED HISTORY rather than out
 * of the current enum.
 *
 * The audit schema types `previousStage`/`newStage` as plain strings on
 * purpose (src/models/control.ts): an audit row records what the setting was
 * called at the time, and a stage since removed from the programme is still a
 * true thing that happened. So this falls back to the stored value rather than
 * to a blank or a dash — an unrecognised entry must stay legible as itself, not
 * quietly turn into "nothing to report" in the one record somebody reads when
 * they are working out why an instruction did or did not go out.
 */
export function rolloutStageLabel(stage: string): string {
  return ROLLOUT_STAGE_LABEL[stage as RolloutStage] ?? stage.replace(/_/g, ' ');
}

/**
 * The button that applies a proposed change, written as the thing it does to
 * the corridor rather than as a move along a scale.
 *
 * "Promote to advisory" names a rung. "Allow instructions, each needing
 * approval" names the consequence, which is what an administrator is actually
 * deciding — and the withdrawing case says the loud part out loud rather than
 * hiding it behind the same verb as every other demotion.
 */
export function stageChangeActionLabel(from: RolloutStage, to: RolloutStage): string {
  if (withdrawsCommandAuthority(from, to)) return 'Stop instructions on this corridor';
  switch (stageChangeDirection(from, to)) {
    case 'promotion':
      return permitsCommands(from)
        ? `Widen to: ${ROLLOUT_STAGE_LABEL[to].toLowerCase()}`
        : `Allow instructions: ${ROLLOUT_STAGE_LABEL[to].toLowerCase()}`;
    case 'demotion':
      return `Narrow to: ${ROLLOUT_STAGE_LABEL[to].toLowerCase()}`;
    case 'unchanged':
      return 'Record this setting again';
  }
}
