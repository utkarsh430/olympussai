'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert, OpsButton, OpsSection, OpsStack } from '@/components/ops/ui';
import { OpsFleetMapPanel } from '@/components/ops/map/OpsFleetMapPanel';
import { useTheme } from '@/components/theme/ThemeProvider';
import { buildConsoleKpi, type ControlRoomOverview } from '@/lib/ops/controlRoomOverviewModel';
import { corridorName } from '@/lib/ops/vocabulary';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import { ApprovalQueuePanel } from '@/components/ops/ApprovalQueuePanel';
import { ControlRoomCommandForm, type CommandPrefill } from '../ControlRoomCommandForm';
import { CommandLookupPanel } from '../CommandLookupPanel';
import { KillSwitchPanel } from '../KillSwitchPanel';
import { ActiveIncidentsPanel } from '../ActiveIncidentsPanel';
import { IncidentCopilotPanel } from '../IncidentCopilotPanel';
import { CopilotQueryBox } from '../CopilotQueryBox';
import { CorridorPicker } from '../CorridorPicker';
import { ConsoleKpiStrip } from './ConsoleKpiStrip';
import { EngineRecommendationPanel } from './EngineRecommendationPanel';
import { useControlRoomFeed } from './useControlRoomFeed';
// A plain sibling module with no 'use client', because the page above is a
// Server Component and needs `isConsoleTab`. See consoleTabs.ts for the 500
// that taught us to keep it there.
import { TAB_HINT, TAB_LABEL, TAB_ORDER, type ConsoleTabId } from './consoleTabs';

/**
 * The control room, as one console.
 *
 * ─── THE SHAPE, AND WHY ──────────────────────────────────────────────────
 *
 * A permanent map with a working rail beside it, in a shell that does not
 * scroll. The map is the one thing that must never scroll away: it is the only
 * surface on which "these two buses have closed up" is a shape rather than a
 * number, and an operator who has to scroll to see it will stop looking. So
 * the map holds the frame and everything else takes turns in the rail.
 *
 * The rail is TABBED rather than stacked for the same reason. Stacked, the six
 * working surfaces make a two-metre column, and the approval queue — which is
 * time-critical — sits below the fold behind whatever happens to be above it.
 * Tabbed, each is one click away and the ones that need attention SAY SO from
 * the tab strip: approvals waiting, buses closing up and corridors with
 * instructions stopped are counted on their tabs, so nothing important is
 * hidden merely because it is not the open panel.
 *
 * ─── WHAT THIS PASS CHANGED ──────────────────────────────────────────────
 *
 * Three journey defects, none of them a redesign of the shape above:
 *
 *   1. IT OPENED ON A BLANK CORRIDOR. The default was the first corridor the
 *      control service listed, which on the live network has no planned gap —
 *      so a new operator's first sight of the control room was six dashes and
 *      a paragraph explaining them. The default now prefers a corridor that
 *      can actually report. See `defaultRouteDirectionId` in
 *      src/lib/controlService/observabilityData.ts.
 *
 *   2. THE CORRIDOR PICKER WAS 759 UNSEARCHABLE OPTIONS. See CorridorPicker.
 *
 *   3. THE TAB LABELS NAMED INTERNAL CONCEPTS, not the panels behind them.
 *      See consoleTabs.ts, which also carries the one-line hint now rendered
 *      under the strip for whichever tab is open.
 *
 * ─── WHAT MOVED IN, AND WHAT DELIBERATELY DID NOT ────────────────────────
 *
 * Observability and the assistant fold in. Their content is this content: the
 * gap figures belong in the band above the map an operator is already
 * watching, the list of buses closing up belongs beside the same incidents
 * drawn ON that map, and an assistant whose job is explaining what is on
 * screen should not require leaving the screen. Two surfaces showing the same
 * gap figure is how an operator ends up reading the stale one.
 *
 * Pilot staging stays its own page. It answers a different question on a
 * different clock — how is the rollout going, day over day — and its incident
 * review and permission gates are retrospective work, not something done while
 * watching buses. Only its live-relevant numbers come forward into the band.
 *
 * Both sub-pages remain routed and guarded exactly as they were.
 */

export interface ControlRoomConsoleProps {
  email: string;
  /** First status-band reading, taken during the server render so the band is never blank on arrival. */
  initialOverview: ControlRoomOverview | null;
  /** Non-null when the server-side read itself failed; the console still mounts and polls. */
  initialOverviewError: string | null;
  initialActiveKillSwitches: KillSwitchRecord[];
  initialTab: ConsoleTabId;
  /**
   * The fleet search and table, rendered on the SERVER and handed in as a
   * node. The fleet is thousands of rows filtered server-side by `?q=`;
   * shipping it through this client component to filter in the browser would
   * put the whole statewide roster in the page payload for no gain.
   */
  fleetPanel: ReactNode;
  /** Breakdown reports, likewise composed by the page. */
  reportsPanel: ReactNode;
}

export function ControlRoomConsole({
  email,
  initialOverview,
  initialOverviewError,
  initialActiveKillSwitches,
  initialTab,
  fleetPanel,
  reportsPanel,
}: ControlRoomConsoleProps) {
  const [tab, setTab] = useState<ConsoleTabId>(initialTab);
  // Corridor is CLIENT state, not a URL navigation. Every poll keys off it, and
  // a navigation would tear down and remount the map on every corridor change -
  // losing the operator's camera and re-initialising Google Maps mid-shift.
  const [corridor, setCorridor] = useState<string | null>(
    initialOverview?.selectedRouteDirectionId ?? null,
  );
  const [commandPrefill, setCommandPrefill] = useState<CommandPrefill | undefined>(undefined);
  // The basemap is a JS style array, not CSS, so it cannot follow the theme
  // through a class the way every other surface here does. OpsFleetMap takes
  // it as an opt-in prop precisely so one console moving does not move the
  // others; this is the control room opting in. Without it the wall display —
  // the largest map in the product — renders a light console over a black map.
  const { resolved: basemapTheme } = useTheme();

  const feed = useControlRoomFeed({ initialOverview, routeDirectionId: corridor });
  const overview = feed.overview;

  const kpi = useMemo(() => (overview ? buildConsoleKpi(overview) : null), [overview]);

  const ageSeconds = overview
    ? Math.max(0, Math.round((feed.now - Date.parse(overview.fetchedAt)) / 1000))
    : null;

  const pendingApprovalCount = feed.approvals.filter(
    (approval) => approval.decision === 'pending',
  ).length;
  const incidentCount = overview?.observability.ok ? overview.incidents.length : null;
  const killSwitchCount = overview?.killSwitches.ok ? overview.killSwitches.active.length : null;

  const selectedCorridor =
    overview?.routeDirections.find((rd) => rd.routeDirectionId === corridor) ?? null;

  const prefillFromEngine = useCallback((prefill: CommandPrefill) => {
    setCommandPrefill(prefill);
    setTab('approvals');
  }, []);

  const prefillFromQueue = useCallback((dispatcherActionId: string) => {
    setCommandPrefill({ dispatcherActionId });
    setTab('approvals');
    // The queue and the form are in the same panel; this keeps the existing
    // approve-then-issue flow's scroll behaviour intact now that the panel
    // scrolls inside the rail rather than with the page.
    //
    // Feature-detected rather than called outright. `scrollIntoView` is a
    // convenience here, and an environment without it (jsdom, and older
    // embedded browsers) must not take the approve-to-issue flow down with it -
    // the form is already filled and usable by the time this runs.
    requestAnimationFrame(() => {
      const form = document.getElementById('control-room-command-form');
      if (typeof form?.scrollIntoView === 'function') {
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, []);

  const badges: Partial<
    Record<ConsoleTabId, { count: number | null; tone: 'default' | 'warn' | 'critical' }>
  > = {
    approvals: { count: pendingApprovalCount, tone: pendingApprovalCount > 0 ? 'warn' : 'default' },
    decisions: { count: incidentCount, tone: (incidentCount ?? 0) > 0 ? 'critical' : 'default' },
    safety: { count: killSwitchCount, tone: (killSwitchCount ?? 0) > 0 ? 'critical' : 'default' },
  };

  return (
    <OpsShell
      title="Control Room"
      email={email}
      role="control_room"
      variant="full"
      subtitle={corridorSubtitle(overview, corridor)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {overview && overview.routeDirections.length > 0 && (
            <div className="w-[15rem]">
              <CorridorPicker
                corridors={overview.routeDirections}
                value={corridor}
                onChange={setCorridor}
                labelHidden
              />
            </div>
          )}
          <OpsButton
            variant="quiet"
            aria-pressed={feed.paused}
            onClick={() => feed.setPaused(!feed.paused)}
            title={
              feed.paused
                ? 'Start updating every 15 seconds again'
                : 'Keep the figures on screen as they are'
            }
          >
            {feed.paused ? 'Resume' : 'Pause'}
          </OpsButton>
          <OpsButton variant="quiet" onClick={feed.refreshNow}>
            Update now
          </OpsButton>
        </div>
      }
      statusStrip={
        kpi ? (
          <ConsoleKpiStrip
            model={kpi}
            fetchedAt={overview?.fetchedAt ?? null}
            ageSeconds={ageSeconds}
            paused={feed.paused}
          />
        ) : (
          <p className="px-6 py-3 text-xs text-muted-foreground">
            {initialOverviewError ?? 'Taking the first readings…'}
          </p>
        )
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:flex-row lg:overflow-hidden">
        <section
          aria-label="Map of the fleet"
          className="flex min-h-[24rem] shrink-0 flex-col lg:min-h-0 lg:min-w-0 lg:flex-1 lg:shrink"
        >
          <OpsFleetMapPanel
            // Null, not []: this console deliberately takes no server-side
            // vehicle read (the statewide roster is thousands of rows and does
            // not belong in the page payload), so the count is UNKNOWN until
            // the first poll lands. Seeded as an empty array it captioned
            // itself "all depots · 0 vehicles" beside a status band reporting
            // 9,181 - two numbers from the same console disagreeing on arrival.
            vehicles={null}
            incidents={overview?.incidents ?? []}
            scopeLabel="all depots"
            routeDirectionId={corridor ?? undefined}
            live
            fill
            minHeight="24rem"
            basemapTheme={basemapTheme}
          />
        </section>

        <aside
          aria-label="Control room tools"
          className="flex min-h-0 w-full flex-col lg:w-[30rem] lg:shrink-0 xl:w-[34rem]"
        >
          <nav aria-label="Console sections" className="shrink-0">
            <ul className="flex flex-wrap gap-1 border-b border-border pb-2">
              {TAB_ORDER.map((id) => {
                const badge = badges[id];
                const isCurrent = id === tab;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-current={isCurrent ? 'true' : undefined}
                      data-testid={`console-tab-${id}`}
                      onClick={() => setTab(id)}
                      // Tightened from the nav's default spacing so all six sit
                      // on one row at the rail's width.
                      className={`ops-nav-link rounded px-2 py-1.5 text-[10px] tracking-[0.06em] ${
                        isCurrent ? 'ops-nav-link-active' : ''
                      }`}
                    >
                      {TAB_LABEL[id]}
                      {badge && badge.count !== null && badge.count > 0 && (
                        <span
                          className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
                            badge.tone === 'critical'
                              ? 'bg-destructive/20 text-destructive'
                              : 'bg-warning/20 text-warning'
                          }`}
                        >
                          {badge.count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* The tab strip has room for six short labels and not for six
                explanations, so the open one explains itself here. Without it
                a shortened label buys clarity on the strip and loses it in the
                panel. */}
            <p className="px-1 pt-2 text-[11px] leading-snug text-subtle">{TAB_HINT[tab]}</p>
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto pt-4 lg:pr-1">
            {feed.overviewError && (
              <OpsAlert tone="warning" className="mb-4">
                {feed.overviewError} The figures above are the last ones taken.
              </OpsAlert>
            )}

            {tab === 'decisions' && (
              <OpsStack gap="tight">
                <EngineRecommendationPanel
                  routeDirectionId={corridor}
                  result={feed.recommendation}
                  loading={feed.recommendationLoading}
                  error={feed.recommendationError}
                  approvals={feed.approvals}
                  now={feed.now}
                  onPrefillCommandForm={prefillFromEngine}
                  onIssued={feed.refreshNow}
                  onRefresh={feed.refreshNow}
                />
                <OpsSection
                  title="Buses closing up on this corridor"
                  description="Found automatically by the gap check, and drawn on the map beside this."
                >
                  {/* Two different reasons the list is not a list, and they
                      must not share a message. "Did not answer" is an outage;
                      "no planned gap" is the control service answering that it
                      cannot check this corridor, which is a fact about the
                      corridor rather than a fault in the system. */}
                  {overview?.observability.noActivePolicy === true ? (
                    <OpsAlert tone="info">
                      No planned gap has been set for this corridor, so buses closing up cannot be
                      checked here and nothing can be raised. This is the control service reporting
                      its own settings, not a failure to reach it.
                    </OpsAlert>
                  ) : overview?.observability.ok === false ? (
                    <OpsAlert tone="error">
                      The control service did not answer, so this list is unknown — not empty.
                    </OpsAlert>
                  ) : (
                    <ActiveIncidentsPanel
                      incidents={overview?.incidents ?? []}
                      canDetect={selectedCorridor?.hasActivePolicy}
                    />
                  )}
                </OpsSection>
              </OpsStack>
            )}

            {tab === 'approvals' && (
              <OpsStack gap="tight">
                <OpsSection
                  title="Waiting for a decision"
                  description="Everything dispatchers have asked for, including the holds the engine has suggested. The dispatcher's own screen shows a shorter list."
                >
                  {feed.approvalsError && (
                    <OpsAlert tone="warning" className="mb-3">
                      {feed.approvalsError}
                    </OpsAlert>
                  )}
                  <ApprovalQueuePanel
                    canDecide
                    disruptiveOnly={false}
                    refreshToken={feed.refreshToken}
                    onApprove={prefillFromQueue}
                  />
                </OpsSection>
                <OpsSection title="Send an instruction to a driver">
                  <ControlRoomCommandForm
                    prefill={commandPrefill}
                    onIssued={feed.refreshNow}
                    corridors={overview?.routeDirections ?? []}
                    defaultRouteDirectionId={corridor}
                  />
                </OpsSection>
                <OpsSection
                  title="Find an instruction you have sent"
                  description="Whether it reached the driver, what they answered, and its full record."
                >
                  <CommandLookupPanel />
                </OpsSection>
              </OpsStack>
            )}

            {tab === 'fleet' && fleetPanel}

            {tab === 'copilot' && (
              <OpsStack gap="tight">
                <OpsSection
                  title="Explain what happened"
                  description="Based only on the evidence already recorded for that incident. It never sends anything."
                >
                  <IncidentCopilotPanel incidents={overview?.incidents ?? []} />
                </OpsSection>
                <OpsSection title="Ask about this corridor">
                  <CopilotQueryBox routeDirectionId={corridor} />
                </OpsSection>
                <p className="text-[11px] leading-relaxed text-subtle">
                  Shift reports are on the{' '}
                  <a className="text-primary hover:underline" href="/ops/control-room/copilot">
                    assistant page
                  </a>{' '}
                  — they are end-of-shift paperwork, not something written while watching the map.
                </p>
              </OpsStack>
            )}

            {tab === 'safety' && (
              <OpsSection
                title="Stop new instructions"
                description="Stops any new instruction being sent, across the whole state or on one corridor. Instructions already sent still stand. Turning it on or off is recorded against your name and needs a reason."
              >
                <KillSwitchPanel
                  initialActive={initialActiveKillSwitches}
                  refreshToken={feed.refreshToken}
                  corridors={overview?.routeDirections ?? []}
                  defaultRouteDirectionId={corridor}
                />
              </OpsSection>
            )}

            {tab === 'reports' && reportsPanel}
          </div>
        </aside>
      </div>
    </OpsShell>
  );
}

/**
 * The one line under the page title, and the only place both populations are
 * named together.
 *
 * "Whole state · corridor 1002 outbound" rather than "Statewide fleet ·
 * corridor 1002 OUT": the direction code is expanded because `OUT` is not a
 * word, and the two halves stay visibly separate because the numbers in the
 * band above describe two different populations.
 */
function corridorSubtitle(overview: ControlRoomOverview | null, corridor: string | null): string {
  if (!overview || corridor === null) return 'Whole state · no corridor chosen';
  const meta = overview.routeDirections.find((rd) => rd.routeDirectionId === corridor);
  return meta ? `Whole state · corridor ${corridorName(meta)}` : 'Whole state';
}
