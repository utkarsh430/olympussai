/**
 * Thresholds for inferring bus state from the live feed.
 *
 * Each value is set from a measurement of the sample feed (GPS age relative to
 * the newest `receivedTime` in the payload), not chosen by feel:
 *
 *   vehicle_status     median age   90th percentile        moving (> 3 km/h)
 *   live               0.8 min      33 min                 81%
 *   stationary         5.9 min      110 min (max 4 h)      0%
 *   no_signal          12.5 h       4.5 days (min 7.5 h)   -
 *   under_maintenance  4.8 days     8.8 days               -
 */

/** Above GPS jitter. No bus the feed calls `stationary` exceeds it. */
export const MOVING_SPEED_KMPH = 3;

/**
 * A fix older than this means the bus has gone dark. `stationary` buses top
 * out at about 4 hours and `no_signal` buses start at about 7.5, so 6 hours
 * sits in the gap between the two.
 */
export const DARK_AFTER_MIN = 360;

/** Dark for three days or more: raised as an exception. */
export const LONG_DARK_AFTER_MIN = 4320;

/** A fix this recent, either side of feedNow, counts as reporting. */
export const REPORTING_WINDOW_MIN = 30;
