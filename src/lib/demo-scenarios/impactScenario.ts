/**
 * Projected operational impact.
 *
 * These are modelled estimates, NOT measured results and NOT derived from
 * UPSRTC operational history. Actual impact must be validated through an
 * authorized UPSRTC pilot.
 */

export interface ImpactKpi {
  id: string;
  label: string;
  /** Signed percentage change, e.g. -32 or +17. */
  changePercent: number;
  direction: 'reduction' | 'increase';
  /** Screen-reader-friendly restatement. */
  description: string;
  baseline: string;
  projected: string;
}

export const IMPACT_DISCLAIMER =
  'Modelled estimates. Actual impact must be validated through an authorized UPSRTC pilot.';

export const IMPACT_LABEL = 'PROJECTED';

export const FUTURE_IMPACT_KPIS: ImpactKpi[] = [
  {
    id: 'bunching',
    label: 'Bunching incidents',
    changePercent: -85,
    direction: 'reduction',
    description: 'Projected reduction in bus bunching incidents across managed corridors.',
    baseline: '100 incidents / week',
    projected: '15 incidents / week',
  },
  {
    id: 'waiting',
    label: 'Average passenger wait',
    changePercent: -73,
    direction: 'reduction',
    description: 'Projected reduction in average passenger waiting time at monitored stops.',
    baseline: '21 min',
    projected: '6 min',
  },
  {
    id: 'breakdown',
    label: 'Breakdown response time',
    changePercent: -58,
    direction: 'reduction',
    description: 'Projected reduction in time from breakdown detection to assistance dispatch.',
    baseline: '42 min',
    projected: '18 min',
  },
  {
    id: 'utilization',
    label: 'Fleet utilization',
    changePercent: 15,
    direction: 'increase',
    description: 'Projected improvement in productive fleet utilization.',
    baseline: '71%',
    projected: '86%',
  },
  {
    id: 'otp',
    label: 'On-time performance',
    changePercent: 31,
    direction: 'increase',
    description: 'Projected improvement in scheduled on-time performance.',
    baseline: '64%',
    projected: '95%',
  },
  {
    id: 'dispatcher',
    label: 'Dispatcher response',
    changePercent: -44,
    direction: 'reduction',
    description: 'Projected reduction in dispatcher decision-to-action time.',
    baseline: '9 min',
    projected: '5 min',
  },
  {
    id: 'empty-km',
    label: 'Empty kilometres',
    changePercent: -19,
    direction: 'reduction',
    description: 'Projected reduction in non-revenue kilometres operated.',
    baseline: '12.4%',
    projected: '10.0%',
  },
  {
    id: 'experience',
    label: 'Passenger experience index',
    changePercent: 26,
    direction: 'increase',
    description: 'Projected improvement in a composite passenger-experience index.',
    baseline: '3.1 / 5',
    projected: '3.9 / 5',
  },
];

export interface ImpactNarrative {
  headline: string;
  body: string;
}

export const IMPACT_NARRATIVES: ImpactNarrative[] = [
  {
    headline: 'From monitoring to intervention',
    body: 'Today the control room can see where every bus is. The Copilot is designed to also explain what is about to go wrong and what to do about it — while the dispatcher retains authority over every action.',
  },
  {
    headline: 'Every recommendation is reviewable',
    body: 'Each suggestion carries its observation, its confidence and its expected outcome. Dispatchers accept, modify, reject or monitor. Nothing is executed automatically.',
  },
  {
    headline: 'Designed for a staged pilot',
    body: 'A single depot and one high-frequency corridor are sufficient to validate the bunching and communication workflows before any network-wide rollout.',
  },
];
