import { formatCount } from '../format';
import { BROWSER_TRAIL_NOTE, RECORDED_ONLY } from '../rebalance/decisionWording';
import { RECOMMENDATION_SENTENCE } from '../schedule/scheduleWording';
import type { CrewNote, ExcludedReason, IncidentConfidence, IncidentSignal, ReplacementCandidate, ReplacementKind } from './types';

/*
 * Every sentence the Incident Response pages show. Nothing names where a
 * figure comes from; a plan is a recommendation and the pages say so once.
 */

export const PAGE_TITLE = 'Incident Response';
export const PAGE_DESCRIPTION = `Buses that may have broken down on the road and the quickest way to move their passengers. ${RECOMMENDATION_SENTENCE}`;
export const ROLLUP_DESCRIPTION = `Every depot's suspected breakdowns and the replacement recommended for each. ${RECOMMENDATION_SENTENCE}`;
export const CREW_SENTENCE = 'Crew are counted as slots only. No individual is named or assessed.';
export const EMPTY_SENTENCE = 'No bus of this depot looks broken down on this snapshot. Declare one from the roster’s bus drawer or above.';
export const DECLARE_LABEL = 'Plan a replacement';
export const INCIDENT_DECISION_NOTE = RECORDED_ONLY;
export const INCIDENT_TRAIL_NOTE = `${BROWSER_TRAIL_NOTE} A decision changes nothing but this record; no bus is sent.`;
export const METHOD_LINES: readonly string[] = [
  'A bus is listed when the feed reports it under tow or with its emergency flag raised, or when it stands away from every stop, terminal and yard on a journey that is still running, or has not been heard on that journey.',
  'Standing ten minutes or more away from any stop raises the confidence; stop positions come from the route page once its details have been loaded there.',
  'Arrival times assume 30 km/h on the road, a ten-minute turnaround for a spare from the yard, fifteen for one from another depot and five for a handover, and are shown on a five-minute grid.',
];

export const CONFIDENCE_WORD: Readonly<Record<IncidentConfidence, string>> = { high: 'High', medium: 'Medium', low: 'Low' };

export const SIGNAL_TEXT: Readonly<Record<IncidentSignal, string>> = {
  towing: 'Under tow (feed status)',
  emergency_flag: 'Emergency flag raised by the device',
  stopped_on_route: 'Stopped away from any stop',
  not_heard_on_route: 'Not heard on its journey',
  power_off: 'Main power off',
};

export function kindText(kind: ReplacementKind, depotName: string): string {
  switch (kind) {
    case 'own_yard_spare':
      return 'Spare from the yard';
    case 'other_depot_spare':
      return `Spare from ${depotName}`;
    case 'following_bus':
      return 'Following bus on the route';
    case 'block_ending_bus':
      return 'Bus ending its block nearby';
    case 'next_scheduled':
      return 'Next scheduled bus';
  }
}

export const CREW_TEXT: Readonly<Record<CrewNote, string>> = {
  original_crew_continues: 'the broken bus’s crew continue on it',
  own_crew_aboard: 'its own crew aboard',
  ferry_driver_needed: 'one free driver slot brings it out',
  no_ferry_driver: 'no driver slot free to bring it out',
};

export const EXCLUDED_TEXT: Readonly<Record<ExcludedReason, string>> = {
  not_enough_seats: 'Not enough seats for the passengers aboard',
  no_ferry_driver: 'No driver slot free to bring it out',
  ahead_on_route: 'Ahead of the breakdown on the route',
  beyond_range: 'Beyond the range for a move',
  direction_unknown: 'Direction along the route not known: stop positions not loaded',
};

export function stoppedText(minutes: number | null): string {
  return minutes === null ? 'duration not yet observed' : `stopped ${formatCount(minutes)} min`;
}

export function recommendationSentence(candidate: ReplacementCandidate | null, baseline: ReplacementCandidate): string {
  if (candidate === null) {
    return baseline.arrivalMinutes === null
      ? 'No replacement can be routed; no further bus is known on this route today.'
      : `Wait for the next scheduled bus: about ${formatCount(baseline.arrivalMinutes)} min.`;
  }
  const who = candidate.registrationNumber === null ? kindText(candidate.kind, candidate.depotName) : `${kindText(candidate.kind, candidate.depotName)}, bus ${candidate.registrationNumber}`;
  const moving = candidate.passengersMovingMinutes === null ? '' : `: passengers moving in about ${formatCount(candidate.passengersMovingMinutes)} min`;
  const dead = candidate.deadKm > 0 ? `, ${candidate.deadKm} dead km` : '';
  return `Send ${who}${moving}${dead}.`;
}

export function rollupProgressSentence(planned: number, total: number): string {
  return `Depots checked: ${formatCount(planned)} of ${formatCount(total)}; the rest follow as the page refreshes.`;
}
