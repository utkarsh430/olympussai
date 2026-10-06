import type { DepotBusView } from '../api';
import type { AssignmentPlan, Duty, DutyAssignment, Ineligibility } from '../duties/types';
import type { ModelledBus, ServiceClass } from '../sim/types';
import { hungarian } from './hungarian';

const MINUTES_PER_HOUR = 60;
/** Age assumed for a bus the fleet master does not know; it also counts as ordinary. */
const UNKNOWN_BUS_AGE_YEARS = 0;
const DEFAULT_CLASS: ServiceClass = 'ordinary';

type Exclusion = 'off_road' | 'dark' | 'not_in_yard';

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Exactly one reason, by precedence: off road, then dark, then away from the yard. */
function exclusionOf(bus: DepotBusView): Exclusion | null {
  if (bus.state === 'off_road') return 'off_road';
  if (bus.state === 'dark') return 'dark';
  if (bus.location !== 'in_yard') return 'not_in_yard';
  return null;
}

/**
 * Proposes which bus runs which duty: an exact minimum-cost matching. Buses
 * that are off road, dark or not in the yard are excluded first, each with one
 * reason. A pairing across service classes is forbidden. Cost is
 * `ageYears x round(durationHours)`, so longer duties prefer younger buses and
 * wear is spread. The matching never fails: duties without a bus are reported
 * as `no_eligible_bus`, and eligible buses without a duty as spare.
 * Deterministic whatever the order of `buses` (they are sorted by registration;
 * a repeated registration is considered once). Recommendation only.
 */
export function assignDuties(
  duties: readonly Duty[],
  buses: readonly DepotBusView[],
  fleet: ReadonlyMap<string, ModelledBus>,
): AssignmentPlan {
  const seen = new Set<string>();
  const sorted = [...buses]
    .sort((a, b) => compare(a.registrationNumber, b.registrationNumber))
    .filter((b) => !seen.has(b.registrationNumber) && seen.add(b.registrationNumber));

  const excluded: { registrationNumber: string; reason: Ineligibility }[] = [];
  const eligible: DepotBusView[] = [];
  for (const bus of sorted) {
    const reason = exclusionOf(bus);
    if (reason === null) eligible.push(bus);
    else excluded.push({ registrationNumber: bus.registrationNumber, reason });
  }

  const cost = duties.map((duty) => {
    const hours = Math.round((duty.endMin - duty.startMin) / MINUTES_PER_HOUR);
    return eligible.map((bus) => {
      const modelled = fleet.get(bus.registrationNumber);
      if ((modelled?.serviceClass ?? DEFAULT_CLASS) !== duty.serviceClass) return Infinity;
      return (modelled?.ageYears ?? UNKNOWN_BUS_AGE_YEARS) * hours;
    });
  });
  const { rowToCol } = hungarian(cost);

  const assignments: DutyAssignment[] = duties.map((duty, row) => {
    const matched = eligible[rowToCol[row] ?? -1];
    return matched !== undefined
      ? { dutyId: duty.id, registrationNumber: matched.registrationNumber, reason: 'assigned' }
      : { dutyId: duty.id, registrationNumber: null, reason: 'no_eligible_bus' };
  });
  const used = new Set(rowToCol.filter((c) => c >= 0));
  return {
    assignments,
    spareBuses: eligible.filter((_, col) => !used.has(col)).map((b) => b.registrationNumber),
    excluded,
    unassignedDuties: rowToCol.filter((c) => c < 0).length,
  };
}
