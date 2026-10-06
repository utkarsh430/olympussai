/**
 * The depot Trends page sets the forecast of available buses beside the
 * fleet distribution's modelled requirement, and says in one sentence what
 * the comparison means. Pure; both sides are modelled and the page says so.
 */
import type { DepotBalance } from '../optimise/types';
import type { ForecastResult } from './types';

export type RequirementInput = Pick<DepotBalance, 'required' | 'peakRequirement' | 'spareTarget'>;

export type AvailabilityComparison =
  | {
      readonly status: 'ok';
      readonly required: number;
      /** Lowest and highest forecast value over the horizon, in whole buses. */
      readonly lowest: number;
      readonly highest: number;
      /** Days whose forecast value is below the requirement. */
      readonly daysBelow: number;
      /** Days whose band's lower edge is below the requirement. */
      readonly daysBandBelow: number;
      readonly horizonDays: number;
      readonly sentence: string;
    }
  | { readonly status: 'no_forecast' | 'no_requirement'; readonly sentence: string };

export const BOTH_MODELLED_NOTE =
  'Both sides are MODELLED: the forecast rests on a generated history, and the requirement ' +
  'stands in for a network timetable that has not been supplied.';

const NO_REQUIREMENT =
  'No modelled requirement for this unit: the fleet distribution sets one only for operating depots.';
const NO_FORECAST = 'No forecast of available buses for this depot.';

function meaning(daysBelow: number, daysBandBelow: number, horizon: number): string {
  if (daysBelow > 0) {
    return (
      `below the modelled requirement of {R} on ${daysBelow} of ${horizon} days, so the depot ` +
      'may need buses lent from a neighbour on those days.'
    );
  }
  if (daysBandBelow > 0) {
    return (
      `at or above the modelled requirement of {R} on every day, though the band reaches below ` +
      `it on ${daysBandBelow} of ${horizon} days, so a shortfall is possible.`
    );
  }
  return (
    'at or above the modelled requirement of {R} on every day, so the depot is forecast to ' +
    'cover its own requirement.'
  );
}

export function compareAvailability(
  result: ForecastResult,
  requirement: RequirementInput | null,
  unavailable: string | null,
): AvailabilityComparison {
  if (result.status !== 'ok') return { status: 'no_forecast', sentence: unavailable ?? NO_FORECAST };
  if (requirement === null) return { status: 'no_requirement', sentence: NO_REQUIREMENT };
  const { points, horizonDays } = result.forecast;
  const { required, peakRequirement, spareTarget } = requirement;
  const values = points.map((p) => Math.round(p.value));
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const daysBelow = points.filter((p) => p.value < required).length;
  const daysBandBelow = points.filter((p) => p.low < required).length;
  const requirementWords = `${required} (${peakRequirement} at peak plus ${spareTarget} spare)`;
  const sentence =
    `MODELLED: available buses are forecast at ${lowest} to ${highest} over the next ` +
    `${horizonDays} days, ` +
    meaning(daysBelow, daysBandBelow, horizonDays).replace('{R}', requirementWords);
  return { status: 'ok', required, lowest, highest, daysBelow, daysBandBelow, horizonDays, sentence };
}
