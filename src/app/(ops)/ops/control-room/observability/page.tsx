import Link from 'next/link';
import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
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
  const session = (await getOpsSession())!;
  const { routeDirectionId } = await searchParams;

  return (
    <OpsShell title="Live Observability" email={session.email}>
      <p className="mb-6 text-sm">
        <Link href="/ops/control-room" className="text-[#8fb4ff] hover:underline">
          &larr; Back to Control Room
        </Link>
      </p>
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
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Observability data is unavailable right now ({message}). Try refreshing the page.
      </p>
    );
  }
}
