// Whether a leader/follower pair is deviant enough to be worth a mid-route
// hold at all.
//
// ─── THE DEFECT THIS CLOSES ──────────────────────────────────────────────
//
// The mid-route laws are proportional controllers: `Kf x (H* - h_fwd)` is
// non-zero for ANY shortfall, however small, so a pair 10% inside target
// generates a hold exactly as readily as a pair that has collapsed. Nothing
// downstream asked whether the pair was actually in trouble - `safety.ts`
// grades staleness, hold caps, lateness and cooldown, and `minimum_action_
// seconds` filters by the LENGTH of the hold rather than by the state that
// produced it.
//
// MEASURED on a 1,000-bus trial: 83% of every hold the laws proposed went to
// a pair whose h_fwd/H* was above `warning_threshold_ratio` - pairs the
// corridor's own detector does not consider even a warning, and which no
// operator would ever have been shown. The median pair being held sat at 0.70
// of target headway. Each of those holds is paid for by everyone already on
// the bus, and in aggregate they were the difference between a controller that
// helps and one that does not: total passenger time went UP 13% while the
// headline excess-wait figure went DOWN 44%.
//
// ─── WHY THIS RATIO AND NOT A NEW ONE ────────────────────────────────────
//
// `warning_threshold_ratio` is already the corridor's own answer to "is this
// gap worth telling a human about". Acting below it means the controller is
// issuing instructions about pairs its own alert surface would not raise, and
// there is no coherent reading of the system in which that is right. Reusing
// it also means the bar moves with the corridor - it is config, per
// route-direction, not a constant chosen here.
//
// ─── WHY NOT IN safety.ts ────────────────────────────────────────────────
//
// Same reason `mpc/eligibility.ts` skips rather than rejects: a pair that is
// merely a little early is the NORMAL state of most pairs most of the time. It
// is the absence of an opportunity, not a guardrail firing, and reporting
// twenty "not deviant enough" rejections per solve would bury the handful that
// are genuinely news.
//
// TERMINAL DISPATCH IS DELIBERATELY NOT GATED. Algorithm A regulates an
// elapsed departure headway at the origin, where holding costs no passenger
// their seat because nobody is aboard yet - the one lever whose cost really is
// near zero. Applying a deviation bar to it would suppress the cheapest
// correction in the system to save a cost it does not incur.
import type { RoutePolicyRow } from '../state/store.js';

/**
 * Multiplier on `warning_threshold_ratio` that sets the mid-route action bar.
 *
 * ONE, deliberately, and not a fitted number. A sweep over this constant on the
 * 1,000-bus trial scored marginally better at 0.8 (net passenger time +0.2%
 * against -3.1%), and 0.8 was rejected anyway: it is a number with a good score
 * and no argument behind it, and the difference was inside the seed-to-seed
 * noise of a single trial. At 1.0 the bar is exactly the corridor's own
 * `warning_threshold_ratio` - the same number its alert surface uses to decide
 * whether a human is told - which is a rule that can be stated, defended, and
 * changed per corridor by changing the corridor's configuration rather than
 * this file.
 */
export const MID_ROUTE_ACTION_RATIO = 1.0;

/**
 * True when this pair's forward headway has fallen far enough to be worth a
 * mid-route instruction.
 *
 * A null h_fwd is NOT worth acting on: it means the pair has no measurable
 * forward headway, which is an absence of evidence and never a licence to act.
 */
export function isWorthActingOn(
  hFwdSeconds: number | null,
  policy: Pick<RoutePolicyRow, 'targetHeadwaySeconds' | 'warningThresholdRatio'>,
): boolean {
  if (hFwdSeconds === null || !Number.isFinite(hFwdSeconds)) return false;
  const bar = policy.warningThresholdRatio * policy.targetHeadwaySeconds * MID_ROUTE_ACTION_RATIO;
  return hFwdSeconds <= bar;
}

/**
 * The most this vehicle may be held, given how many people are already on it.
 *
 * ─── THE TRADE THIS PRICES ───────────────────────────────────────────────
 *
 * A hold buys waiting time for the people at the stops downstream and is paid
 * for by everyone aboard. The bill is `hold x onboard`, and it is not small: on
 * a corridor carrying forty-five passengers where eleven are waiting at the
 * next station, a second of hold costs four times what it saves. MEASURED on a
 * 1,000-bus trial with holding ungated, the controller removed 2,251 hours of
 * waiting and added 4,214 hours of onboard delay - a 12% INCREASE in total
 * passenger time, while the headline excess-wait figure improved 46%.
 *
 * `control_settings.weigh_occupancy` exists to prevent exactly this, and could
 * not: it feeds the load into `objectiveCost`, which is a RANKING input, and
 * the mid-route laws are mutually exclusive by construction so there is never
 * more than one selectable candidate for a ranking to reorder. Switching it on
 * changed the price of every hold and not one of the decisions - measured
 * across 4,960 matched decisions, zero changed.
 *
 * So the load has to bind on the ACTION, not on the ordering. A near-empty bus
 * may be held to the policy's full cap; a full one may barely be held at all.
 *
 * ─── WHY A LINEAR TAPER AND NOT THE CLOSED-FORM OPTIMUM ──────────────────
 *
 * `objective.ts#optimalHoldSeconds` already gives the exact argmin, and it is
 * the right answer the day lambda is calibrated. It cannot be used today:
 * `arrivalRatePaxPerSecond` returns `1/H*` - one passenger per headway, where
 * this corridor sees eleven - so the load penalty overwhelms the wait term and
 * a single passenger zeroes any hold. A taper is deliberately cruder and
 * deliberately bounded: it can shorten a hold and can never invert one, so it
 * cannot silence the controller the way an uncalibrated argmin would.
 *
 * Below `OCCUPANCY_TAPER_FLOOR` the cap stops falling. A bus at crush load
 * still gets a short hold rather than none, because a corridor whose buses are
 * all full is exactly the one where a bunch strands the most people, and going
 * completely silent there is the failure this system exists to prevent.
 *
 * ─── AND IT IS NOT A FLAT CAP IN DISGUISE ────────────────────────────────
 *
 * The obvious objection: loads sit near 80% of capacity most of the time, so
 * the taper is pinned at its floor and amounts to "hold for a quarter as long".
 * Measured against flat caps on the same corridor, it is not - it beats a flat
 * 300 s cap on BOTH axes (21.4% excess-wait gain against 19.2%, total passenger
 * time -1.28% against -2.73%) and beats a flat 200 s cap on wait gain at
 * comparable cost. A flat cap shortens every hold equally; this spends the
 * budget where a hold is cheap and withholds it where it is expensive, and that
 * difference is worth about two points of wait gain. See docs/FLEET_TRIAL.md.
 */
export const OCCUPANCY_TAPER_FLOOR = 0.25;

export function occupancyAdjustedMaxHoldSeconds(
  maxHoldSeconds: number,
  loadPassengers: number | null,
  occupancyCapacity: number | null,
): number {
  // No reading, or no capacity to measure it against, means no taper. This is
  // the deployed state on every corridor today, so the default behaviour is
  // exactly what it was.
  if (loadPassengers === null || occupancyCapacity === null || occupancyCapacity <= 0) {
    return maxHoldSeconds;
  }
  const loadFactor = Math.min(1, Math.max(0, loadPassengers / occupancyCapacity));
  const scale = Math.max(OCCUPANCY_TAPER_FLOOR, 1 - loadFactor);
  return maxHoldSeconds * scale;
}
