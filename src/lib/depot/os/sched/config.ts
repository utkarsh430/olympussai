import { DEFAULT_PRICE_PER_LITRE } from '../../fuel/types';
import type { BusParams, CrewParams } from './types';

/*
 * Planning constants of the OS scheduling engine, each a round planning figure. Costs are
 * estimates for comparing plans with each other, not a budget.
 */

/** Passengers who board along a route for each seat, over one departure (turnover). */
export const SEAT_TURNOVER = 1.5;
/** Minutes a bus spends leaving and entering the city before open road. */
export const CITY_MINUTES = 10;
export const LAYOVER_MIN = 15;
/** Average running speed by class, km/h. */
export const SPEED_KMH = { ordinary: 34, express: 44, ac: 48, premium: 50 } as const;
/** Road distance over straight-line distance between towns. */
export const ROAD_FACTOR = 1.25;
/** A bus moving between two city terminals: time and the fixed part of the distance. */
export const REPOSITION_MIN = 15;
export const REPOSITION_KM = 2;
/** A crew gap this long releases the crew (a split duty); shorter gaps are paid. */
export const CREW_RELEASE_GAP_MIN = 120;
/** Driver and conductor together, per paid hour (wages and allowances), rupees. */
export const CREW_COST_PER_HOUR = 540;
/** Depreciation, insurance and minimum upkeep of a bus that runs at all in a day, rupees. */
export const BUS_DAY_FIXED_COST = 2_400;
export const DIESEL_PRICE = DEFAULT_PRICE_PER_LITRE;
/** Share of AC-endorsed driver slots in a depot's roster. */
export const AC_ENDORSED_SHARE = 0.4;
/** Hours in the day a bus can be scheduled: 04:00 to midnight. */
export const DAY_FROM_MIN = 4 * 60;
export const DAY_TO_MIN = 24 * 60;

export const OBJECTIVE_LABEL = {
  coverage: 'Maximum service coverage',
  min_buses: 'Minimum bus requirement',
  min_empty_km: 'Minimum empty kilometres',
  min_cost: 'Minimum operating cost',
  balanced: 'Balanced efficiency',
} as const;

export const OBJECTIVE_NOTE = {
  coverage: 'Every bus that may run is used to carry the most passengers; a short fleet drops the lightest departures first.',
  min_buses: 'The fewest buses that cover the departures: buses are shared between routes whose busy hours differ.',
  min_empty_km: 'Keeps each bus on one terminal and one route where it can, so few kilometres are run empty.',
  min_cost: 'Weighs a bus’s fixed day cost, fuel and paid crew time, and takes the cheapest bus for each departure.',
  balanced: 'Fewer buses, little idle time and few empty kilometres, each weighed moderately.',
} as const;

export const PRIORITY_LABEL = {
  even: 'Even across routes',
  peak: 'Peak commuters first',
  intercity: 'Intercity services first',
} as const;

export const CREW_OBJECTIVE_LABEL = {
  coverage: 'Cover every shift',
  min_overtime: 'Minimum overtime',
  balanced: 'Balanced workload',
  min_crew: 'Fewest crew slots',
} as const;

export const DEFAULT_BUS_PARAMS: BusParams = {
  routes: [],
  demandPct: 0,
  targetLoad: 0.75,
  minPerHour: 1,
  turnaroundMin: 15,
  reservePct: 5,
  unavailable: [],
  holdOverdue: true,
  holdHighRisk: false,
  maxBlockHours: 16,
  objective: 'balanced',
  priority: 'even',
};

export const DEFAULT_CREW_PARAMS: CrewParams = {
  maxDutyHours: 8,
  minBreakMin: 60,
  overtimeHours: 1,
  extraUnavailable: { driver: 0, conductor: 0 },
  requireAcEndorsement: true,
  objective: 'coverage',
};

export const PARAM_BOUNDS = {
  demandPct: { min: -30, max: 50, step: 5 },
  targetLoad: { min: 0.6, max: 1, step: 0.05 },
  minPerHour: { min: 0, max: 4, step: 1 },
  turnaroundMin: { min: 5, max: 60, step: 5 },
  reservePct: { min: 0, max: 20, step: 1 },
  maxBlockHours: { min: 6, max: 18, step: 1 },
  maxDutyHours: { min: 6, max: 10, step: 0.5 },
  minBreakMin: { min: 30, max: 240, step: 15 },
  overtimeHours: { min: 0, max: 3, step: 0.5 },
} as const;
