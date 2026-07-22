import type { ScenarioKind } from '@/lib/demo-scenarios/types';

export interface PitchStep {
  id: string;
  caption: string;
  detail: string;
  durationMs: number;
  /** Side effect the runner applies when the step begins. */
  action:
    | { type: 'none' }
    | { type: 'select-bus' }
    | { type: 'open-schedule' }
    | { type: 'scenario'; kind: Exclude<ScenarioKind, 'communication'> }
    | { type: 'message' }
    | { type: 'call' }
    | { type: 'end-call' }
    | { type: 'impact' };
}

/**
 * DIRECTOR PITCH MODE — approximately 105 seconds end to end.
 * No audio is played and nothing autoplays sound.
 */
export const PITCH_STEPS: PitchStep[] = [
  {
    id: 'fleet',
    caption: 'Live visibility across the UPSRTC fleet',
    detail:
      'Every marker is a real UPSRTC vehicle, streaming from the live GPS endpoint and refreshed every 15 seconds.',
    durationMs: 7000,
    action: { type: 'none' },
  },
  {
    id: 'scale',
    caption: 'One control room. Network-wide intelligence.',
    detail:
      'Thousands of live vehicles across every depot, normalised into a single operational picture.',
    durationMs: 6500,
    action: { type: 'none' },
  },
  {
    id: 'select',
    caption: 'From monitoring to predictive intervention',
    detail: 'The operator selects a single live service to inspect in detail.',
    durationMs: 6000,
    action: { type: 'select-bus' },
  },
  {
    id: 'schedule',
    caption: 'Real schedule, retrieved on demand',
    detail:
      'The UPSRTC schedule endpoint is queried only for the selected vehicle — never for the whole fleet.',
    durationMs: 7000,
    action: { type: 'open-schedule' },
  },
  {
    id: 'bunching',
    caption: 'AI identifies the risk',
    detail:
      'A bunching projection shows two buses converging on the same passenger stop.',
    durationMs: 9000,
    action: { type: 'scenario', kind: 'bunching' },
  },
  {
    id: 'hold',
    caption: 'Authorized dispatchers remain in control',
    detail:
      'The copilot recommends a short hold. It cannot execute anything without dispatcher approval.',
    durationMs: 7000,
    action: { type: 'none' },
  },
  {
    id: 'message',
    caption: 'Real-time driver communication',
    detail:
      'The approved instruction is prepared in English and Hindi for dispatcher review. No driver is contacted.',
    durationMs: 8000,
    action: { type: 'message' },
  },
  {
    id: 'traffic',
    caption: 'Congestion predicted before it is reached',
    detail:
      'A projected congestion corridor and an alternative route are compared side by side.',
    durationMs: 9000,
    action: { type: 'scenario', kind: 'traffic' },
  },
  {
    id: 'breakdown',
    caption: 'Rapid breakdown coordination',
    detail:
      'A critical fault projection triggers assistance ranking, response timing and depot coordination.',
    durationMs: 9000,
    action: { type: 'scenario', kind: 'breakdown' },
  },
  {
    id: 'demand',
    caption: 'Demand-led fleet distribution',
    detail:
      'Projected peak-hour demand exposes route deficits and a rebalancing plan across the corridor.',
    durationMs: 9000,
    action: { type: 'scenario', kind: 'demand' },
  },
  {
    id: 'voip',
    caption: 'Voice contact when it matters',
    detail:
      'A control-room call with structured speaking points and an automatic summary.',
    durationMs: 8000,
    action: { type: 'call' },
  },
  {
    id: 'impact',
    caption: 'The future of intelligent bus operations',
    detail:
      'Projected impact across bunching, waiting time, breakdown response and utilization.',
    durationMs: 11000,
    action: { type: 'impact' },
  },
];

export const TOTAL_PITCH_MS = PITCH_STEPS.reduce((sum, step) => sum + step.durationMs, 0);
