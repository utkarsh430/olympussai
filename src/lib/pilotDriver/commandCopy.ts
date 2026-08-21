import type { Command, CommandActionType } from '@/models/control';

/**
 * Plain-language labels for control-service's action-type vocabulary
 * (control-service/src/models/schemas.ts#commandActionTypeSchema) — AC1
 * requires the driver PWA show "a plain-language reason", and an
 * `action_type` enum value read verbatim (e.g. "self_equalizing_hold") is
 * not that.
 */
const ACTION_LABELS: Record<CommandActionType, string> = {
  terminal_dispatch_hold: 'Hold at terminal',
  two_way_hold: 'Hold here',
  self_equalizing_hold: 'Hold to space out from the vehicle ahead',
  // Same instruction as the three holds above, in the same words. The driver
  // is told WHAT TO DO; which control law decided it is provenance kept for
  // the audit trail, and a driver reading "balanced hold" or "cost-optimal
  // hold" on a phone at a stop would have to work out that it means "wait".
  cost_optimal_hold: 'Hold here',
  speed_guidance: 'Adjust your speed',
  stop_skip: 'Skip the next stop',
  short_turn: 'Short-turn this trip',
  deadhead: 'Deadhead — no passengers, return to depot',
  // Was "Limit boarding at the next stop" while this was a human-only
  // instruction a dispatcher typed and explained by radio. The engine now
  // generates it (alighting-only, control-service/src/mpc/boardingLimit.ts)
  // with one specific meaning, and the driver may get it with no other
  // context: let everyone off, pick nobody up, HERE. "Limit" understates it -
  // a driver reading it could reasonably take on a few people - and "next
  // stop" is wrong, because the instruction is about the stop they are at or
  // arriving at, which is what the eligibility gate checked before proposing.
  boarding_limit: 'Drop off only — let passengers off, do not pick up',
  standby_injection: 'Stand by — you may be inserted into service shortly',
};

export function commandActionLabel(actionType: CommandActionType): string {
  return ACTION_LABELS[actionType] ?? actionType.replace(/_/g, ' ');
}

/**
 * The plain-language reason shown under the action (AC1). Dispatcher-
 * authored free text lives in `command.parameters.reason` (a string) by
 * convention — control-service's `parameters` column is intentionally
 * free-form (control-service/src/models/schemas.ts), there is no dedicated
 * `reason` column on `commands`. Falls back to a short, still-readable
 * description built from the action type and target stop if no reason was
 * supplied, so the driver is never shown a blank line.
 */
export function commandReason(command: Command): string {
  const fromParameters = command.parameters?.reason;
  if (typeof fromParameters === 'string' && fromParameters.trim().length > 0) {
    return fromParameters.trim();
  }
  if (command.targetStopId) {
    return `Requested near stop ${command.targetStopId}.`;
  }
  return 'No additional reason was provided by dispatch.';
}
