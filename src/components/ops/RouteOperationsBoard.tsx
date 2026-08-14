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
  if (countdownSeconds === null) return 'border-ops-line-strong text-ops-muted';
  if (countdownSeconds < 0) return 'border-alert-crimson/50 bg-alert-crimson/10 text-ops-danger';
  if (countdownSeconds < targetSeconds * 0.25) return 'border-alert-amber/50 bg-alert-amber/10 text-ops-warn';
  return 'border-alert-green/40 bg-alert-green/10 text-ops-good';
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
        <p className="ops-well px-4 py-3 text-sm text-ops-muted">
          No active route-directions reported by the control service.
        </p>
      ) : (
        <section>
          <h3 className="ops-label mb-1">
            Running order &amp; headway countdown
          </h3>
          <p className="mb-3 text-[11px] text-ops-faint">
            Ordered by distance along the route (furthest first) — the closest real signal available to a scheduled
            departure order. Countdown is the cushion remaining before a follower breaches its target headway behind
            its leader; red means already overdue.
          </p>
          {snapshot.vehicles.length === 0 ? (
            <p className="ops-well px-4 py-3 text-sm text-ops-muted">
              No live vehicle-state reported on this route-direction right now.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-ops-line">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ops-line text-[10px] uppercase tracking-[0.12em] text-ops-muted">
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
                      <tr key={vehicle.vehicleId} className="border-b border-ops-line/60 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-ops-ink">{vehicle.vehicleId}</td>
                        <td className="px-3 py-2 text-xs text-ops-muted">{vehicle.stopState.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-xs text-ops-muted">{vehicle.currentStopId ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-ops-muted">
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
                            <span className="text-xs text-ops-faint">—</span>
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
        <h3 className="ops-label mb-1">
          Standby availability{depotLabel ? ` — ${depotLabel}` : ''}
        </h3>
        <p className="mb-3 text-[11px] text-ops-faint">
          Heuristic over the live fleet feed: no active trip assignment and ignition not confirmed off. Not an
          authoritative duty-roster designation — treat as a starting point, not a guarantee of availability.
        </p>
        {standby.length === 0 ? (
          <p className="ops-well px-4 py-3 text-sm text-ops-muted">
            No vehicles currently read as available for standby injection.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {standby.slice(0, 12).map(({ bus, idleMinutes }) => (
              <li
                key={bus.id}
                className="rounded-md border border-ops-line px-3 py-2 text-xs text-ops-muted"
              >
                <span className="font-mono text-ops-ink">{bus.registrationNumber}</span>
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
        <h3 className="ops-label mb-1">Bay &amp; crew conflicts</h3>
        <p className="ops-well border-dashed px-4 py-3 text-sm text-ops-muted">
          Not available yet — this system has no bay assignment or crew-duty data source to detect conflicts against
          (control-service&apos;s schema only carries an opaque <code className="font-mono text-ops-ink">crew_ref</code>{' '}
          on a block, scoped out of crew scheduling by design). Tracked as follow-up backlog work rather than shown
          with fabricated data.
        </p>
      </section>
    </div>
  );
}
