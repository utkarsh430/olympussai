import type { CrewRole } from '../../crew/types';
import type { ServiceClass } from '../../sim/types';
import type { BusOpState } from '../../types';

/*
 * Shapes of the OS's frontend scheduling engine: a depot's timetable (routes and the
 * hourly passenger forecast), the departures it needs, bus blocks, crew shifts, and the
 * figures every plan is judged by. Pure data; the engine never reads a clock.
 */

export type Objective = 'coverage' | 'min_buses' | 'min_empty_km' | 'min_cost' | 'balanced';
export type ServicePriority = 'even' | 'peak' | 'intercity';
export type CrewObjective = 'coverage' | 'min_overtime' | 'balanced' | 'min_crew';

export interface SchedRoute {
  /** `AGF-MTH-03`: depot code, destination code, number. */
  readonly id: string;
  readonly destination: string;
  readonly serviceClass: ServiceClass;
  readonly seats: number;
  readonly oneWayKm: number;
  readonly journeyMin: number;
  /** Out, layover, back, layover. */
  readonly cycleMin: number;
  /** Which of the depot's city terminals the route starts from. */
  readonly terminal: number;
  /** Forecast boardings at the depot terminal, 24 entries, 00:00 first. */
  readonly demand: readonly number[];
  /** First and last hour with departures. */
  readonly fromHour: number;
  readonly toHour: number;
}

export interface Timetable {
  readonly depotId: string;
  readonly depotCode: string;
  readonly operatingDate: string;
  readonly routes: readonly SchedRoute[];
  /** Yard to each city terminal, km. */
  readonly terminalKm: readonly number[];
  readonly terminalNames: readonly string[];
}

export type BusRestriction = 'off_road' | 'service_overdue' | 'high_risk' | 'marked_unavailable' | 'reserve';

export interface SchedBus {
  readonly registration: string;
  readonly serviceClass: ServiceClass;
  readonly state: BusOpState;
  readonly risk: number;
  readonly serviceDueInDays: number;
  /** Why the bus may not be scheduled, or null when it may. */
  readonly restriction: BusRestriction | null;
}

export interface Trip {
  /** `<route>@<HHMM>`. */
  readonly id: string;
  readonly routeId: string;
  readonly serviceClass: ServiceClass;
  /** Departure from the terminal and return to it, minutes after midnight. */
  readonly dep: number;
  readonly arr: number;
  readonly terminal: number;
  readonly passengers: number;
  /** Ranking weight under the operational priority. */
  readonly weight: number;
  readonly km: number;
}

export interface BusBlock {
  readonly registration: string;
  readonly serviceClass: ServiceClass;
  readonly trips: readonly Trip[];
  readonly start: number;
  readonly end: number;
  readonly serviceMin: number;
  readonly idleMin: number;
  readonly deadKm: number;
  readonly serviceKm: number;
  readonly passengers: number;
  /** The bus cannot run today (the original plan predates its status). */
  readonly unavailable: BusRestriction | null;
}

export type UncoveredReason = 'fleet_short' | 'no_class_bus' | 'bus_unavailable' | 'displaced' | 'no_crew';

export interface UncoveredTrip {
  readonly trip: Trip;
  readonly reason: UncoveredReason;
}

export interface Conflict {
  readonly kind: 'unavailable_bus' | 'turnaround' | 'class' | 'rest' | 'hours' | 'qualification' | 'no_crew';
  readonly subject: string;
  readonly text: string;
}

export interface CostBreakdown {
  readonly fuel: number;
  readonly crew: number;
  readonly fixed: number;
  readonly total: number;
}

export interface PlanMetrics {
  readonly departures: number;
  readonly covered: number;
  readonly uncovered: number;
  readonly passengersTotal: number;
  readonly passengersCovered: number;
  readonly busesUsed: number;
  readonly eligibleBuses: number;
  readonly busHours: number;
  readonly serviceHours: number;
  readonly idleHours: number;
  readonly emptyKm: number;
  readonly serviceKm: number;
  /** Service hours over bus hours. */
  readonly utilisation: number;
  readonly cost: CostBreakdown;
  readonly conflicts: number;
}

export interface BusPlan {
  readonly kind: 'baseline' | 'optimised';
  readonly objective: Objective | null;
  readonly trips: readonly Trip[];
  readonly blocks: readonly BusBlock[];
  readonly uncovered: readonly UncoveredTrip[];
  readonly reserve: readonly string[];
  readonly conflicts: readonly Conflict[];
  /** Most departures out at once: no plan can use fewer buses. */
  readonly lowerBound: number;
  readonly metrics: PlanMetrics;
}

export interface BusParams {
  /** Route ids to plan; empty plans every route. */
  readonly routes: readonly string[];
  /** Change to the passenger forecast, percent. */
  readonly demandPct: number;
  readonly targetLoad: number;
  /** Fewest departures per route in each service hour. */
  readonly minPerHour: number;
  readonly turnaroundMin: number;
  /** Share of the schedulable fleet held back as reserve, percent. */
  readonly reservePct: number;
  readonly unavailable: readonly string[];
  readonly holdOverdue: boolean;
  readonly holdHighRisk: boolean;
  readonly maxBlockHours: number;
  readonly objective: Objective;
  readonly priority: ServicePriority;
}

export interface CrewSlotView {
  readonly id: string;
  readonly role: CrewRole;
  readonly available: boolean;
  /** Why not available: leave, weekly off, training, absent or marked unavailable. */
  readonly absence: string | null;
  /** Endorsed for air-conditioned coaches (drivers only). */
  readonly acEndorsed: boolean;
}

export interface CrewShift {
  readonly id: string;
  readonly registration: string;
  readonly start: number;
  readonly end: number;
  readonly trips: readonly string[];
  /** Any trip on an AC or premium coach: the driver needs the endorsement. */
  readonly needsAc: boolean;
}

export interface CrewAssignment {
  readonly shift: CrewShift;
  readonly driver: string | null;
  readonly conductor: string | null;
  readonly overtimeMin: number;
  readonly issues: readonly Conflict[];
}

export interface CrewParams {
  readonly maxDutyHours: number;
  /** Shortest break between two shifts of one slot, minutes. */
  readonly minBreakMin: number;
  readonly overtimeHours: number;
  readonly extraUnavailable: Readonly<Record<CrewRole, number>>;
  readonly requireAcEndorsement: boolean;
  readonly objective: CrewObjective;
}

export interface CrewMetrics {
  readonly shifts: number;
  readonly covered: number;
  readonly uncovered: number;
  readonly overtimeHours: number;
  readonly restViolations: number;
  readonly qualificationViolations: number;
  readonly hoursViolations: number;
  readonly used: Readonly<Record<CrewRole, number>>;
  readonly available: Readonly<Record<CrewRole, number>>;
  readonly reserve: Readonly<Record<CrewRole, number>>;
  /** Assigned hours over (slots used × the daily limit). */
  readonly utilisation: number;
  /** Spread between the busiest and the lightest used slot, hours. */
  readonly workloadSpread: number;
  readonly crewHours: number;
}

export interface CrewRoster {
  readonly kind: 'baseline' | 'optimised';
  readonly assignments: readonly CrewAssignment[];
  readonly slots: readonly CrewSlotView[];
  /** Hours each slot works. */
  readonly hoursBySlot: Readonly<Record<string, number>>;
  readonly metrics: CrewMetrics;
}
