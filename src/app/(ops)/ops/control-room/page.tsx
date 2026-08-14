import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert } from '@/components/ops/ui';
import { getOpsFleetSnapshot } from '@/lib/ops/fleetData';
import { OPS_FLEET_SCOPE_ALL } from '@/lib/ops/depotScope';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { getControlRoomOverview } from '@/lib/ops/controlRoomOverview';
import { BreakdownReportsPanel } from '@/components/ops/BreakdownReportsPanel';
import { ControlRoomFleetPanel } from '@/components/ops/control-room/ControlRoomFleetPanel';
import { OpsSection } from '@/components/ops/ui';
import { ControlRoomConsole } from '@/components/ops/control-room/console/ControlRoomConsole';
// From the plain tab module, NOT from ControlRoomConsole. That component
// carries 'use client', and a value imported out of it here is a
// client-reference proxy rather than the function - calling it threw on every
// single render and made this page a hard 500. See consoleTabs.ts, and
// scripts/lib/clientBoundary.ts for the check that now fails the build on it.
import {
  isConsoleTab,
  type ConsoleTabId,
} from '@/components/ops/control-room/console/consoleTabs';

export const dynamic = 'force-dynamic';

/**
 * The control room.
 *
 * The page's job is narrow on purpose: prove the operator's role, take the
 * first reading of everything the console shows, and render the two panels
 * that are better off staying on the server. ControlRoomConsole owns the
 * layout, the refresh clock and every interaction from there.
 *
 * WHY THE SERVER-RENDERED PANELS ARE PASSED AS NODES. The fleet roster and the
 * breakdown-report table are handed to the client console as `ReactNode`s.
 * That keeps the roster's thousands of rows and its server-side `?q=`
 * filtering on the server, where they belong, while still letting a client
 * component decide when they are on screen. Passing them as props is what
 * makes that possible - a client component cannot import a server one, but it
 * can render one it was given.
 */
export default async function ControlRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; routeDirectionId?: string }>;
}) {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('control_room', '/ops/control-room');
  const { q, tab, routeDirectionId } = await searchParams;

  return (
    <ConsoleBody
      email={session.email}
      query={q ?? ''}
      // A `tab` that is not one of the console's own falls back rather than
      // rendering an empty rail, so a stale bookmark degrades to the default
      // view instead of a blank panel.
      tab={isConsoleTab(tab) ? tab : 'decisions'}
      routeDirectionId={routeDirectionId}
    />
  );
}

/**
 * See src/app/(ops)/ops/dispatcher/page.tsx's DashboardBody for why this
 * boundary exists. Unlike the dispatcher/depot read, control-room's own
 * kill-switch list is load-bearing for this page's own engage/disengage panel
 * (KillSwitchPanel needs a real starting list, not a silently-empty one) — an
 * OpsDbConfigError here correctly falls into the same unavailable-page state
 * as a fleet-snapshot failure, rather than being swallowed.
 */
async function ConsoleBody({
  email,
  query,
  tab,
  routeDirectionId,
}: {
  email: string;
  query: string;
  tab: ConsoleTabId;
  routeDirectionId?: string;
}) {
  try {
    const [snapshot, activeKillSwitches] = await Promise.all([
      getOpsFleetSnapshot(OPS_FLEET_SCOPE_ALL),
      getOpsRepo().listKillSwitches(true),
    ]);

    // The status band's first reading. It is composed of sources that are each
    // built never to throw, so a failure here is the ops datastore itself -
    // and the console still mounts and polls rather than showing nothing.
    let initialOverview = null;
    let initialOverviewError: string | null = null;
    try {
      initialOverview = await getControlRoomOverview(routeDirectionId);
    } catch (error) {
      initialOverviewError = `The first reading could not be taken (${
        error instanceof Error ? error.message : 'unknown error'
      }). Trying again automatically.`;
    }

    return (
      <ControlRoomConsole
        email={email}
        initialOverview={initialOverview}
        initialOverviewError={initialOverviewError}
        initialActiveKillSwitches={activeKillSwitches}
        initialTab={tab}
        fleetPanel={
          <ControlRoomFleetPanel
            snapshot={snapshot}
            query={query}
            routeDirectionId={initialOverview?.selectedRouteDirectionId ?? routeDirectionId ?? null}
          />
        }
        reportsPanel={
          <OpsSection
            title="Breakdowns reported by drivers"
            description="Filed by drivers from their own console, across the whole fleet."
          >
            <BreakdownReportsPanel scope="fleet" />
          </OpsSection>
        }
      />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <OpsShell title="Control Room" email={email} role="control_room" variant="wide">
        <OpsAlert tone="error">
          The control room&apos;s data could not be read right now ({message}). Try refreshing the
          page.
        </OpsAlert>
      </OpsShell>
    );
  }
}
