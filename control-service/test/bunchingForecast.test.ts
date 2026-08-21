// Predicting a bunch before it happens - and, far more often, refusing to.
//
// This tier makes a claim about a future an operator cannot check by looking
// out of the window. A wrong reactive alert costs a glance; a wrong prediction
// cannot be falsified in the moment and just erodes into noise, taking the
// real ones with it. So the refusals below carry as much weight as the
// detections: each one is a case where the honest report is silence.
import { describe, it, expect } from 'vitest';
import {
  computeBunchingRisk,
  computeClosingRate,
  forecastHorizonSeconds,
  MAX_HORIZON_SECONDS,
  MAX_PLAUSIBLE_CLOSING_RATE,
  MIN_HORIZON_SECONDS,
  MIN_TREND_SAMPLES,
  type HeadwaySampleObservation,
} from '../src/headway/riskForecast.js';
import {
  evaluatePredictiveRule,
  MIN_PREDICTION_CONFIDENCE,
  PREDICTION_CLEAR_RISK,
} from '../src/headway/bunching.js';

const BASE = Date.UTC(2026, 7, 20, 6, 0, 0);

/**
 * Samples newest-first, as the repository returns them, one per `stepSeconds`
 * going back in time. `headways` is oldest-first for readability.
 */
function samples(headways: number[], stepSeconds = 60): HeadwaySampleObservation[] {
  return headways
    .map((h, i) => ({
      hFwdSeconds: h,
      computedAt: new Date(BASE + i * stepSeconds * 1000).toISOString(),
    }))
    .reverse();
}

describe('computeClosingRate', () => {
  it('measures a steadily closing gap as a negative rate', () => {
    // 18s of gap lost per 60s step: -0.3 s/s, a rate a real pair sustains.
    const rate = computeClosingRate(samples([1000, 982, 964, 946, 928, 910]));
    expect(rate).not.toBeNull();
    expect(rate!.secondsPerSecond).toBeCloseTo(-0.3, 6);
    expect(rate!.rSquared).toBeCloseTo(1, 6);
    expect(rate!.windowSeconds).toBe(300);
  });

  it('measures an opening gap as a positive rate', () => {
    expect(computeClosingRate(samples([600, 660, 720, 780, 840]))!.secondsPerSecond).toBeGreaterThan(0);
  });

  // A flat gap has zero variance to explain. The line through it is correct
  // and horizontal, so the fit is perfect rather than undefined - and this is
  // the "steady, nothing happening" case, which must report calmly.
  it('calls a perfectly steady gap a perfect fit with zero slope', () => {
    const rate = computeClosingRate(samples([600, 600, 600, 600, 600]));
    expect(rate!.secondsPerSecond).toBe(0);
    expect(rate!.rSquared).toBe(1);
  });

  // ─── THE REFUSALS ──────────────────────────────────────────────────────

  // Two points always fit a line perfectly; that is arithmetic, not evidence.
  it('refuses to fit fewer samples than the minimum', () => {
    expect(computeClosingRate(samples([900, 800, 700]))).toBeNull();
    expect(computeClosingRate(samples(Array.from({ length: MIN_TREND_SAMPLES }, (_, i) => 900 - i * 60)))).not.toBeNull();
  });

  // Sample count is not observation time. Four samples inside forty seconds
  // describe forty seconds, and extrapolating ten minutes from them is
  // unfounded however well the line fits.
  it('refuses a window too short to extrapolate from, however many samples', () => {
    expect(computeClosingRate(samples([900, 880, 860, 840, 820], 5))).toBeNull();
  });

  it('refuses when every sample landed at the same instant', () => {
    const stacked = [900, 800, 700, 600].map((h) => ({
      hFwdSeconds: h,
      computedAt: new Date(BASE).toISOString(),
    }));
    expect(computeClosingRate(stacked)).toBeNull();
  });
});

/**
 * A pair on a 1800 s corridor - UPSRTC's median planned headway. Bunched at
 * 0.25 x 1800 = 450 s, and the horizon is the one the service derives for
 * that headway (1800 s), not a constant, so these exercise the real numbers.
 */
const TARGET = 1800;
const BUNCHED_AT = 450;
const HORIZON = forecastHorizonSeconds(TARGET);

/**
 * The tier's reason for existing, as data.
 *
 * 950 s of gap on a 1800 s corridor is ratio 0.53 - OUTSIDE the 0.5 warning
 * threshold, so the reactive rule is silent about this pair no matter how
 * many samples it is given. It is closing at 0.5 s/s, which reaches the 450 s
 * bunched threshold in 1000 s: inside the 1800 s horizon, and near enough to
 * clear the opening bar.
 */
const CLOSING_BUT_STILL_IN_TOLERANCE = [1100, 1070, 1040, 1010, 980, 950];

function risk(headways: number[], overrides: Partial<Parameters<typeof computeBunchingRisk>[0]> = {}) {
  return computeBunchingRisk({
    samples: samples(headways),
    currentHFwdSeconds: headways[headways.length - 1]!,
    targetHeadwaySeconds: TARGET,
    bunchedThresholdRatio: 0.25,
    horizonSeconds: HORIZON,
    ...overrides,
  });
}

describe('computeBunchingRisk', () => {
  // The case the whole tier exists for: still well inside tolerance (600/1200
  // = ratio 0.5), and the reactive rule says nothing - but closing at 1s per
  // second, so it reaches the 300s bunched threshold in five minutes.
  it('forecasts a crossing for a gap that is still fine but closing fast', () => {
    // 1350s of gap - ratio 0.75, comfortably outside the 0.5 warning
    // threshold, so the reactive rule says NOTHING about this pair - closing
    // at 0.3 s/s. It reaches the 450s bunched threshold in (1350-450)/0.3 =
    // 3000s... which is beyond the 1800s horizon, so it should NOT fire.
    const quiet = risk([1440, 1422, 1404, 1386, 1368, 1350]);
    expect(quiet!.secondsToBunching).toBeNull();

    // The same ratio, closing at 0.6 s/s: (1350-450)/0.6 = 1500s, inside the
    // horizon. Still invisible to the reactive rule, and now forecast.
    const closing = risk([1530, 1494, 1458, 1422, 1386, 1350]);
    expect(closing).not.toBeNull();
    expect(closing!.secondsToBunching).toBeCloseTo(1500, 0);
    expect(closing!.forecastRatio).toBeLessThan(0.25);
    expect(closing!.confidence).toBeGreaterThan(MIN_PREDICTION_CONFIDENCE);
  });

  it('derives a horizon from the corridor headway, bounded at both ends', () => {
    expect(forecastHorizonSeconds(1800)).toBe(1800);
    expect(forecastHorizonSeconds(600)).toBe(600);
    // A 2-minute headway would give a horizon shorter than it takes to route
    // an instruction to a driver.
    expect(forecastHorizonSeconds(120)).toBe(MIN_HORIZON_SECONDS);
    // A 2-hour headway would forecast against traffic that has not happened.
    expect(forecastHorizonSeconds(7200)).toBe(MAX_HORIZON_SECONDS);
  });

  it('scores an imminent crossing above a distant one', () => {
    // 660s closing at 0.6 -> crosses in 350s. Very near.
    const imminent = risk([840, 804, 768, 732, 696, 660]);
    // 1350s closing at 0.6 -> crosses in 1500s. Near the horizon edge.
    const distant = risk([1530, 1494, 1458, 1422, 1386, 1350]);
    expect(imminent!.riskScore).toBeGreaterThan(distant!.riskScore);
  });

  it('says a widening gap is not heading for a bunch', () => {
    const r = risk([600, 660, 720, 780, 840]);
    expect(r!.secondsToBunching).toBeNull();
    expect(r!.riskScore).toBe(0);
  });

  // The whole point of the tier, stated as one assertion: a pair the reactive
  // rule is silent about, that this one is not.
  it('speaks about a pair the reactive rule cannot see yet', () => {
    const r = risk(CLOSING_BUT_STILL_IN_TOLERANCE);
    // Ratio 0.53 - above the 0.5 warning threshold, so `evaluateBunchingRule`
    // returns no severity for this pair on any number of samples.
    expect(950 / TARGET).toBeGreaterThan(0.5);
    expect(r!.secondsToBunching).toBeCloseTo(1000, 0);
    expect(r!.forecastHFwdSeconds).toBeLessThan(BUNCHED_AT);
  });

  // A crossing eleven minutes out, on a ten-minute horizon, is not something
  // anyone can act on now - the trend will be re-fitted ten times before it.
  it('reports no crossing when it falls beyond the horizon', () => {
    // Closing at 0.05 s/s: 10500s to the threshold, far past the horizon.
    const r = risk([1515, 1512, 1509, 1506, 1503, 1500]);
    expect(r!.secondsToBunching).toBeNull();
  });

  // ─── THE REFUSALS ──────────────────────────────────────────────────────

  // Scatter, not a trend. A forecast drawn through it is a coin flip wearing
  // a number.
  it('says nothing when the samples do not lie on a line', () => {
    expect(risk([1400, 600, 1350, 500, 1380, 550])).toBeNull();
  });

  // A follower closing at half a second of gap per second of clock is doing
  // roughly triple its leader's speed for minutes. That is a map-match that
  // has jumped the pair, not a bus.
  it('says nothing about a closing rate no bus could produce', () => {
    // Beyond -1 s/s the leader would have to be travelling backwards.
    const perSample = MAX_PLAUSIBLE_CLOSING_RATE * 60 * 1.5;
    const runaway = [6000, 6000 - perSample, 6000 - 2 * perSample, 6000 - 3 * perSample, 6000 - 4 * perSample];
    expect(risk(runaway, { currentHFwdSeconds: runaway[runaway.length - 1]! })).toBeNull();
  });

  // ...but a follower closing on a leader that has stopped dead is real, and
  // sits just inside the bound rather than being thrown away with the
  // map-match failures.
  it('still speaks about a follower closing on a stationary leader', () => {
    const perSample = 0.9 * 60;
    const onto = [1800, 1800 - perSample, 1800 - 2 * perSample, 1800 - 3 * perSample, 1800 - 4 * perSample];
    const r = risk(onto, { currentHFwdSeconds: onto[onto.length - 1]! });
    expect(r).not.toBeNull();
    expect(r!.secondsToBunching).not.toBeNull();
  });

  it('says nothing without enough history to fit', () => {
    expect(risk([1400, 1300])).toBeNull();
  });

  it('says nothing without a usable target headway', () => {
    expect(risk([1400, 1370, 1340, 1310, 1280], { targetHeadwaySeconds: 0 })).toBeNull();
  });

  // Amplification only ever makes a CLOSING gap close faster. Applying it to
  // an opening one would forecast buses flying apart - the wrong failure, and
  // not the one this system exists for.
  it('steepens a closing gap with a fitted dwell model but never an opening one', () => {
    const model = {
      stopId: 'stop-A',
      routeDirectionId: 'rd-1',
      beta0Seconds: 10,
      betaHeadway: 0.5, // amplification 1.5
      rSquared: 0.9,
      sampleCount: 40,
    };
    const closing = risk([1530, 1494, 1458, 1422, 1386, 1350]);
    const closingAmplified = risk([1530, 1494, 1458, 1422, 1386, 1350], { dwellModel: model });
    expect(closingAmplified!.closingRateSecondsPerSecond).toBeCloseTo(
      closing!.closingRateSecondsPerSecond * 1.5,
      6,
    );

    const opening = risk([600, 660, 720, 780, 840]);
    const openingAmplified = risk([600, 660, 720, 780, 840], { dwellModel: model });
    expect(openingAmplified!.closingRateSecondsPerSecond).toBe(opening!.closingRateSecondsPerSecond);
  });
});

describe('evaluatePredictiveRule', () => {
  const closing = risk(CLOSING_BUT_STILL_IN_TOLERANCE)!;

  it('opens on a confident forecast of an imminent crossing', () => {
    const verdict = evaluatePredictiveRule(closing, false);
    expect(verdict.predicted).toBe(true);
    expect(verdict.reason).toContain('forecast to breach');
  });

  // THE LOAD-BEARING ONE. A null risk is "the forecaster declined to speak",
  // not "this pair is safe". Treating the two alike would clear every open
  // prediction the moment a corridor's GPS went quiet - reporting an
  // improvement that nothing observed.
  it('neither opens nor closes when there is no forecast at all', () => {
    const verdict = evaluatePredictiveRule(null, true);
    expect(verdict.predicted).toBe(false);
    expect(verdict.riskCleared).toBe(false);
  });

  // Same principle: a later, noisier sweep has not refuted the forecast that
  // opened the incident. It has stopped speaking.
  it('does not clear an open prediction merely because confidence dropped', () => {
    const unsure = { ...closing, confidence: MIN_PREDICTION_CONFIDENCE - 0.1 };
    const verdict = evaluatePredictiveRule(unsure, true);
    expect(verdict.predicted).toBe(false);
    expect(verdict.riskCleared).toBe(false);
  });

  it('clears an open prediction once the risk really has fallen away', () => {
    const cleared = { ...closing, riskScore: PREDICTION_CLEAR_RISK - 0.01 };
    expect(evaluatePredictiveRule(cleared, true).riskCleared).toBe(true);
  });

  // Hysteresis: the level that KEEPS an incident open is below the level that
  // opens one, so a pair hovering near the threshold does not open and close
  // an alert on alternate sweeps - once a minute, forever.
  it('holds an open prediction at a risk that would not have opened it', () => {
    const middling = { ...closing, riskScore: (PREDICTION_CLEAR_RISK + 0.35) / 2 };
    expect(evaluatePredictiveRule(middling, false).predicted).toBe(false);
    expect(evaluatePredictiveRule(middling, true).predicted).toBe(true);
    expect(evaluatePredictiveRule(middling, true).riskCleared).toBe(false);
  });

  it('does not open on a pair that is not closing at all', () => {
    expect(evaluatePredictiveRule(risk([600, 660, 720, 780, 840]), false).predicted).toBe(false);
  });
});
