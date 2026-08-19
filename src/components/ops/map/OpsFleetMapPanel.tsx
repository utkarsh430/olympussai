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
  /**
   * Scoped vehicles from the page's own server-side read, or `null` when the
   * page deliberately did not take one.
   *
   * NULL IS "UNKNOWN", NEVER "NONE", and the distinction is load-bearing. A
   * statewide console does not seed: 9,170 vehicles do not belong in a page
   * payload, so it mounts with nothing and waits for the first poll. Passing
   * `[]` for that made the caption read "all depots · 0 vehicles" next to a
   * status band reporting 9,181 reporting vehicles - the console's own numbers
   * contradicting each other on arrival. An empty ARRAY still means a real,
   * measured empty fleet and is captioned as such.
   */
  vehicles: readonly OpsMapVehicle[] | null;
  /** Open bunching incidents available to draw. Ignored once a live poll has returned its own. */
  incidents?: readonly BunchingIncident[];
  /**
   * The one incident to DRAW, or null to draw none.
   *
   * ─── WHY THIS IS NOT "DRAW THEM ALL" ─────────────────────────────────────
   *
   * It used to be. Every open incident on the corridor became a dashed link
   * between its two buses, all painted at once, and on a statewide console
   * that produced a web of hundreds of lines across Uttar Pradesh - which is
   * what made a real detector failure invisible for as long as it did. Even
   * with the lifecycle fixed and only genuinely-live incidents arriving, "all
   * of them at once" is the wrong picture: an operator handles one incident at
   * a time, and a mark that is always on screen stops being read.
   *
   * So the list beside the map is the index, and the map answers ONE question:
   * where is the incident I just clicked. Nothing is hidden - the list is the
   * complete set, and it says how many there are.
   */
  selectedIncidentId?: string | null;
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
  /**
   * Grow to fill a flex parent rather than sitting at `minHeight`. For a
   * console whose page does not scroll and whose map is the centrepiece -
   * see OpsFleetMap's own note.
   */
  fill?: boolean;
  /**
   * Which basemap to paint under the fleet. Forwarded straight to OpsFleetMap,
   * whose own note owns the reasoning.
   *
   * A PASSTHROUGH rather than a `useTheme()` call inside this panel, and
   * deliberately: this component is shared with the control room, and
   * subscribing here would flip that console's basemap as a side effect of a
   * depot change. Each surface opts in from its own screen, which is the
   * contract OpsFleetMap set.
   */
  basemapTheme?: 'dark' | 'light';
}

export function OpsFleetMapPanel({
  vehicles,
  incidents = [],
  selectedIncidentId = null,
  scopeLabel,
  routeDirectionId,
  live = false,
  minHeight,
  fill = false,
  basemapTheme,
}: OpsFleetMapPanelProps) {
  const feed = useOpsMapFeed({ routeDirectionId, enabled: live });

  // A landed poll wins; until then the server-rendered seed is what is drawn,
  // and an unseeded panel draws nothing until one arrives. Memoised because
  // the `null` fallback would otherwise mint a fresh array on every render and
  // re-run the overlay build below with identical input.
  const currentVehicles = useMemo(
    () => feed.snapshot?.vehicles ?? vehicles ?? [],
    [feed.snapshot, vehicles],
  );
  const currentIncidents = feed.snapshot?.incidents ?? incidents;
  const currentScopeLabel = feed.snapshot?.scopeLabel ?? scopeLabel;

  // Whether the number in the caption is a measurement. False only in the
  // opening moment of an unseeded live panel, where drawing "0 vehicles" would
  // be stating a count nobody has taken.
  const vehicleCountKnown = feed.snapshot !== null || vehicles !== null;

  // Built over EVERY incident, then filtered down to the selected one for
  // drawing. Building over the selection alone would have been simpler and
  // would have silently dropped `unresolvedIncidentIds` - the count of
  // incidents whose buses this operator cannot see at all - which is a
  // statement about the corridor, not about the mark on the glass, and is
  // reported below regardless of what is selected.
  //
  // A mark carries its incident's own id (see buildIncidentOverlay), so
  // selecting is a filter on the built marks rather than a second build.
  const { overlay: resolvedOverlay, unresolvedIncidentIds } = useMemo(
    () => buildIncidentOverlay(currentIncidents, currentVehicles),
    [currentIncidents, currentVehicles],
  );

  const overlay = useMemo(
    () => ({
      ...resolvedOverlay,
      marks:
        selectedIncidentId === null
          ? []
          : resolvedOverlay.marks.filter((mark) => mark.id === selectedIncidentId),
    }),
    [resolvedOverlay, selectedIncidentId],
  );

  const overlays = useMemo(() => (overlay.marks.length > 0 ? [overlay] : []), [overlay]);

  // Frame the selected incident's own buses. Taken from the built mark rather
  // than from the incident's members, so the camera is fitted to exactly the
  // vehicles that were actually resolvable and drawn - never to a member this
  // operator cannot see, which would fly them out to an empty rectangle.
  const focusPoints = useMemo(
    () => overlay.marks.flatMap((mark) => mark.points),
    [overlay],
  );

  const controlServicePositions = currentVehicles.filter(
    (vehicle) => vehicle.positionSource === 'control-service',
  ).length;

  // No snapshot has landed AND the caller seeded nothing: the vehicle list is
  // unknown, not empty. A statewide console deliberately does not seed (9,170
  // vehicles do not belong in a page payload), so this is the normal opening
  // state there rather than an edge case.
  const awaitingFirstLoad = live && feed.loading && vehicles === null;

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      <OpsFleetMap
        vehicles={currentVehicles}
        overlays={overlays}
        focusPoints={focusPoints}
        basemapTheme={basemapTheme}
        caption={
          vehicleCountKnown
            ? `${currentScopeLabel} · ${currentVehicles.length} ${currentVehicles.length === 1 ? 'vehicle' : 'vehicles'}`
            : `${currentScopeLabel} · counting vehicles…`
        }
        minHeight={minHeight}
        fill={fill}
        awaitingFirstLoad={awaitingFirstLoad}
        label={`Fleet map, ${currentScopeLabel}`}
      />

      <div className="mt-2 shrink-0 space-y-1 text-xs text-ops-faint">
        {/* Provenance, per vehicle, aggregated. An operator judging a hold has
            to know whether the chevron is the operational estimate the alerts
            are computed from or the raw GPS fix. */}
        {controlServicePositions > 0 && (
          <p>
            {controlServicePositions} of {currentVehicles.length} positions from the control service; the rest are
            the raw GPS feed.
          </p>
        )}
        {/* What is DRAWN, versus what the corridor has. With one incident on
            the glass and possibly several in the list, a bare count of open
            incidents under the map would read as a count of the marks on it. */}
        {currentIncidents.length > 0 && (
          <p>
            {selectedIncidentId !== null && overlay.marks.length > 0
              ? `Showing 1 of ${currentIncidents.length} ${currentIncidents.length === 1 ? 'incident' : 'incidents'} on this corridor.`
              : `${currentIncidents.length} ${currentIncidents.length === 1 ? 'incident' : 'incidents'} on this corridor. Select one to see it on the map.`}
          </p>
        )}
        {/* Selected, but nothing to draw: the incident's buses are not on this
            operator's map. Saying nothing would look like a broken click. */}
        {selectedIncidentId !== null && overlay.marks.length === 0 && currentIncidents.length > 0 && (
          <p role="status" className="text-ops-warn">
            The selected incident&apos;s buses are not reporting a position on this map, so it cannot be drawn.
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
