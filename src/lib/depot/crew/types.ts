import type { DepotSummary } from '../types';

/** The most one crew slot may work in a day, and in a week. */
export const MAX_DUTY_HOURS_PER_DAY = 10;
export const MAX_HOURS_PER_WEEK = 48;

/*
 * Crew model. People are not modelled: a slot is an anonymous place in the
 * roster (`D-014`). Nothing here carries a name, a score or anything derived
 * from how a vehicle was driven; the data is availability and hours only.
 */

export type CrewRole = 'driver' | 'conductor';
export type CrewAvailability = 'available' | 'weekly_off' | 'leave' | 'training' | 'absent';

export interface CrewSlot {
  /** Role letter and zero-padded number, stable for a depot across dates. */
  readonly id: string;
  readonly role: CrewRole;
  readonly availability: CrewAvailability;
  /**
   * Hours already worked this week. A rostering input for the hours limits
   * only: never show it on a page beside a slot id as if it were a figure
   * about a person.
   */
  readonly hoursThisWeek: number;
}

/**
 * One crew shift: a duty no longer than the daily limit is one shift, a longer
 * one is cut into the fewest consecutive shifts that each fit the limit.
 */
export interface CrewShift {
  readonly dutyId: string;
  readonly shiftIndex: number;
  readonly shiftCount: number;
  readonly startMin: number;
  readonly endMin: number;
}

export interface CrewShifts {
  /** Ordered by start, then duty id, then shift index. */
  readonly shifts: readonly CrewShift[];
  /** Duties split into more than one shift: they need a relief crew. */
  readonly dutiesNeedingRelief: number;
  /** Duties whose end is at or before their start; they get no shift. Sorted. */
  readonly invalidDutyIds: readonly string[];
}

export type UncoveredReason = 'no_available_crew' | 'hours_limit';

/**
 * Why one role could not be filled for a shift. `hours_limit` wins when any
 * slot that was free at that time was refused on hours; `all_rostered` means
 * every available slot was already booked then; `no_slot_available` means the
 * role has no available slot at all today.
 */
export type ShortfallCause = 'no_slot_available' | 'all_rostered' | 'hours_limit';

export interface RoleShortfall {
  readonly role: CrewRole;
  readonly cause: ShortfallCause;
}

export interface CrewAssignment extends CrewShift {
  /** Both slots are null when the shift is uncovered; no half-crewed shift is booked. */
  readonly driverSlot: string | null;
  readonly conductorSlot: string | null;
  /**
   * `hours_limit` only when every short role had a free available slot that
   * was refused solely by an hours limit; otherwise `no_available_crew`.
   */
  readonly uncoveredReason: UncoveredReason | null;
  /** The roles that could not be filled; empty when covered. */
  readonly shortRoles: readonly CrewRole[];
  /** One entry per short role, in role order (driver, conductor); empty when covered. */
  readonly shortfalls: readonly RoleShortfall[];
}

export interface CrewSummary {
  /** One driver and one conductor per shift. */
  readonly required: Readonly<Record<CrewRole, number>>;
  /** Slots whose availability is `available`, before any are booked. */
  readonly available: Readonly<Record<CrewRole, number>>;
  readonly byAvailability: Readonly<Record<CrewAvailability, number>>;
  readonly shiftsRequired: number;
  readonly shiftsCovered: number;
  readonly shiftsUncovered: number;
  /** Shifts left uncovered with that role short. */
  readonly uncoveredByRole: Readonly<Record<CrewRole, number>>;
  /** Fully, partly and not covered duties add up to the valid duties. */
  readonly dutiesFullyCovered: number;
  readonly dutiesPartlyCovered: number;
  readonly dutiesUncovered: number;
  /** Duties split into more than one shift: a page can say "N duties need a relief crew". */
  readonly dutiesNeedingRelief: number;
  readonly invalidDutyIds: readonly string[];
  /** One per shift, in shift order. */
  readonly assignments: readonly CrewAssignment[];
}

/** The modelled crew for a depot on a date; a real roster feed replaces it. */
export interface CrewRepository {
  crewFor(
    depot: DepotSummary,
    shiftCount: number,
    operatingDate: string,
  ): Promise<readonly CrewSlot[]>;
}
