import type { VehicleState } from '@/models/control';
import { LiveBadge } from './LiveBadge';

const STOP_STATE_LABEL: Record<VehicleState['stopState'], string> = {
  approaching_stop: 'Approaching stop',
  dwelling_at_stop: 'Dwelling at stop',
  held_by_controller: 'Held',
  stopped_in_traffic: 'Stopped in traffic',
  departed_stop: 'Departed stop',
  off_route: 'Off route',
};

/**
 * Live vehicle positions for the selected route-direction (AC: "Dashboard
 * shows live positions (LIVE badge)"). Distance-along-route + speed rather
 * than a map — control-service's current GET /v1/vehicle-states projection
 * doesn't populate lat/lon yet (see the comment on vehicleStateSchema in
 * src/models/control.ts); this table surfaces exactly the fields that
 * endpoint reliably returns today, each row's freshness stated explicitly
 * rather than assumed.
 */
export function LivePositionsTable({ positions, now }: { positions: VehicleState[]; now: number }) {
  if (positions.length === 0) {
    return <p className="text-sm text-ops-muted">No vehicles currently reporting on this route-direction.</p>;
  }

  const sorted = [...positions].sort(
    (a, b) => (b.distanceAlongRouteMeters ?? -1) - (a.distanceAlongRouteMeters ?? -1),
  );

  return (
    <div className="overflow-x-auto rounded-md border border-ops-line">
      <table className="w-full min-w-[720px] text-left text-sm">
        <caption className="sr-only">Live vehicle positions, {positions.length} vehicles</caption>
        <thead>
          <tr className="border-b border-ops-line text-[11px] uppercase tracking-[0.12em] text-ops-muted">
            <th scope="col" className="px-3 py-2 font-mono">Vehicle</th>
            <th scope="col" className="px-3 py-2 font-mono">Distance along route</th>
            <th scope="col" className="px-3 py-2 font-mono">Speed</th>
            <th scope="col" className="px-3 py-2 font-mono">Stop state</th>
            <th scope="col" className="px-3 py-2 font-mono">Confidence</th>
            <th scope="col" className="px-3 py-2 font-mono">Last observed</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((vehicle) => (
            <tr key={vehicle.vehicleId} className="border-b border-ops-line/50 text-ops-ink last:border-0">
              <td className="px-3 py-2 font-mono">{vehicle.vehicleId}</td>
              <td className="px-3 py-2 text-ops-muted">
                {vehicle.distanceAlongRouteMeters === null ? '—' : `${Math.round(vehicle.distanceAlongRouteMeters)} m`}
              </td>
              <td className="px-3 py-2 text-ops-muted">{vehicle.speedKmph === null ? '—' : `${vehicle.speedKmph} km/h`}</td>
              <td className="px-3 py-2 text-ops-muted">{STOP_STATE_LABEL[vehicle.stopState]}</td>
              <td className="px-3 py-2 text-ops-muted">
                {vehicle.confidence === null ? '—' : `${Math.round(vehicle.confidence * 100)}%`}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <LiveBadge observedAt={vehicle.observedAt} now={now} />
                  <span className="text-xs text-ops-faint">{new Date(vehicle.observedAt).toLocaleTimeString()}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
