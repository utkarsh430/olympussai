import type { RouteOperationsBoardSnapshot } from '@/lib/controlService/routeBoardData';
import { computeHeadwayCountdowns } from '@/lib/controlService/headwayCountdown';
import type { StandbyCandidate } from '@/lib/ops/fleetView';
import { RouteDirectionPicker } from '@/components/ops/control-room/RouteDirectionPicker';
import { ControlServiceNotice } from '@/components/ops/control-room/ControlServiceNotice';

function formatSeconds(value: number | null): string {
  if (value === null) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.round(Math.abs(value));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${String(s).padStart(2, '0')}`;
}

function countdownColorClass(countdownSeconds: number | null, targetSeconds: number): string {
  if (countdownSeconds === null) return 'border-[rgba(255,255,255,0.12)] text-[#9aa0ad]';
  if (countdownSeconds < 0) return 'border-[#f0857d]/50 bg-[#f0857d]/10 text-[#f5a89f]';
  if (countdownSeconds < targetSeconds * 0.25) return 'border-[#e8b34a]/50 bg-[#e8b34a]/10 text-[#e8c07a]';
  return 'border-[#4fbf82]/40 bg-[#4fbf82]/10 text-[#7fd9a4]';
}

/**
 * Dispatcher/depot "route operations board" (this ticket's AC1: "departure
 * order, headway countdown, bay/crew conflicts, standby availability").
 * Server-rendered from real control-service + live-fleed-feed data; the
 * zero-JS RouteDirectionPicker below re-navigates with ?routeDirectionId=
 * the same way the control-room observability dashboard's picker does.
 *
 * Two of the four things this AC asks for have no real backing data
 * anywhere in this system yet (no bay/crew assignment table in
 * control-service's schema, control-service/db/migrations/ — see that
 * migration's own crew_ref comment: "crew scheduling is out of this
 * ticket's scope"). Rather than fabricate numbers, "Bay & crew conflicts"
 * below is an explicit, labelled gap. "Departure order" and "standby
 * availability" are real signals but heuristic proxies, labelled as such —
 * see routeBoardData.ts and fleetView.ts's deriveStandbyAvailability for
 * exactly what each one measures.
 */
export function RouteOperationsBoard({
  snapshot,
  standby,
  depotLabel,
}: {
  snapshot: RouteOperationsBoardSnapshot;
  standby: StandbyCandidate[];
  /** When set (depot view), the standby panel's heading notes it's scoped to this depot's roster. */
  depotLabel?: string;
}) {
  const countdowns = computeHeadwayCountdowns(snapshot.headwayPairs);
  const countdownByFollower = new Map(countdowns.map((c) => [c.followerVehicleId, c]));

  return (
    <div className="space-y-6">
      <ControlServiceNotice source={snapshot.source} stale={snapshot.stale} error={snapshot.error} />

      <RouteDirectionPicker routeDirections={snapshot.routeDirections} selectedId={snapshot.selectedRouteDirectionId} />

      {!snapshot.selectedRouteDirectionId ? (
        <p className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[#9aa0ad]">
          No active route-directions reported by the control service.
        </p>
      ) : (
        <section>
          <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
            Running order &amp; headway countdown
          </h3>
          <p className="mb-3 text-[11px] text-[#6f7684]">
            Ordered by distance along the route (furthest first) — the closest real signal available to a scheduled
            departure order. Countdown is the cushion remaining before a follower breaches its target headway behind
            its leader; red means already overdue.
          </p>
          {snapshot.vehicles.length === 0 ? (
            <p className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[#9aa0ad]">
              No live vehicle-state reported on this route-direction right now.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-[rgba(255,255,255,0.08)]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] uppercase tracking-[0.12em] text-[#6f7684]">
                    <th className="px-3 py-2">Vehicle</th>
                    <th className="px-3 py-2">Stop state</th>
                    <th className="px-3 py-2">Current stop</th>
                    <th className="px-3 py-2">Distance along route</th>
                    <th className="px-3 py-2">Headway countdown</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.vehicles.map((vehicle) => {
                    const countdown = countdownByFollower.get(vehicle.vehicleId);
                    return (
                      <tr key={vehicle.vehicleId} className="border-b border-[rgba(255,255,255,0.05)] last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-[#e6e9ef]">{vehicle.vehicleId}</td>
                        <td className="px-3 py-2 text-xs text-[#9aa0ad]">{vehicle.stopState.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-xs text-[#9aa0ad]">{vehicle.currentStopId ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-[#9aa0ad]">
                          {vehicle.distanceAlongRouteMeters === null ? '—' : `${Math.round(vehicle.distanceAlongRouteMeters)} m`}
                        </td>
                        <td className="px-3 py-2">
                          {countdown ? (
                            <span
                              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${countdownColorClass(countdown.countdownSeconds, countdown.targetHeadwaySeconds)}`}
                              title={`Behind ${countdown.leaderVehicleId}; target ${countdown.targetHeadwaySeconds}s`}
                            >
                              {countdown.overdue ? 'Overdue ' : ''}
                              {formatSeconds(countdown.countdownSeconds)}
                            </span>
                          ) : (
                            <span className="text-xs text-[#6f7684]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
          Standby availability{depotLabel ? ` — ${depotLabel}` : ''}
        </h3>
        <p className="mb-3 text-[11px] text-[#6f7684]">
          Heuristic over the live fleet feed: no active trip assignment and ignition not confirmed off. Not an
          authoritative duty-roster designation — treat as a starting point, not a guarantee of availability.
        </p>
        {standby.length === 0 ? (
          <p className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[#9aa0ad]">
            No vehicles currently read as available for standby injection.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {standby.slice(0, 12).map(({ bus, idleMinutes }) => (
              <li
                key={bus.id}
                className="rounded-md border border-[rgba(255,255,255,0.08)] px-3 py-2 text-xs text-[#9aa0ad]"
              >
                <span className="font-mono text-[#e6e9ef]">{bus.registrationNumber}</span>
                <span className="mx-1.5">·</span>
                {bus.depotName ?? 'Unknown depot'}
                <span className="mx-1.5">·</span>
                {idleMinutes === null ? 'freshness unknown' : `updated ${idleMinutes}m ago`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">Bay &amp; crew conflicts</h3>
        <p className="rounded-md border border-dashed border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[#9aa0ad]">
          Not available yet — this system has no bay assignment or crew-duty data source to detect conflicts against
          (control-service&apos;s schema only carries an opaque <code className="font-mono text-[#e6e9ef]">crew_ref</code>{' '}
          on a block, scoped out of crew scheduling by design). Tracked as follow-up backlog work rather than shown
          with fabricated data.
        </p>
      </section>
    </div>
  );
}
