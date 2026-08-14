import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert } from '@/components/ops/ui';
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
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('control_room', '/ops/control-room/pilot');
  const { date, routeDirectionId } = await searchParams;

  return (
    <OpsShell title="Pilot Staging" email={session.email} role="control_room" variant="wide">
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
      <OpsAlert tone="error">
        Pilot-staging data is unavailable right now ({message}). Try refreshing the page.
      </OpsAlert>
    );
  }
}
