import { SeededRandom } from '@/lib/simulation/seededRandom';
import { SIMULATION_LABELS, type ScenarioContext, type ScenarioKind } from './types';

/**
 * Driver communication workflow.
 *
 * NO real driver is contacted. NO SMS, push or VoIP provider is integrated.
 * The acknowledgement and call audio are entirely local.
 */

export type CommunicationState =
  | 'suggestion-generated'
  | 'awaiting-review'
  | 'approved'
  | 'message-prepared'
  | 'message-sent'
  | 'driver-acknowledged'
  | 'monitoring-outcome';

export const COMMUNICATION_FLOW: CommunicationState[] = [
  'suggestion-generated',
  'awaiting-review',
  'approved',
  'message-prepared',
  'message-sent',
  'driver-acknowledged',
  'monitoring-outcome',
];

export const COMMUNICATION_STATE_LABELS: Record<CommunicationState, string> = {
  'suggestion-generated': 'AI Suggestion Generated',
  'awaiting-review': 'Awaiting Dispatcher Review',
  approved: 'Approved',
  'message-prepared': 'Message Prepared',
  'message-sent': 'Message Sent',
  'driver-acknowledged': 'Driver Acknowledged',
  'monitoring-outcome': 'Monitoring Outcome',
};

/** Valid forward transitions. Guards the workflow against illegal jumps. */
export function nextCommunicationState(current: CommunicationState): CommunicationState | null {
  const index = COMMUNICATION_FLOW.indexOf(current);
  if (index === -1 || index === COMMUNICATION_FLOW.length - 1) return null;
  return COMMUNICATION_FLOW[index + 1] ?? null;
}

export function canTransition(from: CommunicationState, to: CommunicationState): boolean {
  const fromIndex = COMMUNICATION_FLOW.indexOf(from);
  const toIndex = COMMUNICATION_FLOW.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex === fromIndex + 1;
}

export interface DriverMessageDraft {
  registrationNumber: string;
  scenarioKind: ScenarioKind;
  scenarioLabel: string;
  suggestedAction: string;
  englishMessage: string;
  hindiMessage: string;
  location: string;
  expiresAt: string;
  approvalWarning: string;
  demoBanner: string;
}

export interface VoipCallPlan {
  registrationNumber: string;
  driverPlaceholder: string;
  incidentSummary: string;
  speakingPoints: string[];
  durationSeconds: number;
  acknowledgementDelaySeconds: number;
  callSummaryTemplate: string;
  demoBanner: string;
}

export interface CommunicationScenario {
  kind: 'communication';
  simulationLabel: string;
  message: DriverMessageDraft;
  call: VoipCallPlan;
  seed: string;
}

export function buildCommunicationScenario(
  context: ScenarioContext,
  options: {
    scenarioKind: ScenarioKind;
    scenarioLabel: string;
    suggestedAction: string;
    englishMessage: string;
    hindiMessage: string;
  },
): CommunicationScenario {
  const { bus, overrides } = context;
  const random = new SeededRandom(`communication:${bus.registrationNumber}`);

  const expiry = new Date(Date.now() + 15 * 60_000);

  const location =
    bus.routeName ??
    bus.depotName ??
    `${bus.latitude.toFixed(4)}, ${bus.longitude.toFixed(4)}`;

  return {
    kind: 'communication',
    simulationLabel: SIMULATION_LABELS.communication,
    message: {
      registrationNumber: bus.registrationNumber,
      scenarioKind: options.scenarioKind,
      scenarioLabel: options.scenarioLabel,
      suggestedAction: options.suggestedAction,
      englishMessage: options.englishMessage,
      hindiMessage: options.hindiMessage,
      location: `${location} · ${bus.latitude.toFixed(4)}, ${bus.longitude.toFixed(4)}`,
      expiresAt: expiry.toISOString(),
      approvalWarning:
        'This instruction requires authorized dispatcher approval before transmission. No operational instruction is executed automatically.',
      demoBanner: 'NO DRIVER IS CONTACTED FROM THIS PROTOTYPE',
    },
    call: {
      registrationNumber: bus.registrationNumber,
      driverPlaceholder: 'Assigned Driver (placeholder)',
      incidentSummary: options.suggestedAction,
      speakingPoints: [
        'Confirm current location and passenger status.',
        'Relay the approved control-room instruction clearly.',
        'Confirm the driver has understood and can comply safely.',
        'Record the acknowledgement time for the operations log.',
      ],
      durationSeconds: overrides?.callDurationSeconds ?? random.int(38, 72),
      acknowledgementDelaySeconds: overrides?.acknowledgementDelaySeconds ?? random.int(3, 7),
      callSummaryTemplate:
        'Control room contacted the assigned driver of {reg}. The approved instruction was relayed and acknowledged. Outcome monitoring remains active for this service.',
      demoBanner: 'NO EXTERNAL CALL IS PLACED FROM THIS PROTOTYPE',
    },
    seed: `communication:${bus.registrationNumber}`,
  };
}
