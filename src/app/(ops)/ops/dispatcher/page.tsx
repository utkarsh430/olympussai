import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';
import { DispatcherDashboard } from '@/components/ops/dispatcher/DispatcherDashboard';

export const dynamic = 'force-dynamic';

export default async function DispatcherPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // requireOpsRolePage() in the layout above guarantees a non-null,
  // correct-role session by the time this renders.
  const session = (await getOpsSession())!;
  const { q } = await searchParams;

  return (
    <OpsShell title="Dispatcher" email={session.email}>
      <DashboardBody query={q ?? ''} />
    </OpsShell>
  );
}

/**
 * Isolated so a data-source failure never takes down the guard/nav chrome
 * around it (this ticket's AC4) — getOpsFleetSnapshot itself never throws,
 * but this extra boundary is defensive against any future regression in
 * that guarantee.
 */
async function DashboardBody({ query }: { query: string }) {
  try {
    const snapshot = await getOpsFleetSnapshot();
    return <DispatcherDashboard snapshot={snapshot} query={query} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Dispatcher data is unavailable right now ({message}). Try refreshing the page.
      </p>
    );
  }
}
