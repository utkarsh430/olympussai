import type { CanonicalLiveBus, CanonicalSchedule } from '@/models/canonical';

/**
 * Types for predictive scenario output.
 *
 * Vehicle identity, position, depot, route and schedule are live UPSRTC data.
 * The projected conditions are produced by local models seeded from the
 * vehicle's registration number. See docs/LIVE_VS_PREDICTED.md.
 */

export type ScenarioKind = 'bunching' | 'traffic' | 'breakdown' | 'demand' | 'communication';

export type AlertSeverity = 'info' | 'advisory' | 'warning' | 'critical';

export interface SimulatedPoint {
  latitude: number;
  longitude: number;
}

export interface SimulatedBusMarker extends SimulatedPoint {
  id: string;
  label: string;
  role: 'ahead' | 'selected' | 'behind' | 'rescue' | 'incident';
  headingDegrees: number;
  /** True only for the operator's genuinely selected live bus. */
  isRealBus: boolean;
}

export interface ScenarioAction {
  id: string;
  label: string;
  kind: 'accept' | 'modify' | 'reject' | 'monitor' | 'message' | 'call' | 'notify' | 'generate';
}

export interface ImpactMetric {
  label: string;
  before: string;
  after: string;
  /** Direction that represents improvement, for colour + screen-reader text. */
  improvement: 'up' | 'down';
  delta: string;
}

export interface TimelineEntry {
  at: string;
  label: string;
}

/** Common envelope every scenario template returns. */
export interface ScenarioBase {
  kind: ScenarioKind;
  /** Panel header for this analysis type. */
  simulationLabel: string;
  headline: string;
  severity: AlertSeverity;
  severityText: string;
  confidencePercent: number;
  observation: string;
  recommendation: string;
  expectedOutcome: string;
  affectedBuses: string[];
  suggestedDriverMessageEn: string;
  suggestedDriverMessageHi: string;
  actions: ScenarioAction[];
  markers: SimulatedBusMarker[];
  impact: ImpactMetric[];
  timeline: TimelineEntry[];
  seed: string;
}

export interface ScenarioContext {
  bus: CanonicalLiveBus;
  schedule: CanonicalSchedule | null;
  /** Presenter overrides from the Scenario Lab. */
  overrides?: ScenarioOverrides;
}

export interface ScenarioOverrides {
  bunchingRisk?: number;
  gapAheadMinutes?: number;
  gapBehindMinutes?: number;
  holdSeconds?: number;
  congestionSeverity?: 'moderate' | 'heavy' | 'severe';
  trafficDelayMinutes?: number;
  congestionDistanceKm?: number;
  alternativeSavingMinutes?: number;
  breakdownType?: string;
  passengerCount?: number;
  rescueCandidateCount?: number;
  responseTimeMinutes?: number;
  demandMultiplier?: number;
  peakWindow?: '06:00' | '08:00' | '10:00' | '13:00' | '17:00' | '20:00';
  festivalSurge?: boolean;
  reserveBuses?: number;
  messageLanguage?: 'en' | 'hi' | 'both';
  acknowledgementDelaySeconds?: number;
  callDurationSeconds?: number;
}

/**
 * Panel headers for each analysis type.
 *
 * Provenance is carried by the single PREDICTIVE marker on the alert feed and
 * the standing footer notice, rather than repeated on every card.
 */
export const SIMULATION_LABELS = {
  bunching: 'BUNCHING ANALYSIS',
  traffic: 'CORRIDOR ANALYSIS',
  breakdown: 'INCIDENT RESPONSE',
  demand: 'DEMAND ANALYSIS',
  communication: 'DRIVER COMMUNICATION',
} as const satisfies Record<ScenarioKind, string>;

/** Single consistent provenance marker used across the interface. */
export const PREDICTIVE_BADGE = 'PREDICTIVE';
