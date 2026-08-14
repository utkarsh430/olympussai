'use client';

import { useMemo } from 'react';
import { OpsFleetMap } from '@/components/ops/map/OpsFleetMap';
import { buildRouteStopOverlay, cameraFitPoints } from '@/lib/ops/driverRouteOverlay';
import { fixQuality } from '@/lib/ops/driverJourneyView';
import type { JourneyStop } from '@/lib/ops/driverJourney';
import type { OpsMapVehicle } from '@/lib/ops/mapVehicles';

/**
 * The driver's own bus and the stops ahead of it, on the console's one map.
 *
 * This is a MOUNT, not a map. Everything below is props and a pure overlay
 * builder handed to `OpsFleetMap`, which is the same component the control
 * room and depot dashboards draw 9,100 vehicles with. There is deliberately no
 * second Google Maps instance in this product: two maps is how one surface
 * ends up colouring a stale fix differently from another, and how a camera
 * bug gets fixed in one place and not the other.
 *
 * What is different here is only the SHAPE of the data - one vehicle instead of
 * thousands, and six annotated stops instead of an incident overlay - which is
 * exactly what `overlays` and `fitPoints` are for.
 */
export function DriverRouteMap({
  vehicleId,
  position,
  observedAt,
  stateAgeSeconds,
  routeName,
  stops,
}: {
  vehicleId: string;
  /** The fix the prediction was computed from. Null when the response carried none. */
  position: { latitude: number; longitude: number } | null;
  observedAt: string;
  stateAgeSeconds: number;
  routeName: string | null;
  stops: readonly JourneyStop[];
}) {
  const { overlay, undrawnStopCount } = useMemo(() => buildRouteStopOverlay(stops), [stops]);

  // One vehicle: the driver's own. Built from the SAME response the stops came
  // from, so the bus and the distances to those stops can never be measured
  // from two different fixes.
  const vehicles = useMemo<OpsMapVehicle[]>(() => {
    if (!position) return [];
    return [
      {
        id: vehicleId,
        registrationNumber: vehicleId,
        latitude: position.latitude,
        longitude: position.longitude,
        // The feed carries a heading, this response does not, and inventing
        // one would point the chevron down a road the bus may not be on. Null
        // is drawn as an unoriented mark by the renderer.
        headingDegrees: null,
        dataQuality: fixQuality(stateAgeSeconds),
        depotName: null,
        routeName,
        speedKmph: null,
        stopState: null,
        routeDirectionId: null,
        positionSource: 'control-service',
        observedAt,
      },
    ];
  }, [vehicleId, position, stateAgeSeconds, routeName, observedAt]);

  const fitPoints = useMemo(() => cameraFitPoints(position, stops), [position, stops]);

  return (
    <OpsFleetMap
      vehicles={vehicles}
      overlays={[overlay]}
      fitPoints={fitPoints}
      label="Your route and upcoming stops"
      showFleetLegend={false}
      // Tall enough to show a stretch of corridor on a phone held upright,
      // short enough that the stop list below is reachable without a long
      // scroll. OpsMapFrame's definite-height rule is what makes this work
      // inside a scrolling page rather than an OpsShell variant="full".
      minHeight="18rem"
      caption={
        undrawnStopCount > 0
          ? `${stops.length - undrawnStopCount} of ${stops.length} upcoming stops have a surveyed position`
          : position
            ? undefined
            : 'Your last position could not be placed on the map - stops shown from the route survey'
      }
    />
  );
}
