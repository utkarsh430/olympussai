// Leader-follower ordering per route-direction (AC: "Leader-follower order
// correct incl. terminal wrap-around and shared trunk segments").
//
// Low-confidence vehicles are excluded from the chain rather than silently
// participating in it - their rank is -1 and they carry no leader/follower
// links - so a downstream headway/bunching computation can never
// mistakenly treat a low-confidence position as a trustworthy anchor for
// an adjacent vehicle's headway (AC: "flagged, not silently trusted").

import type {
  CorridorOrderedVehicle,
  CorridorVehicleInput,
  OrderedVehicle,
  VehicleOrderingInput,
} from "./types.js";

export interface RouteDirectionOrderingConfig {
  isLoop: boolean;
  totalDistanceMeters: number;
}

export function computeLeaderFollowerOrder(
  vehicles: readonly VehicleOrderingInput[],
  routeDirection: RouteDirectionOrderingConfig
): OrderedVehicle[] {
  const eligible = vehicles.filter((v) => !v.isLowConfidence);
  const flagged = vehicles.filter((v) => v.isLowConfidence);

  // Furthest along the route first: rank 0 is the leader-most vehicle.
  const sorted = [...eligible].sort(
    (a, b) => b.distanceAlongRouteMeters - a.distanceAlongRouteMeters
  );

  const ordered: OrderedVehicle[] = sorted.map((v, idx) => ({
    ...v,
    rank: idx,
    leaderVehicleId: idx > 0 ? sorted[idx - 1]!.vehicleId : null,
    followerVehicleId: idx < sorted.length - 1 ? sorted[idx + 1]!.vehicleId : null,
  }));

  if (routeDirection.isLoop && ordered.length > 1) {
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    // The vehicle furthest along a loop is "led" by the vehicle nearest
    // the start (it will catch up to it after wrapping past total
    // distance), and the back-most vehicle "follows" the leader-most one.
    first.leaderVehicleId = last.vehicleId;
    last.followerVehicleId = first.vehicleId;
  }

  const excluded: OrderedVehicle[] = flagged.map((v) => ({
    ...v,
    rank: -1,
    leaderVehicleId: null,
    followerVehicleId: null,
  }));

  return [...ordered, ...excluded];
}

/**
 * Orders vehicles across route-directions that share a corridor (trunk
 * segment), using each vehicle's route-direction corridorOffsetMeters /
 * corridorDirectionSign to convert its own route-relative distance into a
 * common corridor-relative distance. Vehicles whose route-direction has no
 * corridor offset configured are excluded (rank -1) rather than being
 * ordered against a meaningless comparison - same "flag, don't silently
 * trust" principle as the low-confidence exclusion above.
 */
export function computeCorridorOrder(
  vehicles: readonly CorridorVehicleInput[]
): CorridorOrderedVehicle[] {
  const usable = vehicles.filter((v) => !v.isLowConfidence && v.corridorOffsetMeters != null);
  const excludedInput = vehicles.filter((v) => v.isLowConfidence || v.corridorOffsetMeters == null);

  const positioned = usable
    .map((v) => ({
      ...v,
      corridorDistanceMeters: v.corridorOffsetMeters! + v.corridorDirectionSign * v.distanceAlongRouteMeters,
    }))
    .sort((a, b) => b.corridorDistanceMeters - a.corridorDistanceMeters);

  const ordered: CorridorOrderedVehicle[] = positioned.map((v, idx) => ({
    ...v,
    rank: idx,
    leaderVehicleId: idx > 0 ? positioned[idx - 1]!.vehicleId : null,
    followerVehicleId: idx < positioned.length - 1 ? positioned[idx + 1]!.vehicleId : null,
  }));

  const excluded: CorridorOrderedVehicle[] = excludedInput.map((v) => ({
    ...v,
    corridorDistanceMeters: null,
    rank: -1,
    leaderVehicleId: null,
    followerVehicleId: null,
  }));

  return [...ordered, ...excluded];
}
