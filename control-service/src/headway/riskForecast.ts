// Bunching BEFORE it has happened: projecting a closing gap forward in time.
//
// ─── THE GAP THIS CLOSES ─────────────────────────────────────────────────
//
// Detection in this service has always been a rule about the CURRENT gap:
// `evaluateBunchingRule` takes the last k headway ratios and asks whether
// every one of them sits under a threshold. It has no time derivative. A pair
// holding steady at ratio 0.9 and a pair that was at 1.4 four minutes ago and
// is now at 0.9 - closing at a rate that puts it under the bunched threshold
// inside seven minutes - are indistinguishable to it. Both report "nothing".
//
// That is not a tuning problem, it is a structural one. By the time a ratio
// crosses the bunched threshold the buses ARE bunched: the headway has already
// collapsed, the follower is already carrying the load the leader left behind,
// and the cheapest correction - a small hold, taken early, at a stop the bus
// was going to serve anyway - is no longer available. What remains is a large
// hold that costs punctuality, or nothing.
//
// Bus bunching is an unstable equilibrium. A headway deviation does not decay,
// it grows: `h_{s+1} ~= (1 + beta_h) * h_s` where beta_h is the slope of dwell
// time on preceding headway (src/calibration/dwell.ts fits exactly this). The
// eigenvalue exceeds 1, so the process runs away from the setpoint on its own.
// The single most valuable property of a controller on an unstable plant is
// that it acts EARLY, while the correction is still small. This module is what
// lets it.
//
// ─── WHAT IS FORECAST, AND FROM WHAT ─────────────────────────────────────
//
// `headway_states` already carries one sample per leader/follower pair per
// sweep, roughly once a minute, with `computed_at`. That is a time series of
// the forward headway. Regressing h_fwd on time gives:
//
//   closing rate   dh/dt, seconds of gap lost per second of clock. Negative
//                  means the follower is catching the leader.
//   forecast       h_fwd + (dh/dt) * horizon
//   time-to-bunch  how long until h_fwd reaches the bunched threshold
//
// Least squares rather than a first-difference (h_now - h_prev) because a
// single differenced pair of GPS-derived headways is dominated by map-matching
// noise: at a 60 s cadence a 15 s wobble in either sample reads as a 0.25
// closing rate, which forecasts a bunch inside four minutes out of pure error.
// The regression averages that down and, more importantly, REPORTS how well
// the line fits, so a noisy pair can be refused rather than believed.
//
// ─── THE COLUMN THAT WAS ALWAYS EMPTY ────────────────────────────────────
//
// `headway_states.forecast_h_fwd_seconds` has existed since the core data
// model and nothing has ever written to it - `insertHeadwaySample` does not
// name it in its column list, so every row ever written carries NULL. The
// schema anticipated this layer; it was never built. This module supplies the
// value, and `service.ts` now stores it.
//
// ─── WHY THIS REFUSES SO OFTEN ───────────────────────────────────────────
//
// A predicted incident is a claim about something that has not happened yet,
// raised to an operator who must decide whether to act on it. It is spent
// credibility if it is wrong. Every refusal below exists because acting on a
// bad forecast is worse than not forecasting: a control room that learns the
// predictions are noise stops reading them, and then the real ones are lost
// too. The bar is deliberately higher than the reactive rule's, because the
// reactive rule is reporting an observation and this is making a prediction.

import type { DwellModel } from '../calibration/dwell.js';
import { headwayAmplification } from '../calibration/dwell.js';

/** One persisted `headway_states` row, reduced to what a trend needs. */
export interface HeadwaySampleObservation {
  /** Forward headway in seconds. Null samples are dropped by the caller. */
  hFwdSeconds: number;
  /** ISO timestamp from `headway_states.computed_at`. */
  computedAt: string;
}

export interface ClosingRate {
  /**
   * Seconds of forward headway gained per second of clock. NEGATIVE means the
   * follower is closing on its leader, which is the direction that matters.
   */
  secondsPerSecond: number;
  /** Goodness of fit, 0..1. Low means the samples do not lie on a line. */
  rSquared: number;
  sampleCount: number;
  /** Clock span the fit was made over, seconds. */
  windowSeconds: number;
}

export interface BunchingRisk {
  /** Projected forward headway at the horizon, seconds. Never negative. */
  forecastHFwdSeconds: number;
  /** Projected ratio against H* at the horizon. */
  forecastRatio: number;
  closingRateSecondsPerSecond: number;
  /**
   * Seconds until the forward headway would reach the bunched threshold at
   * the current closing rate. Null when the pair is not closing, or when the
   * crossing lies beyond the horizon.
   */
  secondsToBunching: number | null;
  /** 0..1. Rises as the predicted crossing gets nearer. */
  riskScore: number;
  /** 0..1. How much the fit and its sample support deserve to be believed. */
  confidence: number;
  sampleCount: number;
  /** `1 + beta_h` when a dwell model was supplied, else null. */
  amplification: number | null;
  horizonSeconds: number;
}

/**
 * Fewest samples a trend may be fitted from.
 *
 * Two points always fit a line perfectly and say nothing about whether the
 * relationship is real - an r-squared of 1.0 over two noisy GPS-derived
 * headways is an artefact, not evidence. Four is the smallest window over
 * which the fit can disagree with the data enough for r-squared to be
 * informative, and at the default 60 s sweep cadence it is four minutes of
 * observation before this module will say anything about a pair.
 */
export const MIN_TREND_SAMPLES = 4;

/**
 * Shortest clock span a trend may be fitted over, seconds.
 *
 * Sample COUNT is not the same as observation TIME. Four samples that all
 * arrived inside forty seconds - a compute sweep that ran hot, a corridor
 * whose sweep was triggered manually, a test - describe forty seconds of
 * behaviour and extrapolating ten minutes from them is unfounded regardless
 * of how well the line fits.
 */
export const MIN_TREND_WINDOW_SECONDS = 150;

/**
 * Fit quality below which the trend is refused outright.
 *
 * Chosen against what the alternative costs. At r-squared 0.5 the line
 * explains half the variance, which for a monotonically closing gap is a weak
 * but real signal; below it the samples are closer to scatter than to a trend,
 * and a forecast drawn through scatter is a coin flip wearing a number.
 */
export const MIN_TREND_R_SQUARED = 0.5;

/**
 * Closing rates faster than this are treated as measurement failure, not
 * observation.
 *
 * The bound is physical rather than tuned. Forward headway is a time gap,
 * h ~= d / v_follower, so
 *
 *   dh/dt = (v_leader - v_follower) / v_follower
 *
 * which reaches exactly -1 when the leader is STATIONARY and the follower is
 * moving - a follower closing on a dwelling or broken-down leader loses one
 * second of gap per second of clock, and that is the fastest a real pair can
 * close. A sustained rate beyond -1 requires the leader to be travelling
 * backwards along the route, so it is never a bus: it is a map-match that has
 * jumped the follower past its leader, or the pair being re-ordered
 * underneath the fit. Forecasting from it produces an alarming and entirely
 * fictional time-to-bunch.
 *
 * Note this is a bound on the AVERAGE rate over the whole regression window.
 * Sustaining -1 for five minutes means the leader did not move for five
 * minutes, which is a breakdown to be escalated rather than a bunch to be
 * held out of - and one the reactive rule will report on its own moments
 * later, from measurement rather than extrapolation.
 */
export const MAX_PLAUSIBLE_CLOSING_RATE = 1.0;

/**
 * Least-squares slope of forward headway against time.
 *
 * Returns null rather than a slope whenever the sample set cannot support
 * one: too few points, too short a window, or every sample at the same
 * instant (a vertical fit, whose denominator is zero).
 */
export function computeClosingRate(
  samples: readonly HeadwaySampleObservation[],
  minSamples: number = MIN_TREND_SAMPLES,
  minWindowSeconds: number = MIN_TREND_WINDOW_SECONDS,
): ClosingRate | null {
  const points = samples
    .map((s) => ({ t: new Date(s.computedAt).getTime(), h: s.hFwdSeconds }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.h))
    .sort((a, b) => a.t - b.t);

  if (points.length < minSamples) return null;

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return null;

  const windowSeconds = (lastPoint.t - firstPoint.t) / 1000;
  if (windowSeconds < minWindowSeconds) return null;

  // Seconds since the first sample, so the regressor is small and centred
  // near zero rather than a 13-digit epoch - the normal equations lose
  // precision badly on the latter.
  const xs = points.map((p) => (p.t - firstPoint.t) / 1000);
  const ys = points.map((p) => p.h);
  const n = points.length;

  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - meanY);
  }

  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssTotal = 0;
  let ssResidual = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i]!;
    ssTotal += (ys[i]! - meanY) ** 2;
    ssResidual += (ys[i]! - predicted) ** 2;
  }

  // A perfectly flat gap has zero total variance. The line through it is
  // correct and its slope is zero, so the fit is perfect rather than
  // undefined - and a flat gap is precisely the "not closing" case this
  // module should report calmly rather than refuse.
  const rSquared = ssTotal === 0 ? 1 : Math.max(0, 1 - ssResidual / ssTotal);

  return { secondsPerSecond: slope, rSquared, sampleCount: n, windowSeconds };
}

export interface BunchingRiskInput {
  samples: readonly HeadwaySampleObservation[];
  /** Current forward headway, seconds - the point the forecast starts from. */
  currentHFwdSeconds: number;
  targetHeadwaySeconds: number;
  bunchedThresholdRatio: number;
  /** How far ahead to project, seconds. */
  horizonSeconds: number;
  /**
   * Fitted dwell model for the stop the follower is heading into, when one
   * exists. Its `1 + beta_h` is the corridor's own amplification factor, so
   * supplying it makes the forecast steeper on corridors MEASURED to come
   * apart faster. Omit it and the projection stays purely linear, which is
   * the conservative choice and the one taken on every corridor today.
   */
  dwellModel?: DwellModel | null;
}

/**
 * How fast this pair is heading for a bunch, and whether that is believable.
 *
 * Returns null - says nothing at all - when the trend cannot be trusted.
 * Callers must treat null as "no opinion", never as "no risk": the two are
 * indistinguishable in a boolean and opposite in meaning, and on a corridor
 * whose samples are too sparse to fit, no opinion is the honest report.
 */
export function computeBunchingRisk(input: BunchingRiskInput): BunchingRisk | null {
  const {
    samples,
    currentHFwdSeconds,
    targetHeadwaySeconds,
    bunchedThresholdRatio,
    horizonSeconds,
    dwellModel = null,
  } = input;

  if (!Number.isFinite(currentHFwdSeconds) || currentHFwdSeconds < 0) return null;
  if (!Number.isFinite(targetHeadwaySeconds) || targetHeadwaySeconds <= 0) return null;
  if (horizonSeconds <= 0) return null;

  const trend = computeClosingRate(samples);
  if (trend === null) return null;
  if (trend.rSquared < MIN_TREND_R_SQUARED) return null;
  if (Math.abs(trend.secondsPerSecond) > MAX_PLAUSIBLE_CLOSING_RATE) return null;

  // `1 + beta_h` steepens a closing gap on a corridor whose dwells are
  // measured to amplify headway deviations. It is applied ONLY to a closing
  // trend: amplification makes a deviation grow, and a gap that is opening is
  // already growing, so multiplying that direction too would forecast buses
  // flying apart - the wrong failure and not the one this system is for.
  const amplification = dwellModel ? headwayAmplification(dwellModel) : null;
  const effectiveRate =
    amplification !== null && trend.secondsPerSecond < 0
      ? trend.secondsPerSecond * amplification
      : trend.secondsPerSecond;

  const forecastHFwdSeconds = Math.max(0, currentHFwdSeconds + effectiveRate * horizonSeconds);
  const forecastRatio = forecastHFwdSeconds / targetHeadwaySeconds;

  const bunchedHeadwaySeconds = bunchedThresholdRatio * targetHeadwaySeconds;

  let secondsToBunching: number | null = null;
  if (effectiveRate < 0 && currentHFwdSeconds > bunchedHeadwaySeconds) {
    const seconds = (currentHFwdSeconds - bunchedHeadwaySeconds) / -effectiveRate;
    // Beyond the horizon the crossing is not a prediction anyone can act on -
    // the trend will have been re-fitted a dozen times before it arrives.
    if (seconds <= horizonSeconds) secondsToBunching = seconds;
  }

  // Nearness, not certainty: a crossing at the far edge of the horizon scores
  // near 0 and one about to happen scores near 1. Linear because there is no
  // empirical basis for a particular curve here, and inventing one would
  // dress an arbitrary shape as a calibrated hazard.
  const riskScore = secondsToBunching === null ? 0 : Math.max(0, Math.min(1, 1 - secondsToBunching / horizonSeconds));

  // Fit quality, tempered by how much observation stands behind it. Eight
  // samples over a quarter hour deserve more belief than four over three
  // minutes even at identical r-squared, and this is the only place that
  // distinction can be made.
  const sampleSupport = Math.min(1, trend.sampleCount / (MIN_TREND_SAMPLES * 2));
  const confidence = Math.max(0, Math.min(1, trend.rSquared * (0.6 + 0.4 * sampleSupport)));

  return {
    forecastHFwdSeconds,
    forecastRatio,
    closingRateSecondsPerSecond: effectiveRate,
    secondsToBunching,
    riskScore,
    confidence,
    sampleCount: trend.sampleCount,
    amplification,
    horizonSeconds,
  };
}

/**
 * How far ahead it is worth forecasting on a corridor with this headway.
 *
 * ─── WHY THIS IS NOT A CONSTANT ──────────────────────────────────────────
 *
 * The natural clock of a bunching process is the headway itself. A corridor
 * running buses ten minutes apart comes apart over minutes; one running them
 * thirty minutes apart comes apart over tens of minutes. A single fixed
 * horizon cannot serve both, and choosing one that suits city headways makes
 * the tier structurally silent on long ones rather than merely less useful:
 *
 *   H* = 1800 s, bunched at 0.25 -> 450 s. A pair still comfortably outside
 *   the warning threshold sits above 900 s. Closing 450 s of gap inside a
 *   600 s horizon demands an average rate of -0.75 s/s, which is most of the
 *   way to a stationary leader. So on a 30-minute corridor a 10-minute
 *   horizon can only ever fire for pairs whose leader has essentially
 *   stopped - and UPSRTC's median planned headway is 1800 s.
 *
 * Scaling with H* makes the horizon mean the same thing everywhere: roughly
 * one headway of look-ahead, the span over which the current gap structure
 * plays out.
 *
 * The floor and ceiling are both about usefulness rather than mathematics. A
 * horizon under five minutes forecasts a crossing that arrives before anyone
 * can route an instruction to a driver; one over forty-five minutes forecasts
 * a crossing that will be re-fitted dozens of times, against traffic and
 * demand conditions that will have changed, and is a guess dressed as a
 * prediction.
 */
export const HORIZON_HEADWAY_MULTIPLE = 1.0;
export const MIN_HORIZON_SECONDS = 300;
export const MAX_HORIZON_SECONDS = 2700;

export function forecastHorizonSeconds(
  targetHeadwaySeconds: number,
  multiple: number = HORIZON_HEADWAY_MULTIPLE,
  minSeconds: number = MIN_HORIZON_SECONDS,
  maxSeconds: number = MAX_HORIZON_SECONDS,
): number {
  if (!Number.isFinite(targetHeadwaySeconds) || targetHeadwaySeconds <= 0) return minSeconds;
  return Math.max(minSeconds, Math.min(maxSeconds, targetHeadwaySeconds * multiple));
}
