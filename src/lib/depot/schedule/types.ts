import type { DepotBusView } from '../api';
import type { CrewRole, CrewSlot, RoleShortfall } from '../crew/types';
import type { BusStandingNow, Ineligibility, PlanMode, PlanNow, SpareByStanding } from '../duties/types';
import type { DutyPlan } from '../sim/dayPlan';
import type { ModelledBus, ServiceClass } from '../sim/types';
import type { NeedInputs } from '../service/types';
import type { DepotSummary, Figure, Provenance } from '../types';
import type { BusHold, DeadRunning, RouteNeedDay, RouteTiming } from './ports';

/*
 * The AI Scheduler's types. The engine is pure: a plan is a function of
 * these inputs and the clamped parameters. Provenance fields travel with
 * every figure for the day a real feed replaces a port; they are not shown.
 */

export interface RouteHourNeed {
  readonly hour: number;
  /** The route's need across every depot that runs it. */
  readonly routeNeeded: number;
  /** This depot's apportioned whole buses. */
  readonly needed: number;
}

export interface DepotRouteNeed {
  readonly routeName: string;
  readonly serviceClass: ServiceClass;
  readonly need: NeedInputs;
  readonly cycleMinutes: number;
  /** 24 entries. */
  readonly hours: readonly RouteHourNeed[];
  readonly needProvenance: Provenance;
  readonly timingProvenance: Provenance;
}

export interface PieceOfWork {
  readonly id: string;
  readonly routeName: string;
  readonly level: number;
  readonly startMin: number;
  readonly endMin: number;
  /** Minutes inside hours where the need is at least this level. */
  readonly needMinutes: number;
}

export interface VehicleBlock {
  readonly id: string;
  readonly depotId: string;
  readonly pieces: readonly PieceOfWork[];
  readonly startMin: number;
  readonly endMin: number;
  readonly routeNames: readonly string[];
  readonly mainRouteName: string;
  readonly serviceClass: ServiceClass;
  readonly workMinutes: number;
  readonly paidIdleMinutes: number;
  readonly routeChanges: number;
  readonly needMinutes: number;
}

export type BlockHoldReason = Ineligibility | 'job_card_open' | 'service_overdue' | 'out_of_service';

export interface BlockAssignment {
  readonly blockId: string;
  readonly registrationNumber: string | null;
  readonly reason: 'assigned' | 'locked' | 'no_eligible_bus';
  readonly busStanding: BusStandingNow | null;
}

export interface ScheduleAssignment {
  readonly assignments: readonly BlockAssignment[];
  readonly spareBuses: readonly string[];
  readonly spareByStanding: SpareByStanding;
  readonly excluded: readonly { readonly registrationNumber: string; readonly reason: BlockHoldReason }[];
  readonly blocksWithoutBus: number;
  readonly locksApplied: number;
}

export type UncoveredNeedReason = 'fleet_short' | 'buses_held_out' | 'past_day_end';

export interface UncoveredNeed {
  readonly routeName: string;
  readonly hour: number;
  readonly buses: number;
  readonly reason: UncoveredNeedReason;
}

export interface ScheduleShift {
  readonly id: string;
  readonly blockId: string;
  readonly shiftIndex: number;
  readonly shiftCount: number;
  readonly startMin: number;
  readonly endMin: number;
  /** True when the relief happens where a piece ends (at the depot), not mid-piece. */
  readonly reliefAtPieceEnd: boolean;
}

export interface ScheduleCrewAssignment extends ScheduleShift {
  /** The slot-day this shift sits in: one slot of each role works a chain. */
  readonly chainId: string;
  readonly driverSlot: string | null;
  readonly conductorSlot: string | null;
  readonly shortfalls: readonly RoleShortfall[];
}

export interface ScheduleCrew {
  readonly shifts: readonly ScheduleCrewAssignment[];
  readonly chains: number;
  readonly chainLowerBound: number;
  readonly slotsUsed: Readonly<Record<CrewRole, number>>;
  readonly hoursByRole: Readonly<Record<CrewRole, number>>;
  readonly available: Readonly<Record<CrewRole, number>>;
  readonly uncoveredByRole: Readonly<Record<CrewRole, number>>;
  readonly blocksNeedingRelief: number;
}

export interface ResourceFigures {
  readonly buses: number;
  readonly busesWithoutBus: number;
  readonly crewSlots: Readonly<Record<CrewRole, number>>;
  readonly crewHours: Readonly<Record<CrewRole, number>>;
  readonly uncoveredBusHours: number;
  readonly deadKm: Figure<number | null>;
}

export interface ScheduleBaseline {
  readonly source: 'duty_plan';
  readonly mode: PlanMode;
  readonly duties: number;
  readonly figures: ResourceFigures;
}

export interface ScheduleComparison {
  readonly busesFreed: number;
  readonly crewSlotsFreed: Readonly<Record<CrewRole, number>>;
  readonly crewHoursFreed: Readonly<Record<CrewRole, number>>;
  /** Schedule minus baseline: negative is better. */
  readonly uncoveredBusHoursChange: number;
  readonly deadKmChange: number | null;
}

export interface RouteSurge {
  readonly routeName: string;
  readonly percent: number;
}

export interface BusLock {
  readonly registrationNumber: string;
  readonly routeName: string;
}

export interface ScheduleParams {
  readonly demandSurgePercent?: number;
  readonly routeSurges?: readonly RouteSurge[];
  readonly targetLoad?: number;
  readonly busesOutOfService?: readonly string[];
  readonly crewUnavailable?: Partial<Readonly<Record<CrewRole, number>>>;
  readonly maxBlockMinutes?: number;
  readonly minTurnaroundMinutes?: number;
  readonly locks?: readonly BusLock[];
  readonly holdForMaintenance?: boolean;
}

export interface ResolvedScheduleParams {
  readonly demandSurgePercent: number;
  readonly routeSurges: readonly RouteSurge[];
  readonly targetLoad: number;
  readonly busesOutOfService: readonly string[];
  readonly crewUnavailable: Readonly<Record<CrewRole, number>>;
  readonly maxBlockMinutes: number;
  readonly minTurnaroundMinutes: number;
  readonly locks: readonly BusLock[];
  readonly holdForMaintenance: boolean;
}

export interface ScheduleRouteInput {
  readonly need: RouteNeedDay;
  readonly timing: RouteTiming;
  readonly operatorBuses: readonly { readonly depotId: string; readonly buses: number }[];
  readonly deadKm: DeadRunning | null;
}

export interface ScheduleInput {
  readonly depot: DepotSummary;
  readonly operatingDate: string;
  /** The shared plan's moment, so the schedule is in the same plan mode. */
  readonly now: PlanNow;
  /** One per trimmed registration (the shared plan's bus set). */
  readonly buses: readonly DepotBusView[];
  readonly fleet: ReadonlyMap<string, ModelledBus>;
  readonly yardEstablished: boolean;
  readonly routes: readonly ScheduleRouteInput[];
  readonly crewPool: readonly CrewSlot[];
  readonly holds: readonly BusHold[];
  readonly baselinePlan: DutyPlan;
}

export interface HourCoverage {
  readonly hour: number;
  readonly needed: number;
  readonly covered: number;
}

export interface SchedulePlan {
  readonly depotId: string;
  readonly operatingDate: string;
  readonly planMode: PlanMode;
  readonly params: ResolvedScheduleParams;
  readonly clamped: readonly string[];
  readonly routes: readonly DepotRouteNeed[];
  readonly routesWithoutNeed: readonly string[];
  readonly pieces: readonly PieceOfWork[];
  readonly blocks: readonly VehicleBlock[];
  readonly blockLowerBound: number;
  readonly blocksOverBound: number;
  readonly assignment: ScheduleAssignment;
  readonly uncovered: readonly UncoveredNeed[];
  readonly coverageByHour: readonly HourCoverage[];
  readonly crew: ScheduleCrew;
  readonly figures: ResourceFigures;
  readonly baseline: ScheduleBaseline;
  readonly comparison: ScheduleComparison;
  readonly provenance: {
    readonly need: Provenance;
    readonly timing: Provenance;
    readonly crew: Provenance;
    readonly holds: Provenance;
    readonly fleet: 'live';
  };
}
