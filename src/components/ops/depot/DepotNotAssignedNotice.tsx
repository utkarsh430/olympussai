import { OpsAlert } from '@/components/ops/ui';
import type { OpsScopeDenial } from '@/lib/ops/depotAccess';

/**
 * What a depot operator sees instead of a dashboard when their account has no
 * usable depot assignment.
 *
 * This is the visible face of the fail-closed rule in
 * db/migrations/20260812150000__ops_depot_ownership.sql: an unassigned depot
 * operator is shown nothing and told why, rather than being shown the whole
 * state's fleet. It deliberately names the fix and who performs it, because
 * the operator cannot resolve this themselves — no depot-facing route may
 * write depot_id, which is exactly what makes the assignment trustworthy as
 * an authorization boundary.
 *
 * Presentational and prop-driven: it never reads the session or the registry,
 * so it cannot accidentally become a second, weaker place the boundary is
 * decided.
 */
export function DepotNotAssignedNotice({ reason }: { reason: OpsScopeDenial }) {
  const detail =
    reason === 'depot_missing'
      ? 'The depot on your account is no longer in the depot list, so this screen cannot tell which buses are yours.'
      : 'Your account has not been given a depot yet.';

  return (
    <OpsAlert tone="warning" title="No depot on your account">
      <p className="mb-2">{detail}</p>
      <p>
        This screen shows the buses belonging to one depot, so there is nothing to show until
        somebody sets yours. Ask your administrator to set your depot, then reload this page. Your
        sign-in is fine — this is not a password problem.
      </p>
    </OpsAlert>
  );
}
