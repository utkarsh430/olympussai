import { z } from 'zod';
import type { DepotFeedEnvelope } from '../api';
import { isValidRegistration } from '../ids';
import type { DetectionSummary, Incident, IncidentConfidence, IncidentOrigin, IncidentSignal, ReplacementKind, ReplacementPlan } from './types';

export interface IncidentView {
  readonly incident: Incident;
  readonly plan: ReplacementPlan;
}

export interface IncidentsResponse extends DepotFeedEnvelope {
  readonly depotId: string;
  readonly depotName: string;
  readonly operatingDate: string;
  readonly incidents: readonly IncidentView[];
  readonly detection: DetectionSummary;
}

export interface DeclaredIncidentResponse extends DepotFeedEnvelope {
  readonly depotId: string;
  readonly depotName: string;
  readonly operatingDate: string;
  readonly incident: IncidentView;
}

export interface IncidentRollupRow {
  readonly depotId: string;
  readonly depotName: string;
  readonly registrationNumber: string;
  readonly routeName: string | null;
  readonly origin: IncidentOrigin;
  readonly confidence: IncidentConfidence;
  readonly signals: readonly IncidentSignal[];
  readonly passengersAboard: number | null;
  readonly recommendedKind: ReplacementKind | null;
  readonly recommendedDepotName: string | null;
  readonly arrivalMinutes: number | null;
  readonly planState: 'ready' | 'pending';
}

export interface IncidentRollupResponse extends DepotFeedEnvelope {
  readonly operatingDate: string;
  readonly rows: readonly IncidentRollupRow[];
  readonly totals: Readonly<Record<IncidentConfidence, number>> & { readonly suspected: number };
  readonly planned: number;
  readonly pending: number;
}

const MAX_REGISTRATION = 24;

/** The declare body, strict: the registration and nothing else. */
export const declareIncidentSchema = z
  .object({ registrationNumber: z.string().min(1).max(MAX_REGISTRATION).refine(isValidRegistration) })
  .strict();
