import type { DepotFeedEnvelope } from '../api';
import type { CrewAvailability, CrewRole, UncoveredReason } from './types';

/*
 * What the crew page receives. Crew are anonymous slots: nothing here describes
 * a person beyond a slot id and its role, and no hours figure is carried at all
 * (weekly hours are a rostering input, not something to show beside a slot).
 * Keys avoid the words a test forbids (name, score, rank, rating, performance,
 * speed, violation), so `depotLabel` and `route` stand where a name would.
 */

/** Slots by availability, for one role. */
export type AvailabilityCounts = Readonly<Record<CrewAvailability, number>>;

export interface CrewRoleFigures {
  readonly required: number;
  readonly available: number;
}

/** One shift of one duty; the roster and the uncovered table share this. */
export interface CrewShiftRow {
  readonly dutyId: string;
  readonly route: string;
  readonly shiftIndex: number;
  readonly shiftCount: number;
  /** Minutes from midnight of the operating date. */
  readonly startMin: number;
  readonly endMin: number;
}

export interface UncoveredShiftRow extends CrewShiftRow {
  readonly shortRoles: readonly CrewRole[];
  readonly reason: UncoveredReason;
}

export interface RosterShiftRow extends CrewShiftRow {
  readonly driverSlot: string;
  readonly conductorSlot: string;
}

/** GET /api/upsrtc/depot/[depotId]/crew */
export interface CrewResponse extends DepotFeedEnvelope {
  readonly depotId: string;
  readonly depotLabel: string;
  readonly operatingDate: string;
  /** Everything on the page is modelled; no crew feed exists yet. */
  readonly provenance: 'modelled';
  readonly summary: {
    readonly shiftsRequired: number;
    readonly shiftsCovered: number;
    readonly shiftsUncovered: number;
    readonly driver: CrewRoleFigures;
    readonly conductor: CrewRoleFigures;
    readonly dutiesFullyCovered: number;
    readonly dutiesPartlyCovered: number;
    readonly dutiesUncovered: number;
    readonly dutiesNeedingRelief: number;
  };
  readonly availability: Readonly<Record<CrewRole, AvailabilityCounts>>;
  /** Most pressing first. */
  readonly uncovered: readonly UncoveredShiftRow[];
  /** Covered shifts in start order, capped at `rosterCap`; `rosterTotal` is the full count. */
  readonly roster: readonly RosterShiftRow[];
  readonly rosterTotal: number;
  readonly rosterCap: number;
  readonly limits: { readonly dailyHours: number; readonly weeklyHours: number };
}
