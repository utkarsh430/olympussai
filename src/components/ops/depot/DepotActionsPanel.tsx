import { OpsAlert, OpsPanel, OpsSection, OpsStack } from '@/components/ops/ui';
import { ENGINE_ACTION_TYPES } from '@/models/control';
import { actionLabel, humanOriginatedActions } from '@/lib/ops/recommendationView';

/**
 * What can actually be done from here — written as an inventory of what exists
 * rather than as a toolbar of buttons.
 *
 * ─── WHY THERE ARE NO BUTTONS ON THIS PANEL ──────────────────────────────
 *
 * MEASURED, not assumed: every API route a `depot` role can reach is a GET
 * (the fleet map, breakdown reports, the kill-switch LIST, and the schedule
 * lookup). `POST /api/ops/control-room/commands`, the kill-switch POST and the
 * decision engine are all `requireOpsRole(['control_room'])`. So a depot
 * operator observes and escalates; they do not issue. Rendering a disabled
 * "Hold" button here would suggest the capability is one permission away, when
 * it is a deliberate division of authority — and rendering an ENABLED one
 * would produce a 403 the operator could only discover by trying.
 *
 * ─── WHY THE SIX ARE DERIVED AND NOT LISTED ──────────────────────────────
 *
 * `humanOriginatedActions` subtracts what the engine reports it can propose
 * from the nine dispatchable instructions. Hardcoding the six would let this
 * panel keep claiming "nothing generates these" about an action the solver had
 * since learned. The claim cannot outlive its truth this way.
 */
export function DepotActionsPanel() {
  const engineActions = [...ENGINE_ACTION_TYPES];
  const humanActions = humanOriginatedActions(engineActions);

  return (
    <OpsStack gap="tight">
      <OpsAlert tone="info" title="This console observes; it does not issue.">
        Every operation a depot account can perform in this system is a read. Holds and every other instruction are
        issued from the control room, which owns that authority and the approval trail behind it. What this console is
        for is seeing your depot&apos;s buses, spotting a corridor closing up, and having the evidence ready when you
        call it in.
      </OpsAlert>

      <OpsSection
        title="Regulation the system can actually reason about"
        description="Three hold types, and nothing else. This is the whole of what the decision engine implements, not a subset chosen for this screen."
      >
        <ul className="space-y-2">
          {engineActions.map((action) => (
            <li key={action} className="ops-well px-4 py-3 text-sm">
              <span className="font-medium text-ops-ink">{actionLabel(action)}</span>
              <p className="mt-1 text-xs leading-relaxed text-ops-faint">
                Proposed by the decision engine for a bunched corridor, approved and issued in the control room, and
                delivered to the driver&apos;s console. This one genuinely reaches a driver and is genuinely recorded.
              </p>
            </li>
          ))}
        </ul>
      </OpsSection>

      <OpsSection
        title="Instructions that exist but that nothing proposes"
        description="Dispatchable in the command schema, and that is all. No model in this system generates one, and issuing one changes no state beyond the record of having issued it."
      >
        <div className="ops-well px-4 py-3">
          <p className="text-sm text-ops-muted">
            {humanActions.map((action) => actionLabel(action)).join(' · ')}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ops-faint">
            These are real entries in the command vocabulary and a driver would receive one if a control-room operator
            sent it. Nothing computes when to use them, nothing measures whether they worked, and no part of the system
            changes because one was sent. Treat them as a way of writing an instruction down, not as a lever the system
            pulls.
          </p>
        </div>
      </OpsSection>

      <OpsSection title="Not built">
        <OpsStack gap="tight">
          <OpsPanel title="Rerouting">
            <p className="text-sm text-ops-muted">
              Does not exist, in any form. There is no diversion, no alternative-path calculation and no way to tell a
              driver to take a different road. A corridor is fixed geometry here.
            </p>
          </OpsPanel>

          <OpsPanel title="Bay &amp; crew conflicts">
            <p className="text-sm text-ops-muted">
              Not available yet — this system has no bay assignment or crew-duty data source to detect conflicts
              against. Control-service&apos;s schema carries only an opaque{' '}
              <code className="font-mono text-ops-ink">crew_ref</code> on a block, scoped out of crew scheduling by
              design. Tracked as follow-up work rather than shown with fabricated data.
            </p>
          </OpsPanel>
        </OpsStack>
      </OpsSection>
    </OpsStack>
  );
}
