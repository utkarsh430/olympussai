import { OpsAlert, OpsPanel, OpsSection, OpsStack } from '@/components/ops/ui';
import { ENGINE_ACTION_TYPES, ENGINE_ADVISORY_ACTION_TYPES } from '@/models/control';
import { actionLabel, humanOriginatedActions } from '@/lib/ops/recommendationView';

/**
 * What can actually be done from here — written as an inventory of what exists
 * rather than as a toolbar of buttons.
 *
 * ─── WHY THERE ARE NO BUTTONS ON THIS PANEL ──────────────────────────────
 *
 * MEASURED, not assumed: every API route a `depot` role can reach is a read
 * (the fleet map, breakdown reports, the list of stopped instructions, and the
 * timetable lookup). Sending an instruction, stopping instructions and the
 * recommendation engine are all `requireOpsRole(['control_room'])`. So a depot
 * operator watches and calls it in; they do not send. Rendering a disabled
 * "Hold" button here would suggest the capability is one permission away, when
 * it is a deliberate division of authority — and rendering an ENABLED one
 * would produce a refusal the operator could only discover by trying.
 *
 * ─── WHY THE HUMAN-ONLY SET IS DERIVED AND NOT LISTED ────────────────────
 *
 * `humanOriginatedActions` subtracts what the engine reports it can propose
 * from every instruction the system can express. Hardcoding that set would let
 * this panel keep claiming "nothing generates these" about an instruction the
 * engine had since learned - which has now happened once, when the engine
 * gained alighting-only (`boarding_limit`). This panel moved it from one list
 * to the other with no edit, which is what the derivation is for.
 */
export function DepotActionsPanel() {
  const engineActions = [...ENGINE_ACTION_TYPES];
  const advisoryActions = [...ENGINE_ADVISORY_ACTION_TYPES];
  const humanActions = humanOriginatedActions(engineActions, advisoryActions);

  return (
    <OpsStack gap="tight">
      <OpsAlert tone="info" title="This console watches; it does not send.">
        Everything a depot account can do in this system is a read. Holds and every other
        instruction are sent from the control room, which owns that authority and the approval trail
        behind it. What this console is for is seeing your depot&apos;s buses, spotting a corridor
        closing up, and having the evidence ready when you call it in.
      </OpsAlert>

      <OpsSection
        title="What the system can actually work out for you"
        description="This is the whole of what the recommendation engine can work out, not a shorter list chosen for this screen. Most are kinds of hold; one — drop off only — asks a bus to spend less time at a stop rather than more."
      >
        <ul className="space-y-2">
          {engineActions.map((action) => (
            <li key={action} className="ops-well px-4 py-3 text-sm">
              <span className="font-medium text-foreground">{actionLabel(action)}</span>
              <p className="mt-1 text-xs leading-relaxed text-subtle">
                {action === 'boarding_limit'
                  ? 'Suggested when a bus has another right behind it: letting people off but taking none on cuts its stop time so it can recover, and the bus behind picks up who was left. Proposed for a human to weigh, never chosen automatically.'
                  : 'Suggested by the recommendation engine when buses close up, approved and sent in the control room, and delivered to the driver’s screen. This one genuinely reaches a driver and is genuinely recorded.'}
              </p>
            </li>
          ))}
        </ul>
      </OpsSection>

      {/*
        Worked out, but with nowhere to go. This section exists because the
        two-way split above it was a lie by omission: the engine has computed
        pace guidance on every solve since it shipped, so listing it under
        "nothing suggests" was false — but listing it with the engine actions
        above would have inherited their promise that an instruction is
        approved, sent, and delivered to the driver's screen. Pace guidance
        has no delivery path in this system at all.
      */}
      {advisoryActions.length > 0 && (
        <OpsSection
          title="Worked out, but with no way to reach a driver"
          description="The engine does the arithmetic for these and shows the answer in the control room. It never ranks them against a hold and never sends one, because this system has no in-cab display to send them to."
        >
          <ul className="space-y-2">
            {advisoryActions.map((action) => (
              <li key={action} className="ops-well px-4 py-3 text-sm">
                <span className="font-medium text-foreground">{actionLabel(action)}</span>
                <p className="mt-1 text-xs leading-relaxed text-subtle">
                  Worked out when a bus is running ahead of its timetable and closing on the bus in
                  front: easing off spends slack it already holds, so the gap reopens and the bus
                  gets closer to its scheduled time instead of later. It is the one lever here that
                  costs no delay to anybody. It reaches a driver only if a control-room operator
                  passes it on themselves, and nothing records whether that happened.
                </p>
              </li>
            ))}
          </ul>
        </OpsSection>
      )}

      <OpsSection
        title="Instructions that exist, but that nothing suggests"
        description="These can be sent, and that is all. Nothing in this system works out when to use one, and sending one changes nothing except the record that it was sent."
      >
        <div className="ops-well px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {humanActions.map((action) => actionLabel(action)).join(' · ')}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            These are real entries in the list of instructions, and a driver would receive one if a
            control-room operator sent it. Nothing works out when to use them, nothing measures
            whether they worked, and no part of the system changes because one was sent. Treat them
            as a way of writing an instruction down, not as a lever the system pulls.
          </p>
        </div>
      </OpsSection>

      <OpsSection title="Not built">
        <OpsStack gap="tight">
          <OpsPanel title="Sending a bus a different way">
            <p className="text-sm text-muted-foreground">
              Does not exist, in any form. There is no diversion, no working out of another route,
              and no way to tell a driver to take a different road. A corridor is a fixed shape
              here.
            </p>
          </OpsPanel>

          <OpsPanel title="Bay and crew clashes">
            <p className="text-sm text-muted-foreground">
              Not built yet. This system holds no bay bookings and no crew duty records, so it
              cannot check for a clash. It shows nothing rather than an answer it made up.
            </p>
          </OpsPanel>
        </OpsStack>
      </OpsSection>
    </OpsStack>
  );
}
