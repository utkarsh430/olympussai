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
  speed_guidance: 'Adjust your speed',
  stop_skip: 'Skip the next stop',
  short_turn: 'Short-turn this trip',
  deadhead: 'Deadhead — no passengers, return to depot',
  boarding_limit: 'Limit boarding at the next stop',
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
