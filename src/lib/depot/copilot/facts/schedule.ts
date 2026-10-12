import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import { buildRequest, busCount, cleanName, count, makeFact, nameFact, ph } from '@/lib/depot/copilot/facts/format';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import { formatMinute } from '@/lib/depot/format';
import type { ScheduleSummary, SchedulerRollupResponse } from '@/lib/depot/schedule/api';
import type { SchedulePlan } from '@/lib/depot/schedule/types';
import { MINUTES_PER_HOUR } from '@/lib/depot/units';

/*
 * The AI Scheduler's facts and scripted answers. Every figure, with its noun, is
 * a fact; the prose puts figures after a colon or in a list and never says where
 * a figure comes from. Crew are counted as slots, never as people.
 */

export interface SchedulePlanBody {
  readonly plan: SchedulePlan;
  readonly depotName: string;
}

export const RECOMMENDATION_ONLY = 'This is a recommendation; nothing is dispatched or assigned.';
/** Words the schedule texts never carry, on any writer: the pages say nothing about where a figure comes from. */
export const ORIGIN_WORDS: readonly string[] = ['model', 'models', 'modelled', 'modelling', 'simulated'];
const RATIONALE_GUIDANCE =
  'Explain in plain language why this schedule plan for the depot covers the day with the resources it names: ' +
  'what is freed against today, where slots are short and why, what the plan could not cover. ' +
  'Use only the supplied facts, describe and recommend, never instruct, never discuss a person, and never say where a figure comes from.';

const slots = (n: number, role: string): string => `${count(n)} ${role} ${n === 1 ? 'slot' : 'slots'}`;
const hours = (n: number): string => `${count(Math.round(n))} ${Math.round(n) === 1 ? 'hour' : 'hours'}`;
const freedText = (n: number): string => (n >= 0 ? busCount(n) : `${busCount(-n)} more than today`);

function planFacts(body: SchedulePlanBody): CopilotFact[] {
  const { plan } = body;
  return [
    nameFact('plan.depot', 'Depot', cleanName(body.depotName), 'live', plan.depotId),
    makeFact('plan.buses', 'Buses in the plan', busCount(plan.figures.buses), 'derived'),
    makeFact('plan.buses_today', 'Buses today', busCount(plan.baseline.figures.buses), 'derived'),
    makeFact('plan.freed', 'Buses freed', freedText(plan.comparison.busesFreed), 'derived'),
    makeFact('plan.routes', 'Routes', `${count(plan.routes.length)} ${plan.routes.length === 1 ? 'route' : 'routes'}`, 'derived'),
    makeFact('plan.driver_slots', 'Driver slots in the plan', slots(plan.figures.crewSlots.driver, 'driver'), 'derived'),
    makeFact('plan.conductor_slots', 'Conductor slots in the plan', slots(plan.figures.crewSlots.conductor, 'conductor'), 'derived'),
    makeFact('plan.hours', 'Hours on shift', hours(plan.figures.crewHours.driver), 'derived'),
    makeFact('plan.hours_today', 'Hours on shift today', hours(plan.baseline.figures.crewHours.driver), 'derived'),
    makeFact('plan.uncovered', 'Need left uncovered', `${count(plan.figures.uncoveredBusHours)} bus-hours`, 'derived'),
  ];
}

function shiftFacts(plan: SchedulePlan): CopilotFact[] {
  const { crew } = plan;
  return [
    makeFact('shift.count', 'Shifts in the plan', `${count(crew.shifts.length)} ${crew.shifts.length === 1 ? 'shift' : 'shifts'}`, 'derived'),
    makeFact('shift.driver_available', 'Driver slots available', slots(crew.available.driver, 'driver'), 'derived'),
    makeFact('shift.driver_used', 'Driver slots used', slots(crew.slotsUsed.driver, 'driver'), 'derived'),
    makeFact('shift.driver_short', 'Shifts short of a driver slot', `${count(crew.uncoveredByRole.driver)} ${crew.uncoveredByRole.driver === 1 ? 'shift' : 'shifts'}`, 'derived'),
    makeFact('shift.conductor_available', 'Conductor slots available', slots(crew.available.conductor, 'conductor'), 'derived'),
    makeFact('shift.conductor_used', 'Conductor slots used', slots(crew.slotsUsed.conductor, 'conductor'), 'derived'),
    makeFact('shift.conductor_short', 'Shifts short of a conductor slot', `${count(crew.uncoveredByRole.conductor)} ${crew.uncoveredByRole.conductor === 1 ? 'shift' : 'shifts'}`, 'derived'),
    makeFact('shift.relief', 'Blocks needing a relief', `${count(crew.blocksNeedingRelief)} ${crew.blocksNeedingRelief === 1 ? 'block' : 'blocks'}`, 'derived'),
  ];
}

export function scheduleSummaryAnswer(body: SchedulePlanBody | undefined): CopilotRequest {
  if (!body) return unavailable('that schedule plan');
  const facts = planFacts(body);
  const { plan } = body;
  const paragraphs = [
    `Buses in the plan: ${ph('plan.buses')}; today: ${ph('plan.buses_today')}; freed: ${ph('plan.freed')}.`,
    `The routes covered: ${ph('plan.routes')}. Driver slots: ${ph('plan.driver_slots')}; conductor slots: ${ph('plan.conductor_slots')}.`,
    plan.figures.uncoveredBusHours === 0
      ? 'Every part of the need is covered.'
      : `The need left uncovered: ${ph('plan.uncovered')}.`,
    RECOMMENDATION_ONLY,
  ];
  return { ...answer(cleanName(body.depotName), facts, { headline: `The schedule plan for ${ph('plan.depot')}`, paragraphs }), refuseWords: ORIGIN_WORDS };
}

export function scheduleShiftCoverAnswer(body: SchedulePlanBody | undefined): CopilotRequest {
  if (!body) return unavailable('that schedule plan');
  const { plan } = body;
  const facts = [...planFacts(body), ...shiftFacts(plan)];
  const short = plan.crew.uncoveredByRole.driver + plan.crew.uncoveredByRole.conductor;
  const paragraphs = [
    `The shifts in the plan: ${ph('shift.count')}; time on shift: ${ph('plan.hours')}.`,
    `Driver slots used: ${ph('shift.driver_used')}; available: ${ph('shift.driver_available')}.`,
    `Conductor slots used: ${ph('shift.conductor_used')}; available: ${ph('shift.conductor_available')}.`,
    short === 0
      ? 'Every shift has a driver slot and a conductor slot.'
      : `The shifts short of a driver slot: ${ph('shift.driver_short')}; short of a conductor slot: ${ph('shift.conductor_short')}.`,
    RECOMMENDATION_ONLY,
  ];
  return { ...answer(cleanName(body.depotName), facts, { headline: `Shifts and slots at ${ph('plan.depot')}`, paragraphs }), refuseWords: ORIGIN_WORDS };
}

const MAX_UNCOVERED_ROWS = 3;

export function scheduleUncoveredAnswer(body: SchedulePlanBody | undefined): CopilotRequest {
  if (!body) return unavailable('that schedule plan');
  const { plan } = body;
  const rows = [...plan.uncovered].sort((a, b) => b.buses - a.buses || a.hour - b.hour).slice(0, MAX_UNCOVERED_ROWS);
  const facts: CopilotFact[] = [
    ...planFacts(body),
    ...rows.flatMap((u, i) => [
      nameFact(`unc.${i + 1}.name`, 'Route', cleanName(u.routeName), 'live'),
      makeFact(`unc.${i + 1}.buses`, 'Buses short', `${busCount(u.buses)} from ${formatMinute(u.hour * MINUTES_PER_HOUR)} to ${formatMinute((u.hour + 1) * MINUTES_PER_HOUR)}`, 'derived'),
    ]),
  ];
  const paragraphs =
    rows.length === 0
      ? ['Every part of the need is covered in this plan.', RECOMMENDATION_ONLY]
      : [
          `The need left uncovered: ${ph('plan.uncovered')}.`,
          ...rows.map((_, i) => `The route ${ph(`unc.${i + 1}.name`)} is short by ${ph(`unc.${i + 1}.buses`)}.`),
          RECOMMENDATION_ONLY,
        ];
  return { ...answer(cleanName(body.depotName), facts, { headline: `Uncovered need at ${ph('plan.depot')}`, paragraphs }), refuseWords: ORIGIN_WORDS };
}

const MAX_ROLLUP_ROWS = 5;

export function schedulerSummaryAnswer(rollup: SchedulerRollupResponse | null | undefined): CopilotRequest {
  if (!rollup) return unavailable('the schedule plans');
  const top: ScheduleSummary[] = [...rollup.depots].sort((a, b) => b.busesFreed - a.busesFreed).slice(0, MAX_ROLLUP_ROWS);
  const facts: CopilotFact[] = [
    makeFact('roll.planned', 'Depots planned', `${count(rollup.planned)} of ${count(rollup.total)} depots`, 'derived'),
    makeFact('roll.freed', 'Buses freed', freedText(rollup.summary.busesFreed), 'derived'),
    makeFact('roll.slots', 'Crew slots freed', `${count(rollup.summary.crewSlotsFreed)} crew slots`, 'derived'),
    makeFact('roll.uncovered', 'Need left uncovered', `${count(rollup.summary.uncoveredBusHours)} bus-hours`, 'derived'),
    ...top.flatMap((d, i) => [
      nameFact(`roll.${i + 1}.name`, 'Depot', cleanName(d.depotName), 'live', d.depotId),
      makeFact(`roll.${i + 1}.freed`, 'Buses freed', freedText(d.busesFreed), 'derived'),
    ]),
  ];
  const paragraphs = [
    `Depots planned: ${ph('roll.planned')}. Buses freed: ${ph('roll.freed')}; crew slots freed: ${ph('roll.slots')}.`,
    `The need left uncovered: ${ph('roll.uncovered')}.`,
    ...(top.length === 0 ? [] : [`Most buses freed: ${top.map((_, i) => `${ph(`roll.${i + 1}.name`)} with ${ph(`roll.${i + 1}.freed`)}`).join('; ')}.`]),
    RECOMMENDATION_ONLY,
  ];
  return { ...answer('the schedule plans', facts, { headline: 'The schedule plans across the depots', paragraphs }), refuseWords: ORIGIN_WORDS };
}

/** Why the plan: the figures against today, the slots short, and what is left uncovered. */
export function buildScheduleRationale(body: SchedulePlanBody): CopilotRequest {
  const { plan } = body;
  const facts = [...planFacts(body), ...shiftFacts(plan)];
  const short = plan.crew.uncoveredByRole.driver + plan.crew.uncoveredByRole.conductor;
  const paragraphs = [
    `The plan places buses on the routes the depot runs so that the need of the day is met with fewer buses and slots where the day allows. Buses in the plan: ${ph('plan.buses')}; today: ${ph('plan.buses_today')}; freed: ${ph('plan.freed')}.`,
    `Time on shift: ${ph('plan.hours')}; today: ${ph('plan.hours_today')}. Driver slots: ${ph('plan.driver_slots')}; conductor slots: ${ph('plan.conductor_slots')}.`,
    short === 0
      ? 'Every shift has a driver slot and a conductor slot.'
      : `The shifts short of a driver slot: ${ph('shift.driver_short')}; short of a conductor slot: ${ph('shift.conductor_short')}.`,
    plan.figures.uncoveredBusHours === 0 ? 'Every part of the need is covered.' : `The need left uncovered: ${ph('plan.uncovered')}.`,
    RECOMMENDATION_ONLY,
  ];
  return {
    ...buildRequest({
      task: 'rationale',
      scopeLabel: cleanName(body.depotName),
      facts,
      guidance: RATIONALE_GUIDANCE,
      scriptedDraft: { headline: `Why this plan for ${ph('plan.depot')}`, paragraphs },
    }),
    refuseWords: ORIGIN_WORDS,
  };
}
