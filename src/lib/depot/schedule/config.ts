import { MAX_DUTY_HOURS_PER_DAY } from '../crew/types';
import { ROUTE_BUS_DAY_MAX_MIN, TARGET_LOAD } from '../sim/hourlyDemandConfig';
import { MINUTES_PER_HOUR } from '../units';

/*
 * Planning constants of the AI Scheduler. Each is a reference figure with
 * its reasoning; a timetable or roster feed does not change them.
 */

/** The need is a 24-hour day that starts clean; a block never runs past midnight. */
export const DAY_END_MIN = 24 * MINUTES_PER_HOUR;
/** Pieces of work start and end on a five-minute grid: finer would claim a precision the need lacks. */
export const PIECE_GRID_MIN = 5;
/** A change of route is a return to the yard and a fresh pull-out; half an hour covers it. */
export const DEFAULT_TURNAROUND_MIN = 30;
export const MAX_TURNAROUND_MIN = 180;
/** A block shorter than four hours is not a day's work for a bus. */
export const MIN_BLOCK_CAP_MIN = 240;
/** The longest a bus works in a day (the route-day rule, S76). */
export const DEFAULT_MAX_BLOCK_MIN = ROUTE_BUS_DAY_MAX_MIN;
/** Two idle hours between pieces is a split duty: the crew are released, not paid to wait. */
export const CREW_RELEASE_GAP_MIN = 120;
/** The most a crew slot works in a day, in minutes. */
export const DAILY_LIMIT_MIN = MAX_DUTY_HOURS_PER_DAY * MINUTES_PER_HOUR;
/** The target load the need formula plans for, and the range a what-if may set it to. */
export const DEFAULT_TARGET_LOAD = TARGET_LOAD;
export const TARGET_LOAD_BOUNDS = { min: 0.5, max: 1 } as const;
/** A demand change a what-if may apply, in percent (the fleet-distribution sandbox's range). */
export const SURGE_BOUNDS = { min: -50, max: 100 } as const;
/** A what-if may take at most this many buses out of service. */
export const MAX_OUT_OF_SERVICE = 500;
/** Minutes of paid idle are weighed first when two blocks could take a piece. */
export const FULL_SCALE = 10_000;
