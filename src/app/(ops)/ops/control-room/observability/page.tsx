import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert } from '@/components/ops/ui';
import { ObservabilityDashboard } from '@/components/ops/control-room/ObservabilityDashboard';
import { getObservabilitySnapshot } from '@/lib/controlService/observabilityData';

export const dynamic = 'force-dynamic';

/**
 * Live observability dashboard (headway/EWT/CV metrics + reactive bunching
 * incidents) — control-room's window into the control service's detection
 * layer. Nested under /ops/control-room so it inherits that segment's
 * `requireOpsRolePage('control_room', ...)` guard from layout.tsx; this
 * page does not re-derive its own role check for the same reason the
 * sibling /ops/<role>/page.tsx routes don't.
 */
export default async function ObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ routeDirectionId?: string }>;
}) {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('control_room', '/ops/control-room/observability');
  const { routeDirectionId } = await searchParams;

  return (
    <OpsShell
      title="One Corridor In Detail"
      email={session.email}
      role="control_room"
      variant="wide"
      subtitle="Spacing, buses closing up, and where each bus is — for the corridor you choose"
    >
      <DashboardBody routeDirectionId={routeDirectionId} />
    </OpsShell>
  );
}

/** See src/app/(ops)/ops/dispatcher/page.tsx's DashboardBody for why this boundary exists: an unexpected error here must render an inline message, never take down the guard/nav chrome around it. */
async function DashboardBody({ routeDirectionId }: { routeDirectionId?: string }) {
  try {
    const now = Date.now();
    const snapshot = await getObservabilitySnapshot(routeDirectionId, now);
    return <ObservabilityDashboard snapshot={snapshot} now={now} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <OpsAlert tone="error">
        This corridor&apos;s figures could not be read right now ({message}). Try refreshing the
        page.
      </OpsAlert>
    );
  }
}
