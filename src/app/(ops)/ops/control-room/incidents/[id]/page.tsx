import Link from 'next/link';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { getIncidentState } from '@/lib/controlService/incidentTimelineData';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { ActiveIncidentsPanel } from '@/components/ops/control-room/ActiveIncidentsPanel';
import { IncidentCopilotPanel } from '@/components/ops/control-room/IncidentCopilotPanel';
import { IncidentDecisionsList } from '@/components/ops/control-room/IncidentDecisionsList';
import { CommandLookupPanel } from '@/components/ops/control-room/CommandLookupPanel';

export const dynamic = 'force-dynamic';

/**
 * Incident timeline (this ticket's AC3: "reconstructs state -> explanation
 * -> decision -> ack -> outcome"). Nested under /ops/control-room so it
 * inherits that segment's control_room guard. Each stage is sourced from
 * the real system that owns it — control-service for state, the copilot
 * for explanation, this app's own ops_dispatcher_actions for decisions,
 * and an explicit control-service command lookup for ack/outcome (see
 * CommandLookupPanel's doc comment for why that one is a manual lookup,
 * not an automatic join).
 */
export default async function IncidentTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts. `next` carries the real incident id so
  // a bounced operator returns to the incident they were reading.
  const session = await requireOpsRolePage(
    'control_room',
    `/ops/control-room/incidents/${encodeURIComponent(id)}`,
  );

  return (
    <OpsShell title="Incident Timeline" email={session.email}>
      <p className="mb-6 text-sm">
        <Link href="/ops/control-room/observability" className="text-[#8fb4ff] hover:underline">
          &larr; Back to Live Observability
        </Link>
      </p>
      <TimelineBody incidentId={id} />
    </OpsShell>
  );
}

/** See src/app/(ops)/ops/dispatcher/page.tsx's DashboardBody for why this boundary exists. */
async function TimelineBody({ incidentId }: { incidentId: string }) {
  try {
    const [{ incident, error }, decisions] = await Promise.all([
      getIncidentState(incidentId),
      getOpsRepo().listDispatcherActions({ incidentId, limit: 50 }),
    ]);

    return (
      <div className="space-y-8">
        <h1 className="font-mono text-sm text-[#e6e9ef]">
          Incident <span className="text-[#8fb4ff]">{incidentId}</span>
        </h1>

        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">1. State</h2>
          {error && (
            <p role="alert" className="mb-3 text-sm text-[#f0857d]">
              Could not confirm current state from the control service ({error}).
            </p>
          )}
          {incident ? (
            <ActiveIncidentsPanel incidents={[incident]} />
          ) : (
            !error && (
              <p className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[#9aa0ad]">
                No incident found with this id.
              </p>
            )
          )}
        </section>

        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">2. Explanation</h2>
          {incident ? (
            <IncidentCopilotPanel incidents={[incident]} />
          ) : (
            <p className="text-sm text-[#6f7684]">Unavailable without a confirmed incident state.</p>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">3. Decision</h2>
          <IncidentDecisionsList decisions={decisions} />
        </section>

        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">4. Ack &amp; 5. Outcome</h2>
          <p className="mb-3 text-[11px] text-[#6f7684]">
            This app does not yet store which control-service command a decision above led to (no REST client that
            actually dispatches a command exists — docs/CONTROL_SERVICE_INTEGRATION.md). If you know the
            command id, look it up directly for its driver ack and final status.
          </p>
          <CommandLookupPanel />
        </section>
      </div>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <p role="alert" className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
        Incident timeline data is unavailable right now ({message}). Try refreshing the page.
      </p>
    );
  }
}
