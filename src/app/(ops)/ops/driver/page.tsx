import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { OpsShell } from '@/components/ops/OpsShell';
import { DriverDashboard } from '@/components/ops/driver/DriverDashboard';

export default async function DriverPage() {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('driver', '/ops/driver');

  // Read the admin-set vehicle assignment straight from the session's own
  // ops_users row (same data GET /api/ops/auth/session exposes as
  // `vehicleId`; read directly here since this page already has the
  // verified session server-side, so there is no need for a second,
  // client-side round trip just to re-derive it). Null/unset degrades to
  // DriverDashboard's pre-existing self-reported-vehicle fallback rather
  // than blocking the page.
  let assignedVehicleId: string | null = null;
  try {
    const user = await getOpsRepo().findUserById(session.sub);
    assignedVehicleId = user?.vehicleId ?? null;
  } catch (error) {
    if (!(error instanceof OpsDbConfigError)) throw error;
    // Ops DB not configured: fall back to the self-report convention
    // rather than failing the whole page.
  }

  return (
    <OpsShell title="Driver" email={session.email}>
      <DriverDashboard assignedVehicleId={assignedVehicleId} />
    </OpsShell>
  );
}
