import { PEOPLE_SENTENCE } from '../crew/crewPageModel';
import { formatPlainDate } from '../format';
import { BROWSER_TRAIL_NOTE, RECORDED_ONLY } from '../rebalance/decisionWording';
import type { BlockHoldReason, ResolvedScheduleParams, UncoveredNeedReason } from './types';

/*
 * Every sentence the scheduler pages show. None names where a figure comes
 * from: the plan is a recommendation, and the pages say so once.
 */

export { PEOPLE_SENTENCE };

export const RECOMMENDATION_SENTENCE = 'Recommendation only. Nothing is dispatched or assigned.';
export const PAGE_TITLE = 'AI Scheduler';
export const PAGE_DESCRIPTION = `Buses, drivers and conductors placed on the day's routes with the fewest resources. ${RECOMMENDATION_SENTENCE}`;
export const ROLLUP_DESCRIPTION = `Every depot's plan for the day: buses and crew freed, need left uncovered, plans awaiting a decision. ${RECOMMENDATION_SENTENCE}`;
export const SCHEDULE_DECISION_NOTE = RECORDED_ONLY;
export const SCHEDULE_TRAIL_NOTE = `${BROWSER_TRAIL_NOTE} A decision changes nothing but this record; no bus or crew slot is assigned.`;
export const COVERED_SENTENCE = 'Every hour of need is covered.';
export const AWAITING_CAPTION = 'in this browser';

export const HOLD_REASON_TEXT: Readonly<Record<BlockHoldReason, string>> = {
  off_road: 'off the road',
  dark: 'not reporting',
  not_in_yard: 'not in the yard',
  not_heard: 'not heard recently',
  class_mismatch: 'wrong class',
  job_card_open: 'in the workshop',
  service_overdue: 'service overdue',
  out_of_service: 'taken out of service',
};

export const UNCOVERED_REASON_TEXT: Readonly<Record<UncoveredNeedReason, string>> = {
  fleet_short: 'fewer buses than the need',
  buses_held_out: 'buses held out',
  past_day_end: 'runs past midnight',
};

export function emptyScheduleSentence(operatingDate: string): string {
  return `No route of this depot needs a bus on ${formatPlainDate(operatingDate)}.`;
}

export function rollupProgressSentence(planned: number, total: number): string {
  return `Plans ready for ${planned} of ${total} depots; the rest follow as the page refreshes.`;
}

/** The what-if in force, in one line; empty when every value is the default. */
export function whatIfLine(params: ResolvedScheduleParams, defaults: ResolvedScheduleParams): string {
  const parts: string[] = [];
  if (params.demandSurgePercent !== 0) parts.push(`demand ${params.demandSurgePercent > 0 ? '+' : ''}${params.demandSurgePercent}%`);
  for (const surge of params.routeSurges) parts.push(`${surge.routeName} ${surge.percent > 0 ? '+' : ''}${surge.percent}%`);
  if (params.targetLoad !== defaults.targetLoad) parts.push(`target load ${Math.round(params.targetLoad * 100)}%`);
  if (params.busesOutOfService.length > 0) parts.push(`${params.busesOutOfService.length} out of service`);
  if (params.crewUnavailable.driver > 0) parts.push(`${params.crewUnavailable.driver} drivers unavailable`);
  if (params.crewUnavailable.conductor > 0) parts.push(`${params.crewUnavailable.conductor} conductors unavailable`);
  if (params.maxBlockMinutes !== defaults.maxBlockMinutes) parts.push(`blocks up to ${params.maxBlockMinutes / 60} h`);
  if (params.minTurnaroundMinutes !== defaults.minTurnaroundMinutes) parts.push(`turnaround ${params.minTurnaroundMinutes} min`);
  for (const lock of params.locks) parts.push(`${lock.registrationNumber} on ${lock.routeName}`);
  if (!params.holdForMaintenance) parts.push('workshop holds ignored');
  return parts.length === 0 ? '' : `What-if: ${parts.join(', ')}.`;
}
