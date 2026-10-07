/*
 * When the hour-by-hour figures become a proposal. Every threshold is a
 * REFERENCE planning choice the owner may edit; none is a measurement.
 */

/** An "add" needs a gap of at least this many buses in each hour of its band... */
export const ADD_MIN_BUSES = 2;
/** ...and at least this share of the buses needed, so a large route is not nagged over one bus. */
export const ADD_MIN_SHARE = 0.2;

/** A "hold" needs a surplus of at least this many buses in each hour of its band. */
export const HOLD_MIN_SURPLUS = 1;
/** A hold always leaves at least this many buses on the route, whatever the demand. */
export const HOLD_KEEP_MIN = 1;

/** Consecutive hours a gap or surplus must last before it is proposed: one hour may be noise. */
export const MIN_BAND_HOURS = 2;

/**
 * A band is split where the gap steps from one hour to the next by more than this many
 * buses and this share of the larger of the two gaps, so one proposal never covers a quiet
 * stretch and a peak with a single figure.
 */
export const SPLIT_STEP_MIN_BUSES = 2;
export const SPLIT_STEP_SHARE = 0.5;

/**
 * A journey whose scheduled start is more than this many minutes behind the
 * feed clock, with no actual start, is counted as not run.
 */
export const NOT_RUN_AFTER_MIN = 30;

/**
 * An hour "has demand" for the service span when its modelled boardings are at
 * least this share of the day's: below it the hour is the fringe of the day.
 */
export const SPAN_DEMAND_SHARE = 0.02;

/** Journeys with a known start the ledger needs before the span or headways are judged. */
export const MIN_LEDGER_JOURNEYS = 3;

/** Minutes between consecutive scheduled starts that count as a gap in the service. */
export const HEADWAY_GAP_MIN = 60;

/** The daytime hours a headway gap is looked for in, inclusive. */
export const HEADWAY_DAYTIME = { from: 6, to: 21 } as const;

/** Consecutive hours of median delay beyond the late threshold before running time is questioned. */
export const RUNNING_TIME_MIN_HOURS = 3;
/** Journeys carrying a delay an hour needs before its median counts toward that. */
export const RUNNING_TIME_MIN_COVERAGE = 3;
