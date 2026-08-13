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
      ? 'The depot recorded on your account is no longer in the depot registry, so its vehicles cannot be identified.'
      : 'Your account has not been assigned to a depot yet.';

  return (
    <section
      role="alert"
      className="rounded-md border border-[#f0c14b]/40 bg-[#f0c14b]/10 px-4 py-4 text-sm text-[#f3d68a]"
    >
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f0c14b]">
        No depot assigned
      </h2>
      <p className="mb-2">{detail}</p>
      <p className="text-[#c9b27a]">
        A depot dashboard shows the vehicles belonging to one depot, so there is nothing to show until
        an administrator assigns yours. Ask an admin to set your depot, then reload this page.
      </p>
    </section>
  );
}
