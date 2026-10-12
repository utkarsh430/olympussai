import { z } from 'zod';
import type { DepotFeedEnvelope } from '../api';
import type { CrewRole } from '../crew/types';
import type { SchedulePlan } from './types';

/*
 * What the schedule routes answer. The plan is the engine's, verbatim; the
 * summary is what the Headquarters roll-up carries per depot.
 */

export interface Bounds {
  readonly min: number;
  readonly max: number;
}

export interface ScheduleLimits {
  readonly surgePercent: Bounds;
  readonly targetLoad: Bounds;
  readonly blockMinutes: Bounds;
  readonly turnaroundMinutes: Bounds;
}

export interface ScheduleResponse extends DepotFeedEnvelope {
  readonly depotId: string;
  readonly depotName: string;
  readonly operatingDate: string;
  readonly plan: SchedulePlan;
  /** A key of the plan's figures and date: the decision trail's subject. */
  readonly planKey: string;
  readonly limits: ScheduleLimits;
}

export interface ScheduleSummary {
  readonly depotId: string;
  readonly depotName: string;
  readonly busesScheduled: number;
  readonly busesToday: number;
  readonly busesFreed: number;
  readonly crewSlotsUsed: Readonly<Record<CrewRole, number>>;
  readonly crewSlotsToday: Readonly<Record<CrewRole, number>>;
  readonly crewHours: number;
  readonly crewHoursToday: number;
  readonly uncoveredBusHours: number;
  readonly deadKm: number | null;
  readonly routes: number;
  readonly planKey: string;
}

export interface SchedulerRollupResponse extends DepotFeedEnvelope {
  readonly operatingDate: string;
  /** Depots planned so far, by name. */
  readonly depots: readonly ScheduleSummary[];
  readonly planned: number;
  readonly pending: number;
  readonly total: number;
  readonly summary: {
    readonly busesFreed: number;
    readonly crewSlotsFreed: number;
    readonly uncoveredBusHours: number;
    readonly depotsWithUncovered: number;
  };
}

const MAX_NAME = 80;
const MAX_REGISTRATION = 24;

/** The what-if body, strict: any other key is refused before the engine sees it. */
export const scheduleParamsSchema = z
  .object({
    demandSurgePercent: z.number().optional(),
    routeSurges: z.array(z.object({ routeName: z.string().min(1).max(MAX_NAME), percent: z.number() }).strict()).max(50).optional(),
    targetLoad: z.number().optional(),
    busesOutOfService: z.array(z.string().min(1).max(MAX_REGISTRATION)).max(500).optional(),
    crewUnavailable: z.object({ driver: z.number().optional(), conductor: z.number().optional() }).strict().optional(),
    maxBlockMinutes: z.number().optional(),
    minTurnaroundMinutes: z.number().optional(),
    locks: z.array(z.object({ registrationNumber: z.string().min(1).max(MAX_REGISTRATION), routeName: z.string().min(1).max(MAX_NAME) }).strict()).max(100).optional(),
    holdForMaintenance: z.boolean().optional(),
  })
  .strict();

export type ScheduleParamsBody = z.infer<typeof scheduleParamsSchema>;
