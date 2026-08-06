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
