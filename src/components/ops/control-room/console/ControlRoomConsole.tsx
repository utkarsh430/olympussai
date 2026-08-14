'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert, OpsButton, OpsSection, OpsStack } from '@/components/ops/ui';
import { OpsFleetMapPanel } from '@/components/ops/map/OpsFleetMapPanel';
import { buildConsoleKpi, type ControlRoomOverview } from '@/lib/ops/controlRoomOverviewModel';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import { ApprovalQueuePanel } from '@/components/ops/ApprovalQueuePanel';
import { ControlRoomCommandForm, type CommandPrefill } from '../ControlRoomCommandForm';
import { CommandLookupPanel } from '../CommandLookupPanel';
import { KillSwitchPanel } from '../KillSwitchPanel';
import { ActiveIncidentsPanel } from '../ActiveIncidentsPanel';
import { IncidentCopilotPanel } from '../IncidentCopilotPanel';
import { CopilotQueryBox } from '../CopilotQueryBox';
import { ConsoleKpiStrip } from './ConsoleKpiStrip';
import { EngineRecommendationPanel } from './EngineRecommendationPanel';
import { useControlRoomFeed } from './useControlRoomFeed';
// A plain sibling module with no 'use client', because the page above is a
// Server Component and needs `isConsoleTab`. See consoleTabs.ts for the 500
// that taught us to keep it there.
import { TAB_LABEL, TAB_ORDER, type ConsoleTabId } from './consoleTabs';

/**
 * The control room, as one console.
 *
 * ─── WHAT THIS REPLACED ──────────────────────────────────────────────────
 *
 * A `max-w-3xl` column: a kill-switch panel, a 25-row fleet table, an approval
 * queue, a command form in which an operator hand-typed an action type and two
 * uuids, and three links away to other pages. Everything in it worked. It read
 * as a settings page for a system whose actual job is watching 9,170 buses
 * move.
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
 * working surfaces below make a two-metre column, and the approval queue —
 * which is time-critical — sits below the fold behind whatever happens to be
 * above it. Tabbed, each is one click away and the ones that need attention
 * SAY SO from the tab strip: pending approvals, open incidents and engaged
 * kill switches are counted on their tabs, so nothing important is hidden
 * merely because it is not the active panel.
 *
 * ─── WHAT MOVED IN, AND WHAT DELIBERATELY DID NOT ────────────────────────
 *
 * Observability and the copilot fold in. Their content is this content: the
 * headway/EWT/CV numbers belong in the band above the map an operator is
 * already watching, the incident list belongs beside the incidents drawn ON
 * that map, and a copilot whose job is explaining what is on screen should not
 * require leaving the screen. Two surfaces showing the same headway figure is
 * how an operator ends up reading the stale one.
 *
 * Pilot staging stays its own page. It answers a different question on a
 * different clock — how is the rollout going, day over day — and its war-room
 * review and rollout gates are retrospective work, not something done while
 * watching buses. Only its live-relevant numbers (today's recovery rate and
 * guardrail breaches) come forward into the band.
 *
 * Both sub-pages remain routed and guarded exactly as they were. Folding the
 * content in is an addition; deleting a working screen mid-phase would be a
 * regression dressed as tidiness, and the per-pair headway detail on
 * observability genuinely has no home here.
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
  const [corridor, setCorridor] = useState<string | null>(initialOverview?.selectedRouteDirectionId ?? null);
  const [commandPrefill, setCommandPrefill] = useState<CommandPrefill | undefined>(undefined);

  const feed = useControlRoomFeed({ initialOverview, routeDirectionId: corridor });
  const overview = feed.overview;

  const kpi = useMemo(
    () => (overview ? buildConsoleKpi(overview) : null),
    [overview],
  );

  const ageSeconds = overview ? Math.max(0, Math.round((feed.now - Date.parse(overview.fetchedAt)) / 1000)) : null;

  const pendingApprovalCount = feed.approvals.filter((approval) => approval.decision === 'pending').length;
  const incidentCount = overview?.observability.ok ? overview.incidents.length : null;
  const killSwitchCount = overview?.killSwitches.ok ? overview.killSwitches.active.length : null;

  const prefillFromEngine = useCallback(
    (prefill: CommandPrefill) => {
      setCommandPrefill(prefill);
      setTab('approvals');
    },
    [],
  );

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

  const badges: Partial<Record<ConsoleTabId, { count: number | null; tone: 'default' | 'warn' | 'critical' }>> = {
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
      subtitle={corridorLabel(overview, corridor)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <CorridorPicker overview={overview} value={corridor} onChange={setCorridor} />
          <OpsButton
            variant="quiet"
            aria-pressed={feed.paused}
            onClick={() => feed.setPaused(!feed.paused)}
            title={feed.paused ? 'Resume the 15-second refresh' : 'Hold the current readings on screen'}
          >
            {feed.paused ? 'Resume' : 'Hold'}
          </OpsButton>
          <OpsButton variant="quiet" onClick={feed.refreshNow}>
            Refresh
          </OpsButton>
        </div>
      }
      statusStrip={
        kpi ? (
          <ConsoleKpiStrip model={kpi} fetchedAt={overview?.fetchedAt ?? null} ageSeconds={ageSeconds} paused={feed.paused} />
        ) : (
          <p className="px-6 py-3 text-xs text-ops-muted">
            {initialOverviewError ?? 'Taking the first readings…'}
          </p>
        )
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:flex-row lg:overflow-hidden">
        <section
          aria-label="Fleet map"
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
          />
        </section>

        <aside
          aria-label="Operations controls"
          className="flex min-h-0 w-full flex-col lg:w-[30rem] lg:shrink-0 xl:w-[34rem]"
        >
          <nav aria-label="Console sections" className="shrink-0">
            <ul className="flex flex-wrap gap-1 border-b border-ops-line pb-2">
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
                      // on one row at the rail's width. Wrapped, the sixth tab
                      // dropped alone onto a second line and read like an
                      // afterthought rather than a peer of the other five.
                      className={`ops-nav-link rounded px-2 py-1.5 text-[10px] tracking-[0.1em] ${
                        isCurrent ? 'ops-nav-link-active' : ''
                      }`}
                    >
                      {TAB_LABEL[id]}
                      {badge && badge.count !== null && badge.count > 0 && (
                        <span
                          className={`ml-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            badge.tone === 'critical'
                              ? 'bg-alert-crimson/20 text-ops-danger'
                              : 'bg-alert-amber/20 text-ops-warn'
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
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto pt-4 lg:pr-1">
            {feed.overviewError && (
              <OpsAlert tone="warning" className="mb-4">
                {feed.overviewError} The readings above are the last ones taken.
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
                  title="Open incidents on this corridor"
                  description="Detected automatically by the headway sweep, and drawn on the map beside this."
                >
                  {/* Two different reasons the list is not a list, and they
                      must not share a message. "Did not answer" is an outage;
                      "no active policy" is the control service answering that
                      detection is off for this corridor, which is a fact about
                      the corridor rather than a fault in the system. */}
                  {overview?.observability.noActivePolicy === true ? (
                    <OpsAlert tone="info">
                      This corridor has no active headway policy, so the bunching detector does not run on it and no
                      incidents can be raised. This is the control service reporting its own configuration, not a
                      failure to reach it.
                    </OpsAlert>
                  ) : overview?.observability.ok === false ? (
                    <OpsAlert tone="error">
                      The control service did not answer, so the incident list is unknown — not empty.
                    </OpsAlert>
                  ) : (
                    <ActiveIncidentsPanel incidents={overview?.incidents ?? []} />
                  )}
                </OpsSection>
              </OpsStack>
            )}

            {tab === 'approvals' && (
              <OpsStack gap="tight">
                <OpsSection
                  title="Approval queue"
                  description="Every pending dispatcher approval, including the holds the engine proposes — those are not in the disruptive-action subset the dispatcher view filters to."
                >
                  {feed.approvalsError && <OpsAlert tone="warning" className="mb-3">{feed.approvalsError}</OpsAlert>}
                  <ApprovalQueuePanel
                    canDecide
                    disruptiveOnly={false}
                    refreshToken={feed.refreshToken}
                    onApprove={prefillFromQueue}
                  />
                </OpsSection>
                <OpsSection title="Issue a command">
                  <ControlRoomCommandForm prefill={commandPrefill} onIssued={feed.refreshNow} />
                </OpsSection>
                <OpsSection
                  title="Command lookup"
                  description="Follow a command already issued: delivery, the driver's acknowledgement and its audit trail."
                >
                  <CommandLookupPanel />
                </OpsSection>
              </OpsStack>
            )}

            {tab === 'fleet' && fleetPanel}

            {tab === 'copilot' && (
              <OpsStack gap="tight">
                <OpsSection
                  title="Explain an incident"
                  description="Grounded in the stored incident evidence. It never issues anything."
                >
                  <IncidentCopilotPanel incidents={overview?.incidents ?? []} />
                </OpsSection>
                <OpsSection title="Ask about this corridor">
                  <CopilotQueryBox routeDirectionId={corridor} />
                </OpsSection>
                <p className="text-[11px] leading-relaxed text-ops-faint">
                  Shift reports are on the{' '}
                  <a className="text-holo-glow hover:underline" href="/ops/control-room/copilot">
                    copilot page
                  </a>{' '}
                  — they are end-of-shift paperwork, not something written while watching the map.
                </p>
              </OpsStack>
            )}

            {tab === 'safety' && (
              <OpsSection
                title="Kill switches"
                description="Halt new commands network-wide or for one corridor. Every engage and disengage is attributed and needs a reason."
              >
                <KillSwitchPanel initialActive={initialActiveKillSwitches} refreshToken={feed.refreshToken} />
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
 * Corridor selection, as client state.
 *
 * Deliberately not the zero-JS GET form the observability page uses. There, a
 * navigation per change is right; here it would remount the map. The corridor
 * chosen is what the engine solves, what the headway band describes and what
 * the map enriches with control-service positions — so it changes often, and
 * changing it must be cheap.
 */
function CorridorPicker({
  overview,
  value,
  onChange,
}: {
  overview: ControlRoomOverview | null;
  value: string | null;
  onChange: (routeDirectionId: string) => void;
}) {
  const routeDirections = overview?.routeDirections ?? [];
  if (routeDirections.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="console-corridor" className="ops-eyebrow">
        Corridor
      </label>
      <select
        id="console-corridor"
        className="ops-input max-w-[16rem] py-1 text-xs"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {routeDirections.map((rd) => (
          <option key={rd.routeDirectionId} value={rd.routeDirectionId}>
            {rd.routeId} · {rd.directionCode}
            {rd.isLoop ? ' (loop)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function corridorLabel(overview: ControlRoomOverview | null, corridor: string | null): string {
  if (!overview || corridor === null) return 'Statewide · no corridor selected';
  const meta = overview.routeDirections.find((rd) => rd.routeDirectionId === corridor);
  return meta ? `Statewide fleet · corridor ${meta.routeId} ${meta.directionCode}` : 'Statewide fleet';
}
