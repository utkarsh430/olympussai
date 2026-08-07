/**
 * Pure headway-countdown math over a headway/compute response's pair
 * metrics — no I/O, so it's usable from both the dispatcher/depot route
 * board (server component) and its unit tests. "Countdown" here means: how
 * many seconds of cushion remain before this follower breaches its target
 * headway behind its leader, given the current forward headway
 * (hFwdSeconds). A pair with no current forward-headway sample yet (null)
 * has no countdown to show — never fabricated as zero.
 */
import type { HeadwayPairMetric } from '@/models/control';

export interface HeadwayCountdown {
  pairId: string;
  routeDirectionId: string;
  leaderVehicleId: string;
  followerVehicleId: string;
  targetHeadwaySeconds: number;
  currentHeadwaySeconds: number | null;
  /** Seconds of cushion remaining before the target is breached; negative (and `overdue: true`) once it already has been. Null when there is no current sample. */
  countdownSeconds: number | null;
  overdue: boolean;
}

export function computeHeadwayCountdowns(pairs: HeadwayPairMetric[]): HeadwayCountdown[] {
  return pairs.map((pair) => {
    const countdownSeconds = pair.hFwdSeconds === null ? null : pair.targetHeadwaySeconds - pair.hFwdSeconds;
    return {
      pairId: pair.id,
      routeDirectionId: pair.routeDirectionId,
      leaderVehicleId: pair.leaderVehicleId,
      followerVehicleId: pair.followerVehicleId,
      targetHeadwaySeconds: pair.targetHeadwaySeconds,
      currentHeadwaySeconds: pair.hFwdSeconds,
      countdownSeconds,
      overdue: countdownSeconds !== null && countdownSeconds < 0,
    };
  });
}
