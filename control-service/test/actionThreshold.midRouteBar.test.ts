// The mid-route action bar, and the one property that makes its
// implementation form safe.
//
// `MID_ROUTE_ACTION_RATIO` is a control-law constant with an evidence trail
// behind it (see the docblock on the constant: 12 out-of-sample paired seeds
// across three corridors, bootstrap intervals, consistent sign). These tests
// do not re-derive that evidence - the fleet trial does. They pin the two
// things a future edit could break silently:
//
//   1. the effective bar the constant produces, and the pairs that now clear
//      it that did not before, and
//   2. that raising it moved the ACTION bar and left the DETECTOR's warning
//      bar exactly where it was.
//
// (2) is the whole reason the change was made here rather than by lowering
// `warning_threshold_ratio` in corridor config to 0.6, which would have given
// identical control results while silently changing what operators are
// alerted about. That equivalence means nothing downstream would have caught
// the difference, so it is asserted here.
import { describe, expect, it } from 'vitest';

import { evaluateBunchingRule } from '../src/headway/bunching.js';
import { MID_ROUTE_ACTION_RATIO, isWorthActingOn } from '../src/mpc/actionThreshold.js';

/** The seeded/preset corridor shape: warning at half of target headway. */
const TARGET_HEADWAY_SECONDS = 600;
const WARNING_THRESHOLD_RATIO = 0.5;

const policy = {
  targetHeadwaySeconds: TARGET_HEADWAY_SECONDS,
  warningThresholdRatio: WARNING_THRESHOLD_RATIO,
};

/** Forward headway, in seconds, for a pair sitting at `ratio` of target. */
const atRatioOfTarget = (ratio: number) => ratio * TARGET_HEADWAY_SECONDS;

describe('MID_ROUTE_ACTION_RATIO', () => {
  it('puts the effective mid-route action bar at 0.6 of target headway', () => {
    expect(MID_ROUTE_ACTION_RATIO).toBe(1.2);
    expect(WARNING_THRESHOLD_RATIO * MID_ROUTE_ACTION_RATIO).toBeCloseTo(0.6, 10);
  });

  it('acts on a pair between the alert bar and the action bar', () => {
    // 0.55 of target: inside the new bar, outside the old one. This is the
    // band the change exists to reach - the controller may now act just
    // BEFORE the deviation at which a human would be alarmed, rather than
    // only once it has arrived.
    expect(isWorthActingOn(atRatioOfTarget(0.55), policy)).toBe(true);
  });

  it('still declines a pair comfortably outside the bar', () => {
    expect(isWorthActingOn(atRatioOfTarget(0.7), policy)).toBe(false);
  });

  it('acts exactly at the bar and not one second above it', () => {
    const bar = WARNING_THRESHOLD_RATIO * TARGET_HEADWAY_SECONDS * MID_ROUTE_ACTION_RATIO;
    expect(bar).toBeCloseTo(360, 10);
    expect(isWorthActingOn(bar, policy)).toBe(true);
    expect(isWorthActingOn(bar + 1, policy)).toBe(false);
  });

  it('never acts on a null or non-finite forward headway', () => {
    // Absence of evidence, not licence to act. Raising the bar must not have
    // widened this.
    expect(isWorthActingOn(null, policy)).toBe(false);
    expect(isWorthActingOn(Number.NaN, policy)).toBe(false);
    expect(isWorthActingOn(Number.POSITIVE_INFINITY, policy)).toBe(false);
  });

  it('leaves the detector alert bar at warning_threshold_ratio, unscaled', () => {
    // The pair from the second test - actionable now, and still NOT a warning
    // to any operator. If a future edit implements the action bar by moving
    // `warning_threshold_ratio` instead, this flips to 'warning' and the
    // alert surface has changed without anyone deciding to change it.
    const ratios = [0.55, 0.55, 0.55];
    const requiredSamples = 3;
    const bunchedThresholdRatio = 0.25;

    const detected = evaluateBunchingRule(
      ratios,
      requiredSamples,
      bunchedThresholdRatio,
      WARNING_THRESHOLD_RATIO,
      false,
    );

    expect(detected.severity).toBeNull();
    expect(isWorthActingOn(atRatioOfTarget(0.55), policy)).toBe(true);
  });

  it('still alerts where it always did', () => {
    // The other side of the same property: 0.45 of target was a warning
    // before this change and is a warning after it.
    const detected = evaluateBunchingRule([0.45, 0.45, 0.45], 3, 0.25, WARNING_THRESHOLD_RATIO, false);
    expect(detected.severity).toBe('warning');
  });
});
