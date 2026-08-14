/**
 * What a bus is doing, in the words an operator would use.
 *
 * ─── WHY THIS IS A MODULE AND NOT A `.replace('_', ' ')` ─────────────────
 *
 * The depot's running order rendered `vehicle.stopState.replace(/_/g, ' ')`
 * and put `dwelling at stop` in front of a depot supervisor. That is not a
 * translation, it is the wire value with its underscores taken out — and
 * "dwelling" is a transit-planning word that a reader for whom English is a
 * second language has no reason to know. The control room shipped its own
 * private lookup table for the same six values, which is how the same bus
 * came to be described two ways on two screens.
 *
 * One table, exported, so the third screen that needs it inherits the words
 * rather than inventing a third set.
 *
 * ─── THE VOCABULARY RULING BEHIND EACH ONE ───────────────────────────────
 *
 * "Dwell" becomes "waiting at the stop" — the driver-facing panel already
 * made that choice and got it right. "Held" becomes "Held on instruction",
 * because a bus held by the controller and a bus stuck in traffic are both
 * "stopped" to a reader glancing at a column, and only one of them is
 * something the control room did on purpose. "Off route" becomes "Not on its
 * route", which says the same thing without reading as a status code.
 *
 * These describe the LIVE FEED's own classification. None of them is a
 * judgement: a bus not on its route may be perfectly correct and simply
 * running a road this system has not surveyed, so the words stay descriptive
 * and the colour stays off them.
 */
import type { StopState } from '@/models/control';

export const STOP_STATE_LABEL: Record<StopState, string> = {
  approaching_stop: 'Coming up to a stop',
  dwelling_at_stop: 'Waiting at a stop',
  held_by_controller: 'Held on instruction',
  stopped_in_traffic: 'Stopped in traffic',
  departed_stop: 'Just left a stop',
  off_route: 'Not on its route',
};

/**
 * The label for a stop state, falling back to the raw value rather than to a
 * dash.
 *
 * A control service that grows a seventh state must not make this column say
 * "nothing to report" about a bus that is doing something. The raw value is
 * ugly and honest; a dash would be neither, and `n/a` would be worse still —
 * the feed answered, and we simply have no word for what it said.
 *
 * Takes a non-null `StopState` because `vehicle_states.stopState` is required
 * on the wire. A caller holding a nullable one (the map's vehicle projection
 * does) decides for itself what absence means there, rather than having this
 * table decide on its behalf.
 */
export function stopStateLabel(state: StopState): string {
  return STOP_STATE_LABEL[state] ?? String(state).replace(/_/g, ' ');
}
