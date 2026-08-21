import 'server-only';

/**
 * The network-wide controller switches.
 *
 * NOT cached, unlike the alert feed beside it. Two reasons, and the second is
 * the important one:
 *
 *  - it is read once per page render, not per row, so a cache buys nothing;
 *  - an operator who flips a switch looks straight back at the screen to see
 *    whether it worked. A stale read here does not cost freshness, it costs
 *    the operator's belief that the control does anything - and a control
 *    nobody believes in is worse than no control.
 *
 * And it does NOT fall back to a last-good value on failure. The alert feed
 * does, because an empty alert list would read as an all-clear; a settings
 * page has no such trap. Showing the last known switch position during an
 * outage would tell an operator the controller is in a state nobody can
 * currently verify, which is exactly the claim to avoid making.
 */
import { fetchControlService } from './client';
import { ControlServiceResponseShapeError } from './commands';
import { z } from 'zod';

const SETTINGS_PATH = '/v1/settings';

export const controlSettingsSchema = z.object({
  /**
   * Whether the passenger-occupancy term participates in the objective.
   *
   * FALSE means the controller weighs only even spacing and schedule delay —
   * the operator's two stated priorities. TRUE adds the in-vehicle cost, and
   * requires a calibrated passenger arrival rate: under the current 1/H*
   * proxy the term costs half a planned headway of hold per onboard
   * passenger, which silences the controller rather than making it kinder.
   */
  weighOccupancy: z.boolean(),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
  updateReason: z.string().nullable(),
});
export type ControlSettings = z.infer<typeof controlSettingsSchema>;

export async function readControlSettings(): Promise<ControlSettings> {
  const payload = await fetchControlService(SETTINGS_PATH, { method: 'GET' });
  const parsed = controlSettingsSchema.safeParse(payload);
  if (!parsed.success) throw new ControlServiceResponseShapeError(SETTINGS_PATH);
  return parsed.data;
}

/**
 * Flip a switch, attributed.
 *
 * `updatedBy` is the signed-in operator's email, resolved by the route
 * handler from the session rather than accepted from the request body — a
 * client-supplied actor on an audit trail is not an audit trail. control-
 * service cannot resolve it itself: it authenticates a service token, not a
 * person, which is the same reason dispatcher approvals are mirrored inline
 * rather than looked up there.
 */
export async function writeControlSettings(input: {
  weighOccupancy: boolean;
  updatedBy: string;
  updateReason: string;
}): Promise<ControlSettings> {
  const payload = await fetchControlService(SETTINGS_PATH, { method: 'PUT', body: input });
  const parsed = controlSettingsSchema.safeParse(payload);
  if (!parsed.success) throw new ControlServiceResponseShapeError(SETTINGS_PATH);
  return parsed.data;
}
