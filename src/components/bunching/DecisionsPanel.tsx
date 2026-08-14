import {
  OpsBadge,
  OpsEmptyState,
  OpsPanel,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTdNumericClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '@/components/ops/ui';
import {
  ACTION_TYPE_LABEL,
  REJECTION_REASON_LABEL,
  summariseDecisions,
} from '@/lib/rehearsal/comparison';
import type { RehearsalResult } from '@/models/rehearsal';

/**
 * Every decision the control laws made, and every one the safety filter
 * refused.
 *
 * The refusals are the point of showing this at all. A planner watching a
 * bus close on its leader and NOT be held needs to see that the engine
 * proposed a hold and its own guardrail rejected it — otherwise the only
 * available reading is that the controller failed to notice.
 */

/** Longest log a page will render. A 24-bus run over a 48-stop corridor produces hundreds; nobody reads past the first screenful. */
const MAX_ROWS = 60;

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function stopName(result: RehearsalResult, stopId: string): string {
  return result.corridor.stops.find((stop) => stop.stopId === stopId)?.name ?? stopId;
}

export function DecisionsPanel({ result }: { result: RehearsalResult }) {
  const summary = summariseDecisions(result);
  const acted = result.decisions.filter((decision) => decision.holdSeconds > 0);
  const refused = result.decisions.filter((decision) => decision.rejected.length > 0);
  const rows = result.decisions.slice(0, MAX_ROWS);

  return (
    <OpsPanel
      title="What the automatic spacing rules decided"
      description={`${result.decisions.length} decisions at ${result.corridor.controlPointCount} stops where a bus can be held: ${acted.length} holds made, ${refused.length} refused by the safety checks.`}
      padded={false}
      actions={
        <div className="flex flex-wrap gap-2">
          {summary.map((entry) => (
            <OpsBadge key={entry.actionType} variant="neutral">
              {ACTION_TYPE_LABEL[entry.actionType] ?? entry.actionType} {entry.count}
            </OpsBadge>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <div className="p-4">
          <OpsEmptyState>
            No bus reached a control point with a vehicle ahead of it on the corridor, so no control
            law had an input to act on.
          </OpsEmptyState>
        </div>
      ) : (
        <>
          <OpsTableFrame className="rounded-none border-0">
            <table className={opsTableClass}>
              <caption className="sr-only">Decisions made during the practice run</caption>
              <thead>
                <tr className={opsTheadRowClass}>
                  <th scope="col" className={opsThClass}>
                    Time
                  </th>
                  <th scope="col" className={opsThClass}>
                    Bus
                  </th>
                  <th scope="col" className={opsThClass}>
                    Control point
                  </th>
                  <th scope="col" className={opsThClass}>
                    Gap ahead
                  </th>
                  <th scope="col" className={opsThClass}>
                    Decision
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((decision, index) => {
                  const refusal = decision.rejected[0];
                  return (
                    <tr
                      key={`${decision.vehicleId}-${decision.stopId}-${index}`}
                      className={opsTrClass}
                    >
                      <td className={opsTdNumericClass}>{clock(decision.atSeconds)}</td>
                      <td className={opsTdClass}>
                        {decision.vehicleId}
                        {decision.vehicleId === result.disturbedVehicleId ? (
                          <span className="ml-2 text-[11px] uppercase tracking-wider text-alert-crimson">
                            disturbed
                          </span>
                        ) : null}
                      </td>
                      <td className={opsTdMutedClass}>{stopName(result, decision.stopId)}</td>
                      <td className={opsTdNumericClass}>
                        {decision.hFwdSeconds === null
                          ? '—'
                          : `${Math.round(decision.hFwdSeconds / 60)} min`}
                      </td>
                      <td className={opsTdClass}>
                        {decision.holdSeconds > 0 ? (
                          <span className="text-alert-amber">
                            Hold {decision.holdSeconds}s ·{' '}
                            {ACTION_TYPE_LABEL[decision.selectedActionType] ??
                              decision.selectedActionType}
                          </span>
                        ) : refusal ? (
                          <span className="text-ops-muted">
                            Hold proposed and refused —{' '}
                            {refusal.reasons
                              .map((reason) => REJECTION_REASON_LABEL[reason] ?? reason)
                              .join('; ')}
                          </span>
                        ) : (
                          <span className="text-ops-faint">No action needed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </OpsTableFrame>
          {result.decisions.length > rows.length ? (
            <p className="px-4 py-3 text-xs text-ops-faint">
              Showing the first {rows.length} of {result.decisions.length} decisions.
            </p>
          ) : null}
        </>
      )}
    </OpsPanel>
  );
}
