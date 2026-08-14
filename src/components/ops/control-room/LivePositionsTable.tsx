import type { VehicleState } from '@/models/control';
import {
  OpsEmptyState,
  OpsIdentifier,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTdNumericClass,
  opsThClass,
  opsTheadRowClass,
  opsTrClass,
} from '@/components/ops/ui';
import { stopStateLabel } from '@/lib/ops/vocabulary';
import { LiveBadge } from './LiveBadge';

/**
 * Where each bus on this corridor is, in running order.
 *
 * This is not the map by another name and is not redundant with it. Sorted by
 * distance along the route, it is the closest signal this system has to a
 * running order, and it states each row's freshness as a number. A map shows
 * WHERE; this shows how far along and how old. A control room needs both.
 *
 * The column headings and the stop-state values are now plain: `Dwelling at
 * stop` and `Off route` were the raw enum with underscores swapped, and
 * `Distance along route` / `Last observed` were written for whoever built the
 * table rather than whoever reads it. Every stop state goes through
 * src/lib/ops/vocabulary.ts, which the driver console will read from too.
 */
export function LivePositionsTable({ positions, now }: { positions: VehicleState[]; now: number }) {
  if (positions.length === 0) {
    return <OpsEmptyState>No bus is reporting a position on this corridor.</OpsEmptyState>;
  }

  const sorted = [...positions].sort(
    (a, b) => (b.distanceAlongRouteMeters ?? -1) - (a.distanceAlongRouteMeters ?? -1),
  );

  return (
    <OpsTableFrame>
      <table className={`${opsTableClass} min-w-[720px]`}>
        <caption className="sr-only">
          Buses on this corridor, {positions.length} in total, furthest along the route first
        </caption>
        <thead>
          <tr className={opsTheadRowClass}>
            <th scope="col" className={opsThClass}>
              Bus
            </th>
            <th scope="col" className={opsThClass}>
              How far along the route
            </th>
            <th scope="col" className={opsThClass}>
              Speed
            </th>
            <th scope="col" className={opsThClass}>
              What it is doing
            </th>
            <th scope="col" className={opsThClass}>
              How sure of the position
            </th>
            <th scope="col" className={opsThClass}>
              Last heard from
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((vehicle) => (
            <tr key={vehicle.vehicleId} className={opsTrClass}>
              <td className={opsTdClass}>
                <OpsIdentifier>{vehicle.vehicleId}</OpsIdentifier>
              </td>
              <td className={opsTdNumericClass}>
                {vehicle.distanceAlongRouteMeters === null
                  ? '—'
                  : `${Math.round(vehicle.distanceAlongRouteMeters)} m`}
              </td>
              <td className={opsTdNumericClass}>
                {vehicle.speedKmph === null ? '—' : `${vehicle.speedKmph} km/h`}
              </td>
              <td className={opsTdMutedClass}>{stopStateLabel(vehicle.stopState)}</td>
              <td className={opsTdNumericClass}>
                {vehicle.confidence === null ? '—' : `${Math.round(vehicle.confidence * 100)}%`}
              </td>
              <td className={opsTdClass}>
                <div className="flex items-center gap-2">
                  <LiveBadge observedAt={vehicle.observedAt} now={now} />
                  <span className="text-xs text-subtle">
                    {new Date(vehicle.observedAt).toLocaleTimeString()}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </OpsTableFrame>
  );
}
