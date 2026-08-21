import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert } from '@/components/ops/ui';
import { AlertInbox } from '@/components/ops/control-room/alerts/AlertInbox';
import { OccupancyToggle } from '@/components/ops/control-room/alerts/OccupancyToggle';
import { readAlertFeed } from '@/lib/controlService/alerts';
import { readControlSettings } from '@/lib/controlService/settings';

export const dynamic = 'force-dynamic';

/**
 * The alert section: every bus pair on the network that is bunched, or
 * heading that way.
 *
 * ─── WHY THIS PAGE EXISTS ────────────────────────────────────────────────
 *
 * Bunching detection has run on a timer since the core data model, over every
 * eligible corridor, writing `bunching_incidents` rows the whole time. The
 * product's only way to SEE one was the console's per-corridor panel — which
 * shows an operator what is wrong with the corridor they have already picked.
 * Across ~1,020 active route-directions that made noticing a matter of luck.
 *
 * Nested under /ops/control-room so it inherits that segment's
 * `requireOpsRolePage('control_room', ...)` guard from layout.tsx, like the
 * observability page beside it.
 *
 * ─── THE READ IS TAKEN ON THE SERVER, ONCE ───────────────────────────────
 *
 * The first feed is fetched here so the page arrives with alerts already on
 * it rather than blank-then-populated. A control room's screen is looked at
 * from across a room; a list that starts empty and fills a second later reads
 * as "nothing is wrong" for exactly as long as it takes someone to glance
 * away. The client component takes over the refresh clock from there.
 */
export default async function AlertsPage() {
  // The session comes from the guard itself rather than a second, independent
  // resolution of it — see the sibling observability page for why that
  // distinction turned into an HTTP 500 when the two disagreed.
  const session = await requireOpsRolePage('control_room', '/ops/control-room/alerts');

  return (
    <OpsShell
      title="Alerts"
      email={session.email}
      role="control_room"
      variant="wide"
      subtitle="Every corridor where buses are bunched, or closing in on each other"
    >
      <AlertsBody />
      <ControllerSettings />
    </OpsShell>
  );
}

/**
 * The switch that decides what the engine is optimising, on the page where an
 * operator is looking at the consequences.
 *
 * Placed BELOW the alert list rather than above it. It is read occasionally
 * and changed almost never, while the list is the reason anyone opened this
 * page; putting a settings panel first would put the rarely-used control in
 * the position the eye lands on. It belongs here rather than on a separate
 * settings screen because its effect is visible in the list right above it -
 * turn occupancy weighting on with an uncalibrated arrival rate and the
 * proposals stop appearing, which is a thing to discover on the same screen
 * rather than two clicks away.
 *
 * Its own error boundary, so an unreachable control service costs the toggle
 * and not the alert list.
 */
async function ControllerSettings() {
  try {
    return <OccupancyToggle initialSettings={await readControlSettings()} />;
  } catch {
    // `initialSettings={null}` renders "the current setting is unknown",
    // which is deliberately NOT the same as rendering it as off.
    return (
      <OccupancyToggle
        initialSettings={null}
        initialError="The control service could not be reached, so the current setting could not be read."
      />
    );
  }
}

/**
 * See the dispatcher dashboard's DashboardBody for why this boundary exists:
 * an unexpected error here must render an inline message, never take down the
 * guard and navigation chrome around it.
 */
async function AlertsBody() {
  try {
    const { feed, stale, ageMs } = await readAlertFeed();
    return <AlertInbox initialFeed={{ ...feed, stale, ageMs }} />;
  } catch {
    // `initialFeed={null}` is NOT an empty list, and AlertInbox renders the
    // two differently on purpose. An alert surface that shows "no alerts"
    // when it actually failed to read is the single most dangerous thing this
    // page could do.
    return (
      <>
        <OpsAlert tone="warning" title="The alert feed could not be read">
          The control service did not answer, so what is happening on the network is unknown right
          now — not clear. The list below will fill in as soon as it can be reached.
        </OpsAlert>
        <AlertInbox initialFeed={null} />
      </>
    );
  }
}
