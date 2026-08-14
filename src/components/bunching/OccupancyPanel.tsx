import { OpsAlert, OpsBadge, OpsPanel, OpsReadout, OpsStack } from '@/components/ops/ui';
import type { RehearsalResult } from '@/models/rehearsal';

/**
 * The occupancy gap, shown rather than filled.
 *
 * The deployed decision engine has an occupancy-weighted tier: it charges a
 * cost for holding a loaded bus, so a full bus is held less readily than an
 * empty one. Nothing in this system has ever written an occupancy reading —
 * `vehicle_states.occupancy_count` is null across the whole fleet and no
 * corridor has a configured capacity — so that tier has always fallen back
 * to assuming every bus is half full.
 *
 * A simulator is allowed to have an occupancy number because it invented
 * one. This panel runs the SAME deployed function twice, once with the
 * fallback production actually uses and once with the modelled load, and
 * reports the difference. It is the only honest way to answer "what would
 * an occupancy feed buy us" without pretending to have one.
 */
export function OccupancyPanel({ result }: { result: RehearsalResult }) {
  const contrast = result.occupancyContrast;
  const deployed = contrast.meanOnboardCostAsDeployedToday;
  const modelled = contrast.meanOnboardCostWithModelledOccupancy;
  const shiftPercent =
    deployed !== null && modelled !== null && deployed > 0
      ? Math.round(((modelled - deployed) / deployed) * 100)
      : null;

  return (
    <OpsStack>
      <OpsPanel
        title="Occupancy"
        description="The one input the deployed engine wants and has never had."
        actions={<OpsBadge variant="sim">Modelled</OpsBadge>}
      >
        <OpsStack>
          <p className="max-w-prose text-sm leading-relaxed text-ops-muted">
            The decision engine weighs the cost of delaying the passengers already aboard against the
            wait it saves the ones still at the stop. It has never had a real load to weigh:{' '}
            {result.policy.occupancyCapacity === null
              ? 'this corridor has no configured capacity, and no bus in this fleet reports a passenger count'
              : 'no bus in this fleet reports a passenger count'}
            , so on every real decision it assumes each bus is half full.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <OpsReadout
              label="Decisions scored"
              value={contrast.decisionsScored.toLocaleString('en-IN')}
            />
            <OpsReadout
              label="Cost as deployed"
              value={deployed === null ? '—' : deployed.toFixed(1)}
              tone="default"
            />
            <OpsReadout
              label="Cost with modelled load"
              value={modelled === null ? '—' : modelled.toFixed(1)}
              tone="accent"
            />
          </div>

          {shiftPercent !== null ? (
            <OpsAlert tone={Math.abs(shiftPercent) > 10 ? 'warning' : 'info'}>
              On this run, the half-full assumption valued the delay to onboard passengers about{' '}
              {Math.abs(shiftPercent)}% {shiftPercent > 0 ? 'lower' : 'higher'} than the modelled load
              did. That is what an occupancy feed would change about this tier — measured against a
              load this simulator invented, so it sizes the question rather than answering it.
            </OpsAlert>
          ) : null}

          <p className="max-w-prose text-xs leading-relaxed text-ops-faint">
            {contrast.decisionsUsingFallbackToday === contrast.decisionsScored
              ? `All ${contrast.decisionsScored} scored decisions fell back to the half-full assumption, which is what production does today.`
              : `${contrast.decisionsUsingFallbackToday} of ${contrast.decisionsScored} scored decisions fell back to the half-full assumption.`}
            {contrast.rankingComparable
              ? ''
              : ' Occupancy could not change WHICH action was chosen in this run: each decision compared one bus against the one ahead of it, so there was only ever one candidate to rank. It changes what that action costs, not which one wins.'}
          </p>
        </OpsStack>
      </OpsPanel>
    </OpsStack>
  );
}
