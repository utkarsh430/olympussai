import type { DeiComponentKey } from '../score/types';
import type { DepotExceptionKind, ExceptionBasis, ExceptionKind, ExceptionSeverity } from './types';

/**
 * Thresholds for raising exceptions. A depot is flagged only when it is both
 * statistically unusual against its peers (z) and materially different in
 * plain terms (rate gap), so a tight peer group cannot turn a one-point gap
 * into an alarm.
 */

/** Robust z at or beyond this, in the bad direction, raises a depot exception. */
export const EXCEPTION_Z = 2;

/** Robust z at or beyond this is critical. Scores clamp z to 3, so this is the ceiling. */
export const CRITICAL_Z = 3;

/** The depot's rate must differ from the peer median by at least this much. */
export const MIN_RATE_GAP = 0.1;

/** A power-cut cluster needs at least this many buses ... */
export const POWER_CUT_CLUSTER_MIN = 3;

/** ... and at least this share of the depot's fleet. */
export const POWER_CUT_CLUSTER_SHARE = 0.1;

/** The network bus list is capped; counts and `busTotal` are taken before the cap. */
export const BUS_EXCEPTION_CAP = 500;

/** The tamper code the feed sends for a normal device. Other codes are not interpreted. */
export const NORMAL_TAMPER_CODE = 'C';

/** Which score component each rate-based depot exception reads. */
export const COMPONENT_EXCEPTIONS: readonly {
  readonly key: DeiComponentKey;
  readonly kind: Exclude<DepotExceptionKind, 'power_cut_cluster'>;
}[] = [
  { key: 'dark', kind: 'dark_share_high' },
  { key: 'offRoad', kind: 'off_road_high' },
  { key: 'onRoad', kind: 'on_road_low' },
];

export const SEVERITY_ORDER: Readonly<Record<ExceptionSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Every kind, so a count of zero is reported rather than missing. */
export const EXCEPTION_KINDS: readonly ExceptionKind[] = [
  'dark_share_high',
  'off_road_high',
  'on_road_low',
  'power_cut_cluster',
  'long_dark',
  'power_cut',
  'tamper_code',
  'emergency',
];

/**
 * Which kinds are compared over the rolling score window and which are as of
 * the feed time (M6). Severity counts add both; a screen states which is which.
 * Frozen: the one table is placed in every memoised response body.
 */
export const EXCEPTION_BASIS: Readonly<Record<ExceptionKind, ExceptionBasis>> = Object.freeze({
  dark_share_high: 'window',
  off_road_high: 'window',
  on_road_low: 'window',
  power_cut_cluster: 'feed_time',
  long_dark: 'feed_time',
  power_cut: 'feed_time',
  tamper_code: 'feed_time',
  emergency: 'feed_time',
});
