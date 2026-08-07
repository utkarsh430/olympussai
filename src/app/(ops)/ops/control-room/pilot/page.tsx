import Link from 'next/link';
import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { PilotDashboard } from '@/components/ops/control-room/PilotDashboard';
import { getDailyKpiSnapshots, getGuardrailBreaches, getWarRoomIncidents } from '@/lib/controlService/pilotData';

export const dynamic = 'force-dynamic';

/**
 * Pilot-staging dashboard: daily KPIs (EWT/CV/recovery rate/guardrail
 * breaches/compliance) per route-direction plus a war-room view of the
 * day's incidents (ticket: "Pilot-staging dashboard with per-route
 * rollout gates and daily KPIs", AC2/AC3). Nested under /ops/control-room
 * so it inherits that segment's `requireOpsRolePage('control_room', ...)`
 * guard from layout.tsx, same reasoning as the sibling
 * /ops/control-room/observability page. Rollout-stage *editing* is an
 * admin action (AC1), at /ops/admin/rollout-stages — this page only reads
 * the current stage per route as dashboard context, it never sets it.
 */
export default async function PilotStagingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; routeDirectionId?: string }>;
}) {
  const session = (await getOpsSession())!;
  const { date, routeDirectionId } = await searchParams;

  return (
    <OpsShell title="Pilot Staging" email={session.email}>
      <p className="mb-6 text-sm">
        <Link href="/ops/control-room" className="text-[#8fb4ff] hover:underline">
          &larr; Back to Control Room
        </Link>
      </p>
      <DashboardBody date={date} routeDirectionId={routeDirectionId} viewerEmail={session.email} />
    </OpsShell>
  );
}

/** See src/app/(ops)/ops/dispatcher/page.tsx's DashboardBody for why this boundary exists: an unexpected error here must render an inline message, never take down the guard/nav chrome around it. */
async function DashboardBody({
  date,
  routeDirectionId,
  viewerEmail,
}: {
  date?: string;
  routeDirectionId?: string;
  viewerEmail: string;
}) {
  try {
    const [kpi, breaches, warRoom] = await Promise.all([
      getDailyKpiSnapshots(date, routeDirectionId),
      getGuardrailBreaches(routeDirectionId),
      getWarRoomIncidents(date, routeDirectionId),
    ]);
    return <PilotDashboard kpi={kpi} breaches={breaches} warRoom={warRoom} date={date} viewerEmail={viewerEmail} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Pilot-staging data is unavailable right now ({message}). Try refreshing the page.
      </p>
    );
  }
}
