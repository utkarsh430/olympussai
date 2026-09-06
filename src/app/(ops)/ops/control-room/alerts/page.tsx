import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert } from '@/components/ops/ui';
import { AlertInbox } from '@/components/ops/control-room/alerts/AlertInbox';
import { OccupancyToggle } from '@/components/ops/control-room/alerts/OccupancyToggle';
import { readAlertFeed } from '@/lib/controlService/alerts';
import {
  isStandingProposalFeedEnabled,
  readStandingProposals,
} from '@/lib/controlService/standingProposals';
import { StandingProposalsPanel } from '@/components/ops/control-room/recommendations/StandingProposalsPanel';
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
      <StandingProposals />
      <ControllerSettings />
    </OpsShell>
  );
}

/**
 * What the automatic decision cycle proposed, on the page where an operator is
 * already looking at what is wrong.
 *
 * ─── WHY IT BELONGS HERE ─────────────────────────────────────────────────
 *
 * The list above says what IS wrong. This one says what the controller would
 * DO about it — and until now nobody could see that at all. control-service's
 * decision cycle has solved every eligible corridor every 90 seconds since it
 * landed and written a `recommendations` row each time, and nothing read that
 * table: no route served it and no console fetched it. Every proposal a
 * dispatcher ever saw came from the live solve taken when they opened a
 * corridor themselves, which is the exact problem the automatic cycle exists
 * to remove. Its output was written and discarded.
 *
 * Placed BELOW the alerts and above the settings. It is the second question an
 * operator asks, never the first, and it must not be mistaken for a second
 * alert feed: an empty proposal list is not an all-clear, and the list it sits
 * under is what actually answers "is anything wrong anywhere".
 *
 * ─── BEHIND A FLAG, DEFAULT OFF, AND OFF RENDERS NOTHING ─────────────────
 *
 * Not "renders an empty panel" — returns null before any read is attempted, so
 * with `RECOMMENDATION_FEED_ENABLED` unset this page is byte-identical to what
 * it was, takes the same one upstream read it always took, and the control
 * service does not mount its endpoint either.
 *
 * Its own error boundary, like the toggle below: an unreachable control
 * service must cost this panel and not the alert list.
 */
async function StandingProposals() {
  if (!isStandingProposalFeedEnabled()) return null;

  try {
    const { feed, stale, ageMs } = await readStandingProposals();
    return <StandingProposalsPanel initialFeed={{ ...feed, stale, ageMs }} />;
  } catch {
    // `initialFeed={null}` is NOT an empty list. The panel renders the two
    // differently, because an empty list here reads as "the controller has
    // nothing to say" and an unreadable one means nobody knows what it said.
    return (
      <StandingProposalsPanel
        initialFeed={null}
        initialError="The control service did not answer, so what the automatic controller has proposed is unknown - not nothing."
      />
    );
  }
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
