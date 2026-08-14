/**
 * The depot console's readouts, as pure functions.
 *
 * Same reasoning as recommendationView.ts: almost every number a console puts
 * on screen is a claim, and the ones that can be wrong in a way the operator
 * cannot detect are decided here, once, rather than inline in JSX where they
 * would never fail a render test.
 */
import type { HeadwayCountdown } from '@/lib/controlService/headwayCountdown';
import type { DepotCorridor } from './depotCorridors';

/**
 * How many of this depot's vehicles the control service is placing on a mapped
 * corridor at all.
 *
 * Shown BESIDE the depot's total reporting fleet, never instead of it. The two
 * numbers are routinely far apart — only part of the state's route network has
 * been surveyed into the control database — and a console that showed only the
 * on-corridor figure would quietly redefine "this depot's fleet" as the subset
 * the control service happens to understand.
 */
export function depotVehiclesOnCorridors(corridors: readonly DepotCorridor[]): number {
  return corridors.reduce((total, corridor) => total + corridor.depotVehicleCount, 0);
}

/**
 * The pair closest to breaching its target headway — the one number an
 * operator glances at to know whether this corridor needs them.
 *
 * A pair with no current forward-headway sample has no countdown and is
 * skipped rather than treated as zero cushion: `computeHeadwayCountdowns`
 * deliberately returns null there, and turning that null into the most urgent
 * possible reading would invert its meaning.
 *
 * Ties break on `pairId` so a strip does not flicker between two equally tight
 * pairs on successive renders.
 */
export function tightestCountdown(countdowns: readonly HeadwayCountdown[]): HeadwayCountdown | null {
  let tightest: HeadwayCountdown | null = null;
  for (const countdown of countdowns) {
    if (countdown.countdownSeconds === null) continue;
    if (
      tightest === null ||
      countdown.countdownSeconds < tightest.countdownSeconds! ||
      (countdown.countdownSeconds === tightest.countdownSeconds && countdown.pairId < tightest.pairId)
    ) {
      tightest = countdown;
    }
  }
  return tightest;
}

/** `-1:30`, `4:05`. Signed, zero-padded, and never rounded to something reassuring. */
export function formatCountdown(seconds: number | null): string {
  if (seconds === null) return '—';
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.round(Math.abs(seconds));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * The tone a countdown is drawn in: red once the target is already breached,
 * amber inside the last quarter of the target, otherwise green. Null — no
 * sample — is never given a colour, because a colour would be a verdict on a
 * reading that does not exist.
 */
export function countdownTone(
  countdownSeconds: number | null,
  targetHeadwaySeconds: number,
): 'default' | 'good' | 'warn' | 'critical' {
  if (countdownSeconds === null) return 'default';
  if (countdownSeconds < 0) return 'critical';
  if (countdownSeconds < targetHeadwaySeconds * 0.25) return 'warn';
  return 'good';
}
