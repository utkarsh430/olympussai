import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert, OpsSection, OpsStack } from '@/components/ops/ui';
import { getObservabilitySnapshot } from '@/lib/controlService/observabilityData';
import { IncidentCopilotPanel } from '@/components/ops/control-room/IncidentCopilotPanel';
import { ShiftReportCopilotForm } from '@/components/ops/control-room/ShiftReportCopilotForm';
import { CopilotQueryBox } from '@/components/ops/control-room/CopilotQueryBox';
import { RouteDirectionPicker } from '@/components/ops/control-room/RouteDirectionPicker';

export const dynamic = 'force-dynamic';

/**
 * Incident-explanation / shift-report / NL-query copilot
 * (docs/olympuss/COPILOT.md). Nested under /ops/control-room so it inherits
 * that segment's `requireOpsRolePage('control_room', ...)` guard from
 * layout.tsx, same as the observability page.
 *
 * Entirely additive to the control-room surface: it never dispatches a
 * command and never touches ops_dispatcher_actions — see
 * src/lib/copilot/service.ts's module boundary doc comment.
 */
export default async function CopilotPage({
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
  const session = await requireOpsRolePage('control_room', '/ops/control-room/copilot');
  const { routeDirectionId } = await searchParams;

  return (
    <OpsShell title="Copilot" email={session.email} role="control_room">
      <CopilotBody routeDirectionId={routeDirectionId} />
    </OpsShell>
  );
}

/** See src/app/(ops)/ops/dispatcher/page.tsx's DashboardBody for why this boundary exists: an unexpected error here must render an inline message, never take down the guard/nav chrome around it. */
async function CopilotBody({ routeDirectionId }: { routeDirectionId?: string }) {
  try {
    const snapshot = await getObservabilitySnapshot(routeDirectionId, Date.now());
    const selected = snapshot.selectedRouteDirectionId;

    return (
      <OpsStack>
        <RouteDirectionPicker routeDirections={snapshot.routeDirections} selectedId={selected} />

        <OpsSection title="Explain active incidents">
          <IncidentCopilotPanel incidents={snapshot.incidents} />
        </OpsSection>

        <OpsSection>
          <ShiftReportCopilotForm routeDirectionId={selected} />
        </OpsSection>

        <OpsSection>
          <CopilotQueryBox routeDirectionId={selected} />
        </OpsSection>
      </OpsStack>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <OpsAlert tone="error">
        Copilot data is unavailable right now ({message}). Try refreshing the page.
      </OpsAlert>
    );
  }
}
