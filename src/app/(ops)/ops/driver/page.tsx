import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';
import { isAuthDisabled } from '@/lib/auth/publicPreview';
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
  //
  // UNREACHABLE is tolerated as well as UNCONFIGURED, and the two used to be
  // the same case here by accident: behind a login this page body never ran
  // during an ops-database outage, because `resolveOpsSession` answered
  // `unavailable` first and the guard redirected to /ops/unavailable. Public
  // preview has no session to resolve (src/lib/auth/publicPreview.ts), so a
  // connection error reaches this line for the first time — and rethrowing it
  // made /ops/driver the one console that answered a missing database with an
  // HTTP 500 while the other six degraded. The fallback below is what the
  // comment above already promises; nothing about the authenticated path
  // changes, since it still cannot get here.
  let assignedVehicleId: string | null = null;
  try {
    const user = await getOpsRepo().findUserById(session.sub);
    assignedVehicleId = user?.vehicleId ?? null;
  } catch (error) {
    if (!(error instanceof OpsDbConfigError) && !isAuthDisabled()) throw error;
    // Ops DB not configured (or, in preview, not reachable): fall back to the
    // self-report convention rather than failing the whole page.
  }

  return (
    <OpsShell title="Driver" email={session.email} role="driver">
      <DriverDashboard assignedVehicleId={assignedVehicleId} />
    </OpsShell>
  );
}
