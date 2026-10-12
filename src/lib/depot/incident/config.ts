import { REPORTING_WINDOW_MIN } from '../infer/thresholds';
import { MAX_INTRA_DAY_KM } from '../optimise/hourlyReallocate';
import type { ReplacementKind } from './types';

/*
 * Incident Response constants, each with its reasoning. They are reference
 * figures; a routing service or a ticketing feed replaces the ones a port serves.
 */

/** The feed's own status word for a bus under tow, compared case-insensitively. */
export const TOWING_STATUS_WORD = 'towing';
/** A dwell at a stop is a few minutes and a terminal layover fifteen; ten minutes away from any stop is unusual. */
export const STOPPED_MIN = 10;
/** GPS jitter plus a long bus bay: a bus a bus-length past a stop is still at it. */
export const STOP_RADIUS_M = 150;
/** Terminal compounds are larger than a kerbside stop. */
export const TERMINAL_RADIUS_M = 400;
/** Position drift of a stationary device. */
export const STOP_JITTER_M = 50;
/** A bus this close to its own yard is pulling in or out. */
export const NEAR_YARD_KM = 1;
/** The module's own recency rule. */
export const NOT_HEARD_ON_ROUTE_MIN = REPORTING_WINDOW_MIN;
/** Half the fleet; above it the holder stops admitting buses and never grows. */
export const STOPPED_SINCE_MAX_BUSES = 5_000;

/** Minutes before a replacement is on its way: the shed turnaround, a call to another depot, a handover message. */
export const DISPATCH_LEAD_MIN: Readonly<Record<ReplacementKind, number>> = {
  own_yard_spare: 10,
  other_depot_spare: 15,
  following_bus: 0,
  block_ending_bus: 5,
  next_scheduled: 0,
};
/** A mixed urban and inter-city average; a routing service replaces it through the road-time port. */
export const REFERENCE_SPEED_KMPH = 30;
/** Re-boarding a busload across the road. */
export const TRANSFER_MIN = 5;
/** Minutes are shown on a five-minute grid; finer would claim a precision the speed assumption lacks. */
export const ARRIVAL_GRID_MIN = 5;
/** The module's existing bound on an intra-day move. */
export const MAX_SPARE_RANGE_KM = MAX_INTRA_DAY_KM;
/** A block ending within half an hour, within a short run, can take the rest of the broken bus's day. */
export const BLOCK_END_WINDOW_MIN = 30;
export const BLOCK_END_RADIUS_KM = 15;
/** Beyond this a "following" bus is a different trip. */
export const FOLLOWING_MAX_BEHIND_KM = 30;
/** Below five minutes a headway is noise; above two hours the next bus is not a plan. */
export const MIN_HEADWAY_MIN = 5;
export const MAX_HEADWAY_MIN = 120;
/** A lending depot keeps two spares, as each crew role keeps two reserve slots. */
export const OTHER_DEPOT_RESERVE_SPARES = 2;
/** The hour the lender's own next breakdown would wait. */
export const RESERVE_LOSS_MIN = 60;
export const MAX_CANDIDATES_PER_KIND = 5;
/** Own yard first: fewest parties involved. */
export const KIND_ORDER: readonly ReplacementKind[] = ['own_yard_spare', 'following_bus', 'block_ending_bus', 'other_depot_spare', 'next_scheduled'];
