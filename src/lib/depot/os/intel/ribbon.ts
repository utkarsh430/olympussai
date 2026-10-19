import { depotHref } from '../../depotNav';
import { formatCount } from '../../format';
import { INCIDENTS_PATH, REBALANCE_PATH } from '../../nav';
import {
  ACTIVITY_PATH,
  DATA_HEALTH_PATH,
  DECISIONS_PATH,
  FORECASTS_PATH,
  FUEL_AUDIT_PATH,
  HEADWAYS_PATH,
  RELIABILITY_PATH,
  SECTION_ANCHOR,
  SIMULATION_PATH,
  type WorkspaceId,
} from '../workspaces';
import type { Findings } from './analysis';
import { decisionHref } from './decisions';
import type { Decision, DecisionCategory } from './types';

/*
 * The AI ribbon above each workspace: three or four figures the engine holds for the
 * context, each a link to the records behind it, and the workspace's four-line insight
 * (what was identified, what is predicted, what is recommended, the expected impact)
 * taken from its most urgent decision. Pure; every figure comes from the last analysis.
 */

export type RibbonTone = 'crimson' | 'amber' | 'teal' | 'cyan' | 'slate';

export interface RibbonItem {
  readonly key: string;
  readonly value: string;
  readonly label: string;
  readonly tone: RibbonTone;
  readonly href: string;
}

export interface ScheduleFacts {
  readonly conflicts: number;
  readonly uncovered: number;
  readonly departures: number;
  readonly held: number;
  /** The latest optimised plan's departures covered, when one was generated this session. */
  readonly optimisedCovered: number | null;
}

export interface RibbonInput {
  readonly workspace: WorkspaceId;
  readonly findings: Findings;
  readonly depotId: string | null;
  readonly bunchedRoutes: number | null;
  readonly schedule: ScheduleFacts | null;
  readonly cycle: number;
  readonly intervalSec: number;
}

/** The workspace each decision category is worked in. */
export const CATEGORY_WORKSPACE: Readonly<Record<DecisionCategory, WorkspaceId>> = {
  shortage: 'network',
  redistribution: 'network',
  maintenance: 'reliability',
  incident: 'reliability',
  fuel: 'finance',
  crew: 'operations',
  telemetry: 'system',
  efficiency: 'finance',
  schedule: 'operations',
};

const n = formatCount;
const lakh = (rupees: number): string => (rupees >= 1e5 ? `₹${(rupees / 1e5).toFixed(1)} lakh` : `₹${n(rupees)}`);

function item(key: string, value: number | string, label: string, tone: RibbonTone, href: string, quietWhenZero = true): RibbonItem {
  const zero = typeof value === 'number' && value === 0;
  return { key, value: typeof value === 'number' ? n(value) : value, label, tone: zero && quietWhenZero ? 'slate' : tone, href };
}

export function ribbonItems(input: RibbonInput): RibbonItem[] {
  const f = input.findings;
  const base = input.depotId ? depotHref(input.depotId) : null;
  const decisions = base ? `${base}/decisions` : DECISIONS_PATH;
  const incidents = base ? `${base}/incidents` : INCIDENTS_PATH;
  const health = base ? `${base}/health` : RELIABILITY_PATH;
  const fuel = `${base ? `${base}/fuel-audit` : FUEL_AUDIT_PATH}?section=${SECTION_ANCHOR.anomalyQueue}`;
  const high = f.decisions.filter((d) => d.severity === 'high').length;
  switch (input.workspace) {
    case 'mission':
      return [
        item('critical', f.critical, 'critical decisions', 'crimson', decisions),
        item('high', high, 'high priority', 'amber', decisions),
        item('incidents', f.incidents, 'likely breakdowns', 'crimson', incidents),
        item('short', f.busesShort, `buses short at peak · ${n(f.shortDepots.length)} depots`, 'amber', REBALANCE_PATH),
      ];
    case 'network':
      return [
        item('short', f.busesShort, `buses short, morning peak · ${n(f.shortDepots.length)} depots`, 'amber', `/project/depots/service?section=${SECTION_ANCHOR.demandHeatmap}`),
        item('transfers', f.transfers, `possible transfers · ${n(f.busesToMove)} buses`, 'teal', `${REBALANCE_PATH}?section=${SECTION_ANCHOR.transfers}`),
        ...(input.bunchedRoutes !== null ? [item('bunched', input.bunchedRoutes, 'routes with buses bunched now', 'amber', HEADWAYS_PATH)] : []),
        item('surplus', f.surplusBuses, 'spare buses at peak', 'cyan', REBALANCE_PATH, false),
      ];
    case 'operations':
      if (input.schedule && base) {
        const s = input.schedule;
        return [
          item('conflicts', s.conflicts, 'vehicle conflicts in the original plan', 'crimson', `${base}/bus-scheduler`),
          item('uncovered', s.uncovered, `of ${n(s.departures)} departures uncovered`, 'amber', `${base}/bus-scheduler`),
          item('held', s.held, 'buses held (off road, overdue, reserve)', 'slate', `${base}/roster`, false),
          s.optimisedCovered !== null
            ? item('optimised', `${n(s.optimisedCovered)}/${n(s.departures)}`, 'covered by the AI plan', 'teal', `${base}/bus-scheduler`)
            : item('opportunity', 'Generate', 'an optimised bus plan', 'teal', `${base}/bus-scheduler?run=1`),
        ];
      }
      return [
        item('short', f.shortDepots.length, 'depots short at peak', 'amber', REBALANCE_PATH),
        item('offroad', f.offRoad, 'buses off road', 'slate', health, false),
        item('dark', f.dark, 'buses without a recent fix', 'amber', DATA_HEALTH_PATH),
      ];
    case 'reliability':
      return [
        item('incidents', f.incidents, 'likely breakdowns on the road', 'crimson', incidents),
        item('risk', f.highRisk, 'buses at high breakdown risk', 'amber', health),
        item('overdue', f.overdue, 'past service due', 'amber', health),
        item('offroad', f.offRoad, 'off road', 'slate', health, false),
      ];
    case 'finance':
      return f.fuelFlags === null
        ? [item('fuel', 'Auditing', 'fourteen days of journeys', 'cyan', fuel)]
        : [
            item('fuel', f.fuelFlags, 'fuel consumption anomalies', 'amber', fuel),
            item('exposure', lakh(f.fuelExposure ?? 0), 'estimated excess cost to verify', 'amber', fuel),
            item('decisions', f.decisions.filter((d) => CATEGORY_WORKSPACE[d.category] === 'finance').length, 'finance decisions', 'cyan', decisions),
          ];
    case 'performance':
      return [
        item('overdue', f.overdue, 'buses due service: availability at risk', 'amber', FORECASTS_PATH),
        item('short', f.busesShort, 'buses short at peak', 'amber', SIMULATION_PATH),
        item('transfers', f.transfers, 'redistribution proposals to simulate', 'teal', `${SIMULATION_PATH}`),
      ];
    case 'system':
    default:
      return [
        item('coverage', f.fleet > 0 ? `${Math.round((f.positioned / f.fleet) * 100)}%` : '—', 'of the fleet reporting GPS', 'cyan', DATA_HEALTH_PATH),
        item('dark', f.dark, 'buses without a recent fix', 'amber', DATA_HEALTH_PATH),
        item('cycle', n(input.cycle), input.intervalSec > 0 ? `analysis cycles · every ${input.intervalSec} s` : 'analysis cycles · paused', 'cyan', ACTIVITY_PATH),
      ];
  }
}

export interface Insight {
  readonly identified: string;
  readonly predicts: string;
  readonly recommends: string;
  readonly impact: string;
  readonly href: string;
}

function prediction(workspace: WorkspaceId, f: Findings, schedule: ScheduleFacts | null): string {
  switch (workspace) {
    case 'reliability':
      return `${n(f.overdue)} buses are past service due and ${n(f.highRisk)} carry a high breakdown risk on the risk index.`;
    case 'finance':
      return f.fuelFlags === null ? 'The fuel audit is still reading the last fourteen days.' : `${lakh(f.fuelExposure ?? 0)} of diesel on ${n(f.fuelFlags)} journeys is above each bus's own economy.`;
    case 'operations':
      return schedule ? `The original plan leaves ${n(schedule.uncovered)} of ${n(schedule.departures)} departures uncovered with today's held buses.` : `${n(f.shortDepots.length)} depots are forecast short at the morning peak.`;
    case 'system':
      return `${n(f.dark)} buses have no recent fix; their state is not observed until they report.`;
    default:
      return f.busesShort > 0 ? `The morning peak needs ${n(f.busesShort)} more buses than ${n(f.shortDepots.length)} depots hold.` : 'No depot in this context is forecast short at the morning peak.';
  }
}

/** The workspace's four-line insight from its most urgent decision, or null when it has none. */
export function insightFor(workspace: WorkspaceId, decisions: readonly Decision[], findings: Findings, schedule: ScheduleFacts | null, depotId: string | null): Insight | null {
  const own = workspace === 'mission' || workspace === 'performance' ? decisions : decisions.filter((d) => CATEGORY_WORKSPACE[d.category] === workspace);
  const top = own[0] ?? null;
  if (!top && workspace === 'operations' && schedule && depotId) {
    const covered = schedule.departures - schedule.uncovered;
    return {
      identified: `${n(schedule.conflicts)} vehicle conflicts and ${n(schedule.uncovered)} uncovered departures in the original plan.`,
      predicts: prediction(workspace, findings, schedule),
      recommends: 'Generate the optimised bus plan, then roster crews to it.',
      impact: schedule.optimisedCovered !== null ? `${n(Math.max(0, schedule.optimisedCovered - covered))} more departures covered by the AI plan.` : 'Shown once the plan is generated.',
      href: `${depotHref(depotId)}/bus-scheduler`,
    };
  }
  if (!top) {
    return {
      identified: 'No open decision in this workspace for the context.',
      predicts: prediction(workspace, findings, schedule),
      recommends: 'Nothing to approve now; the engine re-checks on every cycle.',
      impact: '—',
      href: depotId ? `${depotHref(depotId)}/decisions` : DECISIONS_PATH,
    };
  }
  return {
    identified: top.title,
    predicts: prediction(workspace, findings, schedule),
    recommends: top.recommendation.title,
    impact: top.impact,
    href: decisionHref(top.id, depotId),
  };
}
