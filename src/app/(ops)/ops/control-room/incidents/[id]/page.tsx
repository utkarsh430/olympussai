import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert, OpsEmptyState, OpsSection, OpsStack } from '@/components/ops/ui';
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

  // The incident id used to be a second <h1> in the page body. One <h1> per
  // page: the shell owns it, and the id is what qualifies it, so it goes in
  // the shell's subtitle slot.
  return (
    <OpsShell title="Incident Timeline" email={session.email} role="control_room" subtitle={id}>
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
      <OpsStack>
        <OpsSection title="1. State">
          {error && (
            <OpsAlert tone="error" className="mb-3">
              Could not confirm current state from the control service ({error}).
            </OpsAlert>
          )}
          {incident ? (
            <ActiveIncidentsPanel incidents={[incident]} />
          ) : (
            !error && <OpsEmptyState>No incident found with this id.</OpsEmptyState>
          )}
        </OpsSection>

        <OpsSection title="2. Explanation">
          {incident ? (
            <IncidentCopilotPanel incidents={[incident]} />
          ) : (
            <p className="text-sm text-ops-faint">
              Unavailable without a confirmed incident state.
            </p>
          )}
        </OpsSection>

        <OpsSection title="3. Decision">
          <IncidentDecisionsList decisions={decisions} />
        </OpsSection>

        <OpsSection
          title="4. Ack & 5. Outcome"
          description="This app does not yet store which control-service command a decision above led to (no REST client that actually dispatches a command exists — docs/CONTROL_SERVICE_INTEGRATION.md). If you know the command id, look it up directly for its driver ack and final status."
        >
          <CommandLookupPanel />
        </OpsSection>
      </OpsStack>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <OpsAlert tone="error">
        Incident timeline data is unavailable right now ({message}). Try refreshing the page.
      </OpsAlert>
    );
  }
}
