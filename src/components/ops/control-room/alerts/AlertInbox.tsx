'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  OpsAlert,
  OpsButton,
  OpsEmptyState,
  OpsGrid,
  OpsPanel,
  OpsStack,
  OpsStat,
  OpsStatStrip,
  OpsToolbar,
} from '@/components/ops/ui';
import { INCIDENT_SEVERITY_RANK, type AlertFeed, type BunchingAlert, type IncidentSeverity } from '@/models/control';
import { incidentSeverityLabel } from '@/lib/ops/vocabulary';
import { AlertRow } from './AlertRow';
import { AlertSolutionPanel } from './AlertSolutionPanel';

/** How often the list re-reads. Matches the control service's own sweep cadence. */
const REFRESH_MS = 30_000;

/** The order the counts read in, worst first — the same order the list sorts in. */
const SEVERITY_ORDER: IncidentSeverity[] = ['severe', 'bunched', 'warning', 'predicted'];

type FeedResponse = AlertFeed & { stale?: boolean; ageMs?: number };

/**
 * Every bus pair on the network that is bunched, or heading that way.
 *
 * ─── WHAT THIS SURFACE IS FOR ────────────────────────────────────────────
 *
 * Bunching detection has run on a timer since the core data model, across
 * every eligible corridor. Until this page the only way to see what it found
 * was the console's per-corridor panel, which shows an operator what is wrong
 * with the corridor they already chose. Across ~1,020 active route-directions
 * that made noticing a matter of luck: an incident reached a human only if
 * somebody happened to be looking at the right corridor at the right time.
 *
 * This is the whole population in one list, and the list is ordered by what to
 * do next rather than by when it happened — see `listOpenAlerts` in the
 * control service, where the ordering lives. An operator reads this top-down
 * and stops partway, so the order IS the triage.
 *
 * ─── AND WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────
 *
 * Solve anything on its own. Opening an alert and asking for a solution is a
 * separate, explicit act, because a solve carries a freshness verdict that
 * expires in 90 seconds and solving the network on every render would produce
 * a page of proposals that had all quietly lapsed. See AlertSolutionPanel.
 */
export function AlertInbox({ initialFeed }: { initialFeed: FeedResponse | null }) {
  const [feed, setFeed] = useState<FeedResponse | null>(initialFeed);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | 'all'>('all');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/ops/control-room/alerts', { cache: 'no-store' });
      const data = (await response.json().catch(() => null)) as
        | FeedResponse
        | { error: { code: string; message: string } }
        | null;
      if (!response.ok || !data || 'error' in data) {
        // The previous feed is KEPT. An alert list that blanks itself on a
        // failed refresh is indistinguishable from an all-clear, and this is
        // the one surface where those two must never look alike.
        setError(
          data && 'error' in data ? data.error.message : 'The alert feed could not be refreshed.',
        );
        return;
      }
      setFeed(data);
      setError(null);
    } catch {
      setError('The alert feed could not be refreshed.');
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const alerts = useMemo(() => {
    const all = feed?.alerts ?? [];
    if (severityFilter === 'all') return all;
    return all.filter((a) => a.severity === severityFilter);
  }, [feed, severityFilter]);

  const selected: BunchingAlert | null = useMemo(
    () => alerts.find((a) => a.id === selectedId) ?? null,
    [alerts, selectedId],
  );

  const counts = feed?.countsBySeverity ?? {};

  return (
    <OpsStack>
      {feed?.stale ? (
        <OpsAlert tone="warning" title="This list is not live">
          The control service did not answer, so this is the last feed that arrived
          {typeof feed.ageMs === 'number' ? ` (${Math.round(feed.ageMs / 1000)}s ago)` : ''}. It is
          shown rather than emptied because an empty list would read as an all-clear.
        </OpsAlert>
      ) : null}

      {error ? (
        <OpsAlert tone="warning" title="The last refresh failed">
          {error} The alerts below are from the last successful read.
        </OpsAlert>
      ) : null}

      <OpsStatStrip>
        {SEVERITY_ORDER.map((severity) => (
          <OpsStat
            key={severity}
            label={incidentSeverityLabel(severity)}
            value={String(counts[severity] ?? 0)}
          />
        ))}
        <OpsStat label="Open in total" value={String(feed?.totalOpenCount ?? 0)} />
      </OpsStatStrip>

      <OpsToolbar>
        <OpsButton
          variant={severityFilter === 'all' ? 'primary' : 'quiet'}
          onClick={() => setSeverityFilter('all')}
        >
          All
        </OpsButton>
        {SEVERITY_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((severity) => (
          <OpsButton
            key={severity}
            variant={severityFilter === severity ? 'primary' : 'quiet'}
            onClick={() => setSeverityFilter(severity)}
          >
            {incidentSeverityLabel(severity)}
          </OpsButton>
        ))}
        <OpsButton onClick={() => void refresh()}>Refresh</OpsButton>
      </OpsToolbar>

      <OpsGrid columns={2}>
        <OpsPanel title={`Alerts${alerts.length > 0 ? ` (${alerts.length})` : ''}`}>
          {feed === null ? (
            <OpsEmptyState>
              The alert feed has not been read yet. This is not an all-clear.
            </OpsEmptyState>
          ) : alerts.length === 0 ? (
            <OpsEmptyState>
              {severityFilter === 'all'
                ? 'No bunching alerts are open on any corridor the detector runs on. Corridors without a planned headway are not checked at all, so this is an all-clear only for the ones that are.'
                : `No ${incidentSeverityLabel(severityFilter).toLowerCase()} alerts are open right now.`}
            </OpsEmptyState>
          ) : (
            <ul className="space-y-2">
              {[...alerts]
                // The server already sorts. This re-sort is a guard against a
                // filtered subset arriving in a different order, and uses the
                // same ladder the badge and the service do.
                .sort(
                  (a, b) =>
                    INCIDENT_SEVERITY_RANK[b.severity] - INCIDENT_SEVERITY_RANK[a.severity] ||
                    (a.secondsToBunching ?? Number.POSITIVE_INFINITY) -
                      (b.secondsToBunching ?? Number.POSITIVE_INFINITY),
                )
                .map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    selected={alert.id === selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
            </ul>
          )}
        </OpsPanel>

        {selected ? (
          <AlertSolutionPanel alert={selected} />
        ) : (
          <OpsPanel title="What to do about it">
            <OpsEmptyState>
              Choose an alert to see what the engine would do about it.
            </OpsEmptyState>
          </OpsPanel>
        )}
      </OpsGrid>
    </OpsStack>
  );
}
