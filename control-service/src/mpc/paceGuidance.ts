// Pace guidance - the only spacing lever that costs no punctuality at all.
//
// ─── WHY THIS LEVER EXISTS ───────────────────────────────────────────────
//
// Every hold buys even spacing with delay: the bus stands still, and both it
// and everyone aboard end up later. That is the trade at the heart of the
// operator's two priorities, and it is unavoidable ONCE A PAIR HAS ALREADY
// COLLAPSED.
//
// It is entirely avoidable before then. A bus running AHEAD of its timetable
// and closing on the bus in front has slack of its own to spend. Asking it to
// ease off uses that slack rather than adding delay: the bus arrives closer
// to its scheduled time (punctuality IMPROVES), the gap in front reopens
// (spacing improves), and nobody aboard waits at a kerb for it. Both
// priorities move the same way at once, which no hold can do.
//
// It is also better for the people already on board. A hold is a bus sitting
// at a stop with the doors open for two minutes; pace guidance is a slightly
// slower run they never notice. Daganzo & Pilachowski (2011) is the
// underlying result - adaptive cruising speed from forward and backward
// headway, "bus-to-bus cooperation".
//
// ─── WHY IT IS ADVISORY AND NOT A COMMAND ────────────────────────────────
//
// `commands.action_type` has always admitted 'speed_guidance' and nothing
// has ever produced one, because producing one is not the hard part -
// DELIVERING it is. A hold is a single instruction a driver executes at a
// stop where they are already stationary. Pace guidance is a continuous
// target that only means anything if the driver can see it while moving,
// which needs a driver-facing display this system does not have, and which
// must never become something a driver reads mid-corner.
//
// So this module computes the recommendation and stops there. It is returned
// alongside the hold candidates for a dispatcher to act on by radio, and it
// is deliberately NOT a `CandidateAction`: the solver's selection rule ranks
// candidates by passenger-seconds and would happily choose a speed
// instruction the delivery path cannot carry. When a driver display exists,
// this becomes a candidate type; until then, the type system is what stops
// it being dispatched.
//
// ─── THE SAFETY POSTURE ──────────────────────────────────────────────────
//
// It only ever advises going SLOWER. The blueprint is explicit that guidance
// "must never encourage speeding, abrupt behavior, or distraction", and a
// controller that tells a late bus to hurry is a controller that has made
// road safety its adjustment variable. A bus running late is left alone here;
// the gap in front of it is closed by easing the bus BEHIND it instead.
import { clamp } from './math.js';
import type { HeadwayStateRow, RoutePolicyRow } from '../state/store.js';

/** Never advise a reduction below this share of current pace - a crawl is its own hazard, and an unfollowable instruction is ignored. */
export const MIN_PACE_FRACTION = 0.7;

/** Below this, the instruction is not worth giving: it is inside the noise of ordinary driving. */
export const MIN_MEANINGFUL_REDUCTION_KMPH = 3;

export interface PaceAdvisory {
  vehicleId: string;
  routeDirectionId: string;
  /** Always 'reduce_pace' - this module never advises going faster. See the header. */
  action: 'reduce_pace';
  currentSpeedKmph: number;
  /** The pace to ease to, already clamped to the corridor's configured safe band. */
  targetSpeedKmph: number;
  /** Seconds the vehicle is ahead of its timetable, and therefore the slack this spends. Null when no schedule is loaded. */
  scheduleSlackSeconds: number | null;
  /** One sentence for a dispatcher to read out. */
  rationale: string;
}

/**
 * Pace advice for one vehicle, or null when none applies.
 *
 * Requires ALL of:
 *   - the vehicle is closing on its leader (h_fwd below target);
 *   - a known current speed to advise a reduction from;
 *   - either schedule slack, or - when no timetable is loaded - a gap behind
 *     large enough that easing off cannot bunch it onto its follower.
 *
 * That last clause is what keeps this usable before the timetable arrives.
 * With a schedule, "is there slack?" is answered exactly. Without one, the
 * backward headway is the fallback question: a bus with a big gap behind it
 * can safely slow down whatever the timetable says, because the only vehicle
 * that could be harmed is far away.
 */
export function computePaceAdvisory(
  headwayState: HeadwayStateRow,
  currentSpeedKmph: number | null,
  scheduleDeviationSeconds: number | null,
  policy: RoutePolicyRow,
): PaceAdvisory | null {
  const { hFwdSeconds, hBwdSeconds, targetHeadwaySeconds } = headwayState;
  if (hFwdSeconds === null || currentSpeedKmph === null) return null;
  if (!Number.isFinite(currentSpeedKmph) || currentSpeedKmph <= 0) return null;

  // Not closing on anyone: nothing to correct.
  const closingSeconds = targetHeadwaySeconds - hFwdSeconds;
  if (closingSeconds <= 0) return null;

  // Is easing off free? Either the timetable says so, or the bus behind is
  // far enough away that it cannot be hurt by it.
  const slackSeconds =
    scheduleDeviationSeconds !== null && scheduleDeviationSeconds < 0
      ? -scheduleDeviationSeconds
      : Number.POSITIVE_INFINITY;
  const roomBehindSeconds =
    hBwdSeconds !== null && hBwdSeconds > targetHeadwaySeconds
      ? hBwdSeconds - targetHeadwaySeconds
      : Number.POSITIVE_INFINITY;
  // Neither bound is known: no evidence that easing off is free, so no advice.
  if (slackSeconds === Number.POSITIVE_INFINITY && roomBehindSeconds === Number.POSITIVE_INFINITY) {
    return null;
  }

  // How much of the shortfall this vehicle may absorb. Bounded by whichever
  // is scarcer: its own slack against the timetable, or the room behind it.
  // Spending more than either would fix the gap ahead by creating one behind
  // - the export-the-problem failure two-way control exists to prevent.
  const absorbableSeconds = Math.min(closingSeconds, slackSeconds, roomBehindSeconds);
  if (!Number.isFinite(absorbableSeconds) || absorbableSeconds <= 0) return null;

  // Translate a time correction into a pace one. Stretching the remaining
  // forward gap from h_fwd to h_fwd + absorbable means covering it at the
  // ratio of the two, since distance is fixed and time is what changes.
  const stretch = hFwdSeconds / (hFwdSeconds + absorbableSeconds);
  const rawTargetKmph = currentSpeedKmph * stretch;

  const floorKmph = Math.max(
    currentSpeedKmph * MIN_PACE_FRACTION,
    policy.speedBandMinKmph ?? 0,
  );
  const ceilingKmph = Math.min(currentSpeedKmph, policy.speedBandMaxKmph ?? currentSpeedKmph);
  if (ceilingKmph <= floorKmph) return null;

  const targetSpeedKmph = Math.round(clamp(rawTargetKmph, floorKmph, ceilingKmph));
  const reduction = currentSpeedKmph - targetSpeedKmph;
  if (reduction < MIN_MEANINGFUL_REDUCTION_KMPH) return null;

  const slackClause =
    scheduleDeviationSeconds !== null && scheduleDeviationSeconds < 0
      ? `it is ${Math.round(-scheduleDeviationSeconds)}s ahead of schedule, so easing off spends slack it already holds rather than adding delay`
      : `the bus behind is ${Math.round(hBwdSeconds ?? 0)}s back, so easing off cannot close that gap`;

  return {
    vehicleId: headwayState.followerVehicleId,
    routeDirectionId: headwayState.routeDirectionId,
    action: 'reduce_pace',
    currentSpeedKmph,
    targetSpeedKmph,
    scheduleSlackSeconds: scheduleDeviationSeconds,
    rationale:
      `Ease ${headwayState.followerVehicleId} from ${Math.round(currentSpeedKmph)} to ` +
      `${targetSpeedKmph} km/h: it has closed to ${Math.round(hFwdSeconds)}s behind the bus ` +
      `ahead against a ${Math.round(targetHeadwaySeconds)}s target, and ${slackClause}.`,
  };
}

/**
 * Pace advice for every vehicle on a corridor that can act on it.
 *
 * Sorted by the size of the reduction, largest first - the vehicle furthest
 * out of position is the one a dispatcher with a radio and limited time
 * should call.
 */
export function computePaceAdvisories(
  headwayStates: readonly HeadwayStateRow[],
  speedByVehicleId: ReadonlyMap<string, number | null>,
  scheduleDeviationByVehicleId: ReadonlyMap<string, number | null>,
  policy: RoutePolicyRow,
): PaceAdvisory[] {
  const advisories: PaceAdvisory[] = [];
  for (const headwayState of headwayStates) {
    const advisory = computePaceAdvisory(
      headwayState,
      speedByVehicleId.get(headwayState.followerVehicleId) ?? null,
      scheduleDeviationByVehicleId.get(headwayState.followerVehicleId) ?? null,
      policy,
    );
    if (advisory) advisories.push(advisory);
  }
  return advisories.sort(
    (a, b) =>
      b.currentSpeedKmph - b.targetSpeedKmph - (a.currentSpeedKmph - a.targetSpeedKmph),
  );
}
