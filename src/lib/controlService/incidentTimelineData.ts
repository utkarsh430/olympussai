import 'server-only';

/**
 * Server-only fetch of a single incident's control-service state, for the
 * incident timeline's "state" stage (this ticket's AC3: "Incident timeline
 * reconstructs state -> explanation -> decision -> ack -> outcome"). Uses
 * GET /v1/incidents/:id (added alongside this ticket -- see
 * control-service/src/routes/headway.ts -- specifically because the
 * existing GET /v1/incidents list excludes closed incidents, and a
 * timeline must still be able to show a *closed* incident's final state).
 */
import { ControlServiceConfigError, ControlServiceRequestError, fetchControlService } from './client';
import { incidentResponseSchema, type BunchingIncident } from '@/models/control';

export interface IncidentStateResult {
  incident: BunchingIncident | null;
  /** Non-null whenever the fetch itself failed (config/network/unexpected status) — distinct from a clean 404 (incident/null with no error), so the UI can tell "not found" apart from "couldn't check". */
  error: string | null;
}

export async function getIncidentState(incidentId: string): Promise<IncidentStateResult> {
  try {
    const raw = await fetchControlService(`/v1/incidents/${encodeURIComponent(incidentId)}`);
    const { incident } = incidentResponseSchema.parse(raw);
    return { incident, error: null };
  } catch (cause) {
    if (cause instanceof ControlServiceRequestError && cause.status === 404) {
      return { incident: null, error: null };
    }
    const message =
      cause instanceof ControlServiceConfigError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : 'Unknown control service error';
    return { incident: null, error: message };
  }
}
