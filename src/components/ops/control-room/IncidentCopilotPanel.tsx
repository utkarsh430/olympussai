'use client';

import { useState } from 'react';
import type { BunchingIncident } from '@/models/control';
import type { CopilotSourceCitation } from '@/models/copilot';
import { IncidentSeverityBadge } from './IncidentSeverityBadge';

interface ExplanationState {
  status: 'idle' | 'loading' | 'error' | 'ready';
  narrative?: string;
  citations?: CopilotSourceCitation[];
  error?: string;
}

/**
 * Per-incident "Explain" action: calls POST
 * /api/ops/control-room/copilot/explain and renders the grounded narrative
 * plus its citations inline under the incident card (ticket AC
 * "Explanations grounded in stored incident evidence" — the citation list
 * rendered here is exactly what the server attached to the response, never
 * something this component infers).
 */
export function IncidentCopilotPanel({ incidents }: { incidents: BunchingIncident[] }) {
  const [explanations, setExplanations] = useState<Record<string, ExplanationState>>({});

  async function explain(incidentId: string, routeDirectionId: string) {
    setExplanations((prev) => ({ ...prev, [incidentId]: { status: 'loading' } }));
    try {
      const response = await fetch('/api/ops/control-room/copilot/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId, routeDirectionId }),
      });
      const data = (await response.json().catch(() => null)) as
        | { narrative: string; citations: CopilotSourceCitation[] }
        | { error: { message: string } }
        | null;

      if (!response.ok || !data || 'error' in data) {
        setExplanations((prev) => ({
          ...prev,
          [incidentId]: {
            status: 'error',
            error:
              (data && 'error' in data && data.error.message) ||
              'Could not generate an explanation.',
          },
        }));
        return;
      }

      setExplanations((prev) => ({
        ...prev,
        [incidentId]: { status: 'ready', narrative: data.narrative, citations: data.citations },
      }));
    } catch {
      setExplanations((prev) => ({
        ...prev,
        [incidentId]: { status: 'error', error: 'Something went wrong. Please try again.' },
      }));
    }
  }

  if (incidents.length === 0) {
    return (
      <p className="ops-well px-4 py-3 text-sm text-muted-foreground">
        No active bunching incidents to explain right now.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {incidents.map((incident) => {
        const state = explanations[incident.id] ?? { status: 'idle' as const };
        return (
          <li key={incident.id} className="ops-well px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <IncidentSeverityBadge severity={incident.severity} />
                <span className="font-mono text-xs text-subtle">{incident.id}</span>
              </div>
              <button
                type="button"
                onClick={() => explain(incident.id, incident.routeDirectionId)}
                disabled={state.status === 'loading'}
                data-testid={`copilot-explain-${incident.id}`}
                className="ops-button-primary"
              >
                {state.status === 'loading' ? 'Explaining…' : 'Explain'}
              </button>
            </div>

            {state.status === 'error' && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {state.error}
              </p>
            )}

            {state.status === 'ready' && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="ops-eyebrow mb-1">AI explanation</p>
                <p className="whitespace-pre-wrap text-sm text-foreground">{state.narrative}</p>
                {state.citations && state.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {state.citations.map((citation) => (
                      <span
                        key={`${citation.recordType}-${citation.recordId}`}
                        title={citation.summary}
                        className="rounded border border-input px-1.5 py-0.5 font-mono text-[9px] text-subtle"
                      >
                        {citation.recordType}:{citation.recordId.slice(0, 8)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
