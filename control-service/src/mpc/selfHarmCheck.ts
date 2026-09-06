// The self-harm check: a law refusing to emit an action its own objective
// prices as net harmful.
//
// ─── WHERE THIS CAME FROM ────────────────────────────────────────────────
//
// `mpc/costOptimalHold.ts` has always ended with `if (score.objectiveCost >= 0)
// continue`. Its stated reason is local - a clamped argmin is just another
// feasible point and has no claim on being best - but the property it buys is
// general: that law "can never make the selection worse than not having run at
// all", as judged by the objective.
//
// The other four laws price their candidate through the same
// `objective.ts#computePassengerCost` and then emit it whatever the answer.
// MEASURED on the urban fleet trial with occupancy weighting ON, the mean
// objectiveCost of the SELECTED candidates - which are exactly these laws'
// holds, `cost_optimal` being unselectable - is +1,021.4 passenger-seconds.
// Suburban is +1,874.0 and inter-city +4,271.4. On its own reading the
// controller is issuing thousands of instructions it scores as net harmful.
//
// ─── AND WHY IT IS OFF BY DEFAULT ────────────────────────────────────────
//
// Because the objective is measured to be WRONG about that, and the check
// inherits every bit of the error.
//
// Over 20,423 urban holds (HANDOFF.md section 7) the objective's cost side is
// accurate to about 17% while its benefit side sees 1.4% of the waiting time a
// hold actually removes - it estimates `lambda x d x (d + h_fwd - h_bwd)`, a
// ONE-STOP marginal figure, for a benefit that accrues over twenty-five
// downstream stops and to every following bus. On urban it therefore reports a
// net COST on the corridor where holding demonstrably works. A check keyed to
// that number does not decline harmful holds; it declines holds the objective
// cannot see the benefit of, which is nearly all of them.
//
// That is not an argument, it is the measurement. With this switch ON and
// occupancy weighting on, the controller stops holding: urban goes 2,086 holds
// to 3 and total passenger time +4.69% -> +0.02%, while suburban and inter-city
// issue ZERO on every seed. Occupancy-blind it halves the holds and spends
// 2.5-4.3 points of excess-wait gain - the headline - to raise an
// already-satisfied guardrail by about a third of a point, which is optimising
// the tripwire instead of the target. See docs/SELF_HARM_CHECK.md.
//
// So this ships OFF, as an instrument rather than a fix. It is the cheapest way
// to answer "what would the controller do if it believed its own objective?",
// and the answer is on record. Turn it on when the objective's predicted
// benefit matches a measured one - which needs a multi-stop wait term, not
// merely a calibrated lambda - and re-run all three corridors before and after.
// That is the same precondition `COST_OPTIMAL_SELECTION_ENABLED` waits on, for
// the same reason, and neither should be flipped without the other.
//
// ─── WHAT IT DELIBERATELY DOES NOT COVER ─────────────────────────────────
//
// `boarding_limit` sets `objectiveCost: 0` as a documented placeholder - its
// cost needs lambda and its benefit needs a fitted dwell model, so NEITHER side
// is priced. Zero there means "nobody has measured this", and `>= 0` is true of
// it, so applying this predicate would decline 100% of alighting-only proposals
// on every corridor forever. That is not the protection `cost_optimal` has, it
// is deleting a law on the strength of a sentinel. The law takes no flag, and
// `test/selfHarmCheck.test.ts` pins that.

/**
 * Whether the objective prices this candidate as doing no good.
 *
 * The predicate is `costOptimalHold.ts`'s, character for character, so the four
 * laws and the fifth cannot drift apart on what "harmful" means. `>= 0` and not
 * `> 0`: an action the objective scores as exactly breaking even has no case
 * for spending a driver's compliance, which is the same reading the closed form
 * has always taken.
 *
 * Only ever consulted on a candidate whose `objectiveCost` is a real netted
 * figure. See this file's header for why `boarding_limit` is not one.
 */
export function isScoredSelfHarmful(objectiveCost: number): boolean {
  return objectiveCost >= 0;
}
