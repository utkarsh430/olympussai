import { median } from '../stats/robust';
import { FUEL_VARIANCE_FLAG_PCT, MIN_PEERS } from './types';

const PERCENT = 100;

/**
 * Whether the median of a bus's peers is a figure that real peers stand behind.
 * The median of two peers that disagree is just their mean, a number no bus
 * has, so a bus compared against it is not flagged. The median is supported
 * when at least MIN_PEERS peers lie within the flag threshold of it, as a
 * percentage of the median. Peers are kilometres per litre.
 */
export function isSupportedMedian(
  peers: readonly number[],
  thresholdPct: number = FUEL_VARIANCE_FLAG_PCT,
): boolean {
  const centre = median(peers);
  if (centre === null || !(centre > 0)) return false;
  const near = peers.filter((p) => (Math.abs(p - centre) / centre) * PERCENT <= thresholdPct);
  return near.length >= MIN_PEERS;
}
