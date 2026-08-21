// Reactive bunching detection tier (blueprint 7.3): flags an incident when
// a leader/follower pair's forward headway has stayed at or below a
// configured fraction of the target headway for a configured number of
// consecutive samples - both are config-not-code, read from the
// route-direction's active route_policies row (bunched_threshold_ratio /
// warning_threshold_ratio / required_samples), never hard-coded here.

import type { BunchingRuleResult, BunchingSeverity } from "./types.js";

/**
 * @param ratiosMostRecentFirst hFwdSeconds/targetHeadwaySeconds for this
 *   pair's most recent samples, newest first (index 0 is the sample that
 *   was just computed and persisted).
 * @param requiredSamples number of consecutive samples that must all satisfy
 *   a threshold before it counts (route_policies.required_samples) - avoids
 *   flagging on one noisy GPS fix.
 * @param bunchedThresholdRatio e.g. 0.25: headway <= 25% of target for
 *   `requiredSamples` consecutive samples is a "bunched" incident.
 * @param warningThresholdRatio e.g. 0.5: headway <= 50% of target for
 *   `requiredSamples` consecutive samples (but not bunched) is a "warning".
 * @param hasOpenIncident whether this pair already has an open incident -
 *   only relevant for `recovered`, which is otherwise always false.
 */
export function evaluateBunchingRule(
  ratiosMostRecentFirst: readonly number[],
  requiredSamples: number,
  bunchedThresholdRatio: number,
  warningThresholdRatio: number,
  hasOpenIncident: boolean
): BunchingRuleResult {
  const latestRatio = ratiosMostRecentFirst[0] ?? null;

  if (requiredSamples <= 0 || ratiosMostRecentFirst.length < requiredSamples) {
    return { severity: null, recovered: false, ratio: latestRatio };
  }

  const window = ratiosMostRecentFirst.slice(0, requiredSamples);
  const allBunched = window.every((r) => r <= bunchedThresholdRatio);
  const allWarning = window.every((r) => r <= warningThresholdRatio);
  const allRecovered = window.every((r) => r > warningThresholdRatio);

  const severity: BunchingSeverity | null = allBunched ? "bunched" : allWarning ? "warning" : null;

  return {
    severity,
    recovered: hasOpenIncident && allRecovered,
    ratio: latestRatio,
  };
}

// ─── PREDICTIVE TIER ─────────────────────────────────────────────────────
//
// The rule above is an observation: k consecutive samples already under a
// threshold. What follows is a prediction, and the two are held apart on
// purpose - they have different evidence, different failure modes and
// different costs when wrong.
//
// A false REACTIVE positive tells an operator a bunch exists that does not;
// they look, see two buses properly spaced, and lose a little trust. A false
// PREDICTIVE positive tells them a bunch is coming that never arrives, and
// they cannot check it - the prediction is about a future that will not
// happen, so it cannot be falsified in the moment and can only erode into
// background noise. That asymmetry is why the thresholds here are strict and
// why every one of them is a named constant rather than a literal.

import type { BunchingRisk } from "./riskForecast.js";

export interface PredictiveRuleResult {
  /** True when this pair should carry an open `predicted` incident. */
  predicted: boolean;
  /**
   * True when an open `predicted` incident should be closed because the pair
   * is no longer heading for a bunch. Distinct from the reactive rule's
   * `recovered`, which asks whether a COLLAPSED gap has reopened; a predicted
   * incident's gap never collapsed, so that question does not apply to it.
   */
  riskCleared: boolean;
  reason: string;
}

/**
 * Confidence below which a forecast is not worth raising to a human.
 *
 * Set against the cost of being wrong rather than a statistical convention.
 * At 0.6 the underlying trend explains most of the variance and has real
 * sample support behind it (see `computeBunchingRisk`, which folds both into
 * this number). Below that the honest report is silence.
 */
export const MIN_PREDICTION_CONFIDENCE = 0.6;

/**
 * Risk below which a forecast crossing is too distant to act on.
 *
 * riskScore is nearness within the horizon, so 0.35 at a 600 s horizon means
 * "predicted to bunch within about 390 seconds". Sooner than that and there
 * is time to place a small hold at the next stop; later and the trend will
 * have been re-fitted several times before the crossing, so raising it now
 * buys nothing and spends attention.
 */
export const MIN_PREDICTION_RISK = 0.35;

/**
 * Hysteresis: an open predicted incident survives until risk falls THIS far,
 * below the level that opened it.
 *
 * Without a gap between the two, a pair sitting near the threshold opens and
 * closes an incident on alternate sweeps - once a minute, indefinitely - and
 * the alert list becomes a flicker nobody can read. The band is wide because
 * the cost of holding a predicted incident open slightly too long is one
 * stale row an operator dismisses, while the cost of flapping is the whole
 * surface losing credibility.
 */
export const PREDICTION_CLEAR_RISK = 0.15;

/**
 * Whether a pair's forecast justifies opening, keeping, or closing a
 * `predicted` incident.
 *
 * A null risk means the forecaster declined to have an opinion - too few
 * samples, too short a window, too poor a fit, or an implausible closing
 * rate. That is NOT the same as low risk, and this function must not treat it
 * as such: it neither opens nor closes on null, leaving any existing incident
 * exactly as it was. A corridor whose GPS went quiet must not silently drop
 * its open predictions, because nothing has been observed to have improved.
 */
export function evaluatePredictiveRule(
  risk: BunchingRisk | null,
  hasOpenPredictedIncident: boolean,
  minConfidence: number = MIN_PREDICTION_CONFIDENCE,
  minRisk: number = MIN_PREDICTION_RISK,
  clearRisk: number = PREDICTION_CLEAR_RISK,
): PredictiveRuleResult {
  if (risk === null) {
    return {
      predicted: false,
      riskCleared: false,
      reason: "no trend could be fitted, so no opinion either way",
    };
  }

  if (risk.confidence < minConfidence) {
    // Deliberately does not clear an open incident. The forecast that opened
    // it was made on evidence that met the bar; a later sweep whose samples
    // are noisier has not refuted it, it has merely stopped speaking.
    return {
      predicted: false,
      riskCleared: false,
      reason: `forecast confidence ${risk.confidence.toFixed(2)} is below ${minConfidence}`,
    };
  }

  if (hasOpenPredictedIncident) {
    if (risk.riskScore <= clearRisk) {
      return {
        predicted: false,
        riskCleared: true,
        reason: `risk fell to ${risk.riskScore.toFixed(2)}, at or below the ${clearRisk} clearing level`,
      };
    }
    return {
      predicted: true,
      riskCleared: false,
      reason:
        risk.secondsToBunching === null
          ? "no crossing forecast within the horizon, but risk has not cleared"
          : `still closing, ${Math.round(risk.secondsToBunching)}s to the bunched threshold`,
    };
  }

  if (risk.riskScore >= minRisk && risk.secondsToBunching !== null) {
    return {
      predicted: true,
      riskCleared: false,
      reason: `closing at ${(-risk.closingRateSecondsPerSecond).toFixed(3)}s of gap per second; forecast to breach in ${Math.round(risk.secondsToBunching)}s`,
    };
  }

  return {
    predicted: false,
    riskCleared: false,
    reason:
      risk.secondsToBunching === null
        ? "not closing fast enough to reach the bunched threshold within the horizon"
        : `risk ${risk.riskScore.toFixed(2)} is below the ${minRisk} opening level`,
  };
}
