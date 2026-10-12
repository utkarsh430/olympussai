'use client';

import { useCallback, useRef, useState } from 'react';
import { isValidDepotId } from '@/lib/depot/ids';
import type { DeclaredIncidentResponse, IncidentRollupResponse, IncidentsResponse, IncidentView } from '@/lib/depot/incident/api';
import { DEFAULT_POLL_INTERVAL_MS, usePolledJson, type PolledState } from '@/hooks/usePolledJson';
import { INVALID_DEPOT_ID_MESSAGE } from '@/hooks/useDepotDetail';
import { DEPOT_NOT_FOUND_MESSAGE } from '@/lib/depot/scopeState';

const STATUS_MESSAGES: Readonly<Record<number, string>> = { 404: DEPOT_NOT_FOUND_MESSAGE, 400: INVALID_DEPOT_ID_MESSAGE };

/** Polls one depot's suspected incidents. */
export function useDepotIncidents(depotId: string | null): PolledState<IncidentsResponse> {
  const url = isValidDepotId(depotId) ? `/api/upsrtc/depot/${encodeURIComponent(depotId)}/incidents` : null;
  return usePolledJson<IncidentsResponse>(url, { statusMessages: STATUS_MESSAGES });
}

export interface DeclareIncident {
  readonly declared: readonly IncidentView[];
  readonly error: string | null;
  readonly busy: boolean;
  readonly declare: (registration: string) => void;
  readonly withdraw: (registration: string) => void;
}

const DECLARE_MESSAGES: Readonly<Record<number, string>> = {
  404: 'That bus is not in this depot.',
  400: 'That registration could not be read.',
  429: 'Too many declarations in a minute; try again shortly.',
};

/** Declares a bus broken down and keeps its plan on the page; the browser trail records the declaration. */
export function useDeclareIncident(depotId: string | null): DeclareIncident {
  const [declared, setDeclared] = useState<readonly IncidentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const declare = useCallback(
    (registration: string) => {
      if (!isValidDepotId(depotId)) return;
      const ticket = latest.current + 1;
      latest.current = ticket;
      setBusy(true);
      setError(null);
      fetch(`/api/upsrtc/depot/${encodeURIComponent(depotId)}/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationNumber: registration.trim() }),
        credentials: 'same-origin',
      })
        .then(async (res) => {
          if (ticket !== latest.current) return;
          if (!res.ok) {
            setError(DECLARE_MESSAGES[res.status] ?? 'The declaration did not answer.');
            return;
          }
          const body = (await res.json()) as DeclaredIncidentResponse;
          setDeclared((held) => [body.incident, ...held.filter((v) => v.incident.registrationNumber !== body.incident.incident.registrationNumber)]);
        })
        .catch(() => {
          if (ticket === latest.current) setError('The declaration did not answer.');
        })
        .finally(() => {
          if (ticket === latest.current) setBusy(false);
        });
    },
    [depotId],
  );
  const withdraw = useCallback((registration: string) => {
    setDeclared((held) => held.filter((v) => v.incident.registrationNumber !== registration));
  }, []);
  return { declared, error, busy, declare, withdraw };
}

const FILLING_INTERVAL_MS = 4_000;

/** Polls Headquarters' incident roll-up, faster while depots are still being planned. */
export function useIncidentRollup(): PolledState<IncidentRollupResponse> {
  const [filling, setFilling] = useState(false);
  const state = usePolledJson<IncidentRollupResponse>('/api/upsrtc/depot/incidents', { intervalMs: filling ? FILLING_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS });
  const pending = state.data?.pending ?? 0;
  if (filling !== pending > 0) setFilling(pending > 0);
  return state;
}
