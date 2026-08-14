'use client';

import { useMemo } from 'react';
import { OpsFleetMap } from './OpsFleetMap';
import { useOpsMapFeed } from './useOpsMapFeed';
import { buildIncidentOverlay, type OpsMapVehicle } from '@/lib/ops/mapVehicles';
import type { BunchingIncident } from '@/models/control';

/**
 * The drop-in ops map: the renderer, the bunching overlay, live refresh, and
 * an honest status line, wired together.
 *
 * A Server Component page passes the scoped vehicles it already fetched, so
 * the map is populated on first paint with no request of its own. Set `live`
 * and it then refreshes itself from the scoped endpoint, replacing that seed.
 * Both paths carry the same boundary: the seed was narrowed by
 * getOpsMapSnapshot / toOpsMapVehicles server-side, and the endpoint narrows
 * by the caller's own ops_users row.
 *
 * This is the component to mount. OpsFleetMap underneath it is the plain
 * renderer, for a surface that needs its own data flow or a different overlay.
 */

export interface OpsFleetMapPanelProps {
  /** Scoped vehicles from the page's own server-side read. */
  vehicles: readonly OpsMapVehicle[];
  /** Open bunching incidents to draw. Ignored once a live poll has returned its own. */
  incidents?: readonly BunchingIncident[];
  /** The boundary in force, e.g. `Bareilly` or `all depots`. Shown in the caption. */
  scopeLabel: string;
  /**
   * Corridor for control-service positions and incidents on the live poll.
   * NOT a scoping parameter - it selects which corridor to enrich, and cannot
   * widen what the caller may see.
   */
  routeDirectionId?: string;
  /** Refresh from the scoped endpoint on an interval. Off by default: a page that renders once should not start a poll behind the operator's back. */
  live?: boolean;
  /** Frame minimum height, passed through to the map frame. */
  minHeight?: string;
}

export function OpsFleetMapPanel({
  vehicles,
  incidents = [],
  scopeLabel,
  routeDirectionId,
  live = false,
  minHeight,
}: OpsFleetMapPanelProps) {
  const feed = useOpsMapFeed({ routeDirectionId, enabled: live });

  // A landed poll wins; until then the server-rendered seed is what is drawn.
  const currentVehicles = feed.snapshot?.vehicles ?? vehicles;
  const currentIncidents = feed.snapshot?.incidents ?? incidents;
  const currentScopeLabel = feed.snapshot?.scopeLabel ?? scopeLabel;

  const { overlay, unresolvedIncidentIds } = useMemo(
    () => buildIncidentOverlay(currentIncidents, currentVehicles),
    [currentIncidents, currentVehicles],
  );

  const overlays = useMemo(() => (overlay.marks.length > 0 ? [overlay] : []), [overlay]);

  const controlServicePositions = currentVehicles.filter(
    (vehicle) => vehicle.positionSource === 'control-service',
  ).length;

  return (
    <div>
      <OpsFleetMap
        vehicles={currentVehicles}
        overlays={overlays}
        caption={`${currentScopeLabel} · ${currentVehicles.length} ${currentVehicles.length === 1 ? 'vehicle' : 'vehicles'}`}
        minHeight={minHeight}
        label={`Fleet map, ${currentScopeLabel}`}
      />

      <div className="mt-2 space-y-1 text-xs text-ops-faint">
        {/* Provenance, per vehicle, aggregated. An operator judging a hold has
            to know whether the chevron is the operational estimate the alerts
            are computed from or the raw GPS fix. */}
        {controlServicePositions > 0 && (
          <p>
            {controlServicePositions} of {currentVehicles.length} positions from the control service; the rest are
            the raw GPS feed.
          </p>
        )}
        {overlay.marks.length > 0 && (
          <p>
            {overlay.marks.length} bunching {overlay.marks.length === 1 ? 'incident' : 'incidents'} drawn.
          </p>
        )}
        {unresolvedIncidentIds.length > 0 && (
          <p>
            {unresolvedIncidentIds.length} further{' '}
            {unresolvedIncidentIds.length === 1 ? 'incident involves vehicles' : 'incidents involve vehicles'} outside
            this view and cannot be placed on the map.
          </p>
        )}
        {feed.snapshot?.controlServiceError !== null && feed.snapshot?.controlServiceError !== undefined && (
          <p role="status" className="text-ops-danger">
            The control service could not be reached, so positions are the raw GPS feed and no bunching incidents are
            shown.
          </p>
        )}
        {feed.error !== null && (
          <p role="status" className="text-ops-danger">
            {feed.error}
          </p>
        )}
      </div>
    </div>
  );
}
