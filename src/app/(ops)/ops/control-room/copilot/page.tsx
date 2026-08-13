import Link from 'next/link';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
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
    <OpsShell title="Copilot" email={session.email}>
      <p className="mb-6 text-sm">
        <Link href="/ops/control-room" className="text-[#8fb4ff] hover:underline">
          &larr; Back to Control Room
        </Link>
      </p>
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
      <div className="space-y-8">
        <RouteDirectionPicker routeDirections={snapshot.routeDirections} selectedId={selected} />

        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
            Explain active incidents
          </h2>
          <IncidentCopilotPanel incidents={snapshot.incidents} />
        </section>

        <section>
          <ShiftReportCopilotForm routeDirectionId={selected} />
        </section>

        <section>
          <CopilotQueryBox routeDirectionId={selected} />
        </section>
      </div>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Copilot data is unavailable right now ({message}). Try refreshing the page.
      </p>
    );
  }
}
