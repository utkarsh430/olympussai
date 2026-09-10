// The forecast-admission gate: acting EARLY on the pairs predicted to come
// apart, and only on those.
//
// ─── WHAT THESE TESTS ARE FOR ────────────────────────────────────────────
//
// `MID_ROUTE_ACTION_RATIO` already bought the cheap half of the timing trade
// (0.5 -> 0.6 of H*, 12 out-of-sample paired seeds, guardrail unspent). What
// it could not buy is discrimination: a bar is a bar, so loosening it further
// admits the pairs heading for a bunch AND the pairs that were merely a
// little early and would have re-spaced on their own. Measured, that second
// group is what costs the guardrail.
//
// A forecast can tell them apart, and these tests pin the three properties
// that make the gate safe to widen a bar with. They do NOT claim the gate
// pays - only the fleet trial can say that, and the negative result is an
// acceptable answer.
//
//   1. A NULL forecast never admits. `headway/riskForecast.ts` returns null
//      whenever the trend cannot be trusted - too few samples, too short a
//      window, r-squared under 0.5, a physically impossible closing rate -
//      and null there means "the forecaster declined to speak", never "this
//      pair is fine". A gate that read absence as permission would act
//      earliest on exactly the corridors whose data is worst.
//   2. An OPENING gap never admits, however far above the bar the forecast
//      lands. `computeBunchingRisk` reports a positive slope calmly rather
//      than refusing, so "has a forecast" and "is deteriorating" are two
//      different questions and only the second is grounds for acting.
//   3. The gate is a WIDENING and never a narrowing. Anything the ordinary
//      bar already admits stays admitted whatever the forecast says - a
//      reassuring forecast must not veto a measured deviation, for the same
//      reason `headway/service.ts` lets reactive evidence outrank an
//      extrapolation.
import { describe, expect, it } from 'vitest';

import {
  MID_ROUTE_ACTION_RATIO,
  forecastAdmitsEarlyAction,
  isPairActionable,
  isWorthActingOn,
  midRouteActionBarSeconds,
} from '../src/mpc/actionThreshold.js';

/** The seeded/preset corridor shape: warning at half of target headway. */
const TARGET_HEADWAY_SECONDS = 600;
const WARNING_THRESHOLD_RATIO = 0.5;

const policy = {
  targetHeadwaySeconds: TARGET_HEADWAY_SECONDS,
  warningThresholdRatio: WARNING_THRESHOLD_RATIO,
};

/** Forward headway, in seconds, for a pair sitting at `ratio` of target. */
const atRatioOfTarget = (ratio: number) => ratio * TARGET_HEADWAY_SECONDS;

/** 0.6 of H* = 360 s on this corridor. */
const BAR = WARNING_THRESHOLD_RATIO * TARGET_HEADWAY_SECONDS * MID_ROUTE_ACTION_RATIO;

describe('midRouteActionBarSeconds', () => {
  it('is the one expression both the ordinary bar and the gate are drawn on', () => {
    // A flag and the number it describes are one expression, or they drift -
    // the same rule `deniedShare`/`saturated` is held to. If the gate ever
    // computed its own bar, the two could disagree about the same corridor.
    expect(midRouteActionBarSeconds(policy)).toBeCloseTo(BAR, 10);
    expect(isWorthActingOn(midRouteActionBarSeconds(policy), policy)).toBe(true);
  });
});

describe('forecastAdmitsEarlyAction', () => {
  it('admits a pair above the bar that is forecast to fall through it', () => {
    // 0.9 of H* now - comfortably outside the action bar and outside the
    // alert bar too - projected to 0.5 of H* at the horizon. This is the
    // pair the mechanism exists for: nothing in the CURRENT state justifies
    // an instruction, and the trend says one will be needed shortly.
    expect(isWorthActingOn(atRatioOfTarget(0.9), policy)).toBe(false);
    expect(
      forecastAdmitsEarlyAction(atRatioOfTarget(0.9), atRatioOfTarget(0.5), policy),
    ).toBe(true);
  });

  it('never admits on a null forecast', () => {
    // The single most important property here. Absence of a prediction is not
    // a prediction; a corridor whose GPS went quiet has not been observed to
    // be safe, and it has not been observed to be deteriorating either.
    expect(forecastAdmitsEarlyAction(atRatioOfTarget(0.9), null, policy)).toBe(false);
  });

  it('never admits on a non-finite forecast', () => {
    expect(forecastAdmitsEarlyAction(atRatioOfTarget(0.9), Number.NaN, policy)).toBe(false);
    expect(
      forecastAdmitsEarlyAction(atRatioOfTarget(0.9), Number.POSITIVE_INFINITY, policy),
    ).toBe(false);
  });

  it('never admits when the pair has no measured forward headway', () => {
    // A forecast is a projection FROM a measurement. With no present state
    // there is nothing to project from and nothing for a hold to correct,
    // and `isWorthActingOn` already refuses the same input for the same
    // reason.
    expect(forecastAdmitsEarlyAction(null, atRatioOfTarget(0.4), policy)).toBe(false);
    expect(forecastAdmitsEarlyAction(Number.NaN, atRatioOfTarget(0.4), policy)).toBe(false);
  });

  it('never admits a gap that is opening', () => {
    // A pair currently at 0.3 of H* (already bunched) forecast to recover to
    // 0.8 is improving on its own. The forecast is real, believed, and says
    // the opposite of what this gate acts on. Note the forecast here is ABOVE
    // the bar so the crossing test alone would also refuse it; the next case
    // is the one that separates the two conditions.
    expect(forecastAdmitsEarlyAction(atRatioOfTarget(0.3), atRatioOfTarget(0.8), policy)).toBe(
      false,
    );
  });

  it('never admits a gap that is opening even when the forecast is still under the bar', () => {
    // 0.2 -> 0.5 of H*: both ends under the 0.6 bar, so a gate written as
    // "forecast under the bar" alone would admit it. It is recovering, and
    // the pair is already admitted by the ordinary bar anyway - the gate must
    // not claim credit for pairs it did not reach.
    expect(forecastAdmitsEarlyAction(atRatioOfTarget(0.2), atRatioOfTarget(0.5), policy)).toBe(
      false,
    );
  });

  it('never admits a flat gap', () => {
    // Zero closing rate is a forecast `computeBunchingRisk` reports calmly and
    // with r-squared 1. Steady is not deteriorating.
    const steady = atRatioOfTarget(0.9);
    expect(forecastAdmitsEarlyAction(steady, steady, policy)).toBe(false);
  });

  it('declines a pair that is closing but not forecast to reach the bar', () => {
    // 1.5 -> 0.8 of H* is a real, believed, closing trend, and at the horizon
    // the pair is still outside the deviation at which this controller acts.
    // Admitting it would be the indiscriminate lower bar this gate exists to
    // avoid, wearing a forecast as justification.
    expect(forecastAdmitsEarlyAction(atRatioOfTarget(1.5), atRatioOfTarget(0.8), policy)).toBe(
      false,
    );
  });

  it('admits exactly at the bar and not one second above it', () => {
    const current = atRatioOfTarget(0.9);
    expect(forecastAdmitsEarlyAction(current, BAR, policy)).toBe(true);
    expect(forecastAdmitsEarlyAction(current, BAR + 1, policy)).toBe(false);
  });
});

describe('isPairActionable', () => {
  const pairAt = (hFwdSeconds: number | null, forecastHFwdSeconds: number | null) => ({
    hFwdSeconds,
    forecastHFwdSeconds,
  });

  it('is byte-identical to the ordinary bar when the gate is off', () => {
    // The flag ships off, so this is the deployed behaviour and it must not
    // move. Every case below carries a forecast the gate WOULD have admitted.
    for (const ratio of [0.2, 0.55, 0.6, 0.7, 0.9, 1.5]) {
      expect(isPairActionable(pairAt(atRatioOfTarget(ratio), atRatioOfTarget(0.4)), policy, false)).toBe(
        isWorthActingOn(atRatioOfTarget(ratio), policy),
      );
    }
    expect(isPairActionable(pairAt(null, atRatioOfTarget(0.4)), policy, false)).toBe(false);
  });

  it('widens the bar for a deteriorating pair when the gate is on', () => {
    const pair = pairAt(atRatioOfTarget(0.9), atRatioOfTarget(0.5));
    expect(isPairActionable(pair, policy, false)).toBe(false);
    expect(isPairActionable(pair, policy, true)).toBe(true);
  });

  it('leaves a pair with no forecast exactly where the ordinary bar left it', () => {
    // Switching the gate on must be a no-op on every pair the forecaster
    // declined to speak about - which, on a corridor whose samples are sparse,
    // is most of them.
    for (const ratio of [0.2, 0.55, 0.7, 0.9]) {
      const pair = pairAt(atRatioOfTarget(ratio), null);
      expect(isPairActionable(pair, policy, true)).toBe(isWorthActingOn(atRatioOfTarget(ratio), policy));
    }
  });

  it('never narrows: a reassuring forecast cannot veto a measured deviation', () => {
    // 0.3 of H* is bunched by measurement and forecast to recover to 0.8. The
    // reactive reading wins, exactly as it does in `headway/service.ts` -
    // an observation outranks an extrapolation.
    const pair = pairAt(atRatioOfTarget(0.3), atRatioOfTarget(0.8));
    expect(isWorthActingOn(atRatioOfTarget(0.3), policy)).toBe(true);
    expect(isPairActionable(pair, policy, true)).toBe(true);
  });
});
