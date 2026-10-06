import type { DepotSummary } from '../types';

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
  /** Hours already worked this week, before the operating date's duties. */
  readonly hoursThisWeek: number;
}

export type UncoveredReason = 'no_available_crew' | 'hours_limit';

export interface CrewAssignment {
  readonly dutyId: string;
  /** Both slots are null when the duty is uncovered; no half-crewed duty is booked. */
  readonly driverSlot: string | null;
  readonly conductorSlot: string | null;
  readonly uncoveredReason: UncoveredReason | null;
}

export interface CrewSummary {
  /** One driver and one conductor per duty. */
  readonly required: Readonly<Record<CrewRole, number>>;
  /** Slots whose availability is `available`, before any are booked. */
  readonly available: Readonly<Record<CrewRole, number>>;
  readonly byAvailability: Readonly<Record<CrewAvailability, number>>;
  /** Duties with no crew booked; equals required minus assigned. */
  readonly uncoveredDuties: number;
  readonly assignedDuties: number;
  /** Duties longer than the daily limit: they can never be covered. */
  readonly dutiesOverDailyLimit: number;
  /** In duty order (start time, then id). */
  readonly assignments: readonly CrewAssignment[];
}

export const MAX_DUTY_HOURS_PER_DAY = 10;
export const MAX_HOURS_PER_WEEK = 48;

/** The modelled crew for a depot on a date; a real roster feed replaces it. */
export interface CrewRepository {
  crewFor(
    depot: DepotSummary,
    dutyCount: number,
    operatingDate: string,
  ): Promise<readonly CrewSlot[]>;
}
