'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAlert, OpsStack } from '@/components/ops/ui';
import { OpsFleetMapPanel } from '@/components/ops/map/OpsFleetMapPanel';
import { KillSwitchBanner } from '@/components/ops/KillSwitchBanner';
import { DataSourceNotice } from '@/components/ops/DataSourceNotice';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import type { OpsFleetSnapshot } from '@/lib/ops/fleetData';
import type { DepotConsoleSnapshot } from '@/lib/controlService/depotConsoleData';
import { depotReadingsUnavailable } from '@/lib/ops/depotConsoleModel';
import type { OpsMapVehicle } from '@/lib/ops/mapVehicles';
import type { BunchingIncident } from '@/models/control';
import type { StandbyCandidate } from '@/lib/ops/fleetView';
import { depotCorridorLabel, corridorDetection } from '@/lib/ops/depotCorridors';
import { useTheme } from '@/components/theme/ThemeProvider';
import { DepotStatusStrip } from './DepotStatusStrip';
import { DepotRunningOrderPanel } from './DepotRunningOrderPanel';
import { DepotBunchingPanel } from './DepotBunchingPanel';
import { DepotActionsPanel } from './DepotActionsPanel';
import { DepotStandbyPanel } from './DepotStandbyPanel';
import { DepotSchedulePanel } from './DepotSchedulePanel';
// A plain sibling module with no 'use client', because the page above is a
// Server Component and needs `isDepotTab`. See depotTabs.ts for the 500 that
// taught this codebase to keep it there.
import { DEPOT_TAB_LABEL, DEPOT_TAB_ORDER, type DepotTabId } from './depotTabs';

/**
 * The depot, as one console.
 *
 * ─── WHAT THIS REPLACED ──────────────────────────────────────────────────
 *
 * A single scrolling column: a roster grouped by depot (in a view that is, by
 * construction, one depot), a map, a route-operations board defaulting to an
 * arbitrary statewide corridor, a schedule form, and a placeholder. Every
 * number in it was real. It read as a report someone generated, not as a
 * surface an operator watches for eight hours.
 *
 * ─── THE SHAPE, AND WHY IT MATCHES THE CONTROL ROOM ──────────────────────
 *
 * A permanent map with a tabbed rail beside it, in a shell that does not
 * scroll. That is deliberately the SAME shape as the control room rather than
 * a second invention: the two surfaces are the same product, an operator moves
 * between them, and the design system exists precisely so four dashboards do
 * not become four looks. What differs is what fills the rail, because a depot
 * answers a different question — "what has my depot got out, and is any of it
 * closing up" rather than "what should the network do next".
 *
 * The map must never scroll away, for the reason the control room gives: it is
 * the only surface on which "these two buses have closed up" is a shape rather
 * than a number.
 *
 * ─── CORRIDOR IS A NAVIGATION, NOT CLIENT STATE ──────────────────────────
 *
 * The opposite of the control room's choice, and for a concrete reason rather
 * than inconsistency. There, every reading is refetched by a client poll keyed
 * on the corridor, so a navigation would be pure cost. Here, the running order
 * and the headway pairs are taken during the SERVER render — they are scoped
 * data, and doing that narrowing in the browser is the one thing this page may
 * not do. So changing corridor has to reach the server, and `router.replace`
 * with a search parameter is the honest way to say so: it is a soft navigation
 * that re-runs the server component, keeps the URL shareable and the back
 * button meaningful, and leaves this component mounted so the map instance and
 * the operator's camera survive.
 */
export interface DepotConsoleProps {
  email: string;
  depotLabel: string;
  fleet: OpsFleetSnapshot;
  console: DepotConsoleSnapshot;
  /** Seeded from the page's own scoped read, so the map is populated on first paint. */
  mapVehicles: OpsMapVehicle[];
  incidents: BunchingIncident[];
  /** This depot's vehicles that read as idle on the live feed. Derived server-side from the already-scoped roster. */
  standby: StandbyCandidate[];
  activeKillSwitches: KillSwitchRecord[];
  initialTab: DepotTabId;
  /**
   * The roster and the breakdown-report table, rendered on the SERVER and
   * handed in as nodes. Same reasoning as the control room's fleet panel: a
   * client component cannot import a server one, but it can render one it was
   * given, and the roster's rows have no business being re-derived in the
   * browser on a page whose whole point is a server-side boundary.
   */
  rosterPanel: ReactNode;
  reportsPanel: ReactNode;
}

export function DepotConsole({
  email,
  depotLabel,
  fleet,
  console: snapshot,
  mapVehicles,
  incidents,
  standby,
  activeKillSwitches,
  initialTab,
  rosterPanel,
  reportsPanel,
}: DepotConsoleProps) {
  const [tab, setTab] = useState<DepotTabId>(initialTab);
  const router = useRouter();
  const searchParams = useSearchParams();
  // The basemap is a JS style array, not CSS, so it cannot follow the theme
  // through a class the way every other surface here does. OpsFleetMap takes
  // it as an opt-in prop precisely so one console moving does not move the
  // others; this is the depot opting in. Without it a light depot console
  // renders over a black map.
  const { resolved: basemapTheme } = useTheme();

  const selectCorridor = useCallback(
    (routeDirectionId: string) => {
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      next.set('routeDirectionId', routeDirectionId);
      // `replace`, not `push`: flipping between corridors while watching a
      // depot is browsing, not navigation, and pushing would bury the page an
      // operator arrived from under a stack of corridor changes.
      router.replace(`/ops/depot?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  // Which incident the map is drawing. The map draws ONE (see
  // OpsFleetMapPanel's `selectedIncidentId`) and the bunching tab chooses it.
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  // Derived, not stored: incidents CLOSE now (control-service ends one as soon
  // as its pair stops being a pair), and a corridor change replaces the list
  // wholesale. Either can retire the selected incident while it is still
  // selected, which would leave a mark on the map that nothing in the list can
  // deselect. Reading through the current list means a retired selection
  // simply stops being one.
  const shownIncidentId = useMemo(
    () =>
      selectedIncidentId !== null &&
      incidents.some((incident) => incident.id === selectedIncidentId)
        ? selectedIncidentId
        : null,
    [incidents, selectedIncidentId],
  );

  const selected = snapshot.selectedCorridor;
  const readingsUnavailable = depotReadingsUnavailable(snapshot);
  const openIncidentCount = incidents.length;

  const badges: Partial<Record<DepotTabId, number>> = {
    bunching: openIncidentCount,
  };

  return (
    <OpsShell
      title="Depot"
      email={email}
      role="depot"
      variant="full"
      subtitle={
        selected
          ? `${depotLabel} · corridor ${depotCorridorLabel(selected)}`
          : // "no surveyed corridor in service" is a reading. With nothing read
            // it would be the strip's fabricated zeros restated as a sentence,
            // in the one place on the page an operator reads first.
            readingsUnavailable
            ? `${depotLabel} · corridor readings could not be taken`
            : `${depotLabel} · no surveyed corridor in service`
      }
      actions={<CorridorPicker snapshot={snapshot} onSelect={selectCorridor} />}
      statusStrip={<DepotStatusStrip fleet={fleet} console={snapshot} depotLabel={depotLabel} />}
    >
      {/* No mobile-only `overflow-y-auto`: the shell scrolls now, so a depot
          tablet gets one page scroll rather than a scrollbox nested inside an
          unscrollable page. Same reasoning as the control room's row. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:overflow-hidden">
        <section
          aria-label="Depot fleet map"
          className="flex min-h-[24rem] shrink-0 flex-col lg:min-h-0 lg:min-w-0 lg:flex-1 lg:shrink"
        >
          <OpsFleetMapPanel
            // A real, measured array — never null. Unlike the statewide
            // console, a depot's fleet is small enough to seed, and it was
            // already narrowed server-side, so the count in the caption is a
            // measurement from the moment the page paints.
            vehicles={mapVehicles}
            incidents={incidents}
            selectedIncidentId={shownIncidentId}
            scopeLabel={depotLabel}
            routeDirectionId={selected?.routeDirectionId}
            live
            fill
            minHeight="24rem"
            basemapTheme={basemapTheme}
          />
        </section>

        <aside
          aria-label="Depot controls"
          className="flex min-h-0 w-full flex-col lg:w-[30rem] lg:shrink-0 xl:w-[34rem]"
        >
          <nav aria-label="Depot console sections" className="shrink-0">
            <ul className="flex flex-wrap gap-1 border-b border-border pb-2">
              {DEPOT_TAB_ORDER.map((id) => {
                const isCurrent = id === tab;
                const badge = badges[id];
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-current={isCurrent ? 'true' : undefined}
                      data-testid={`depot-tab-${id}`}
                      onClick={() => setTab(id)}
                      // `whitespace-nowrap` plus tight padding so all six
                      // sections fit one row of the rail at xl. They wrapped
                      // before, orphaning a single tab onto a second line —
                      // which reads as a layout fault rather than as a rail.
                      className={`ops-nav-link whitespace-nowrap rounded px-1.5 py-1.5 text-[10px] tracking-[0.08em] ${
                        isCurrent ? 'ops-nav-link-active' : ''
                      }`}
                    >
                      {DEPOT_TAB_LABEL[id]}
                      {badge !== undefined && badge > 0 && (
                        <span className="ml-1 rounded bg-instrument-danger/15 px-1 py-0.5 text-[10px] tabular-nums text-destructive">
                          {badge}
                          <span className="sr-only"> happening now</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto pt-4 lg:pr-1">
            <OpsStack gap="tight">
              <DataSourceNotice source={fleet.source} stale={fleet.stale} error={fleet.error} />
              <KillSwitchBanner
                activeKillSwitches={activeKillSwitches}
                routeDirectionId={selected?.routeDirectionId ?? null}
              />
              {/* "the last ones taken, OR ABSENT" was one notice covering two
                  different situations, and the reader could not tell which
                  one they were in. They get their own sentences now: one says
                  the numbers on screen are real and old, the other says there
                  are no numbers. */}
              {readingsUnavailable ? (
                <OpsAlert tone="warning">
                  The control service did not answer
                  {snapshot.error ? ` (${snapshot.error})` : ''}, and no earlier reading is held.
                  Every corridor reading on this page is marked{' '}
                  <span className="font-mono">n/a</span> — unknown, not zero. Nothing here says this
                  depot has anything or nothing running.
                </OpsAlert>
              ) : (
                snapshot.source === 'unavailable' && (
                  <OpsAlert tone="warning">
                    The control service could not be read
                    {snapshot.error ? ` (${snapshot.error})` : ''}. The corridor readings below are
                    the last ones that were taken, not current ones.
                  </OpsAlert>
                )
              )}

              {tab === 'running' && <DepotRunningOrderPanel snapshot={snapshot} />}
              {tab === 'bunching' && (
                <DepotBunchingPanel
                  snapshot={snapshot}
                  incidents={incidents}
                  depotLabel={depotLabel}
                  selectedIncidentId={shownIncidentId}
                  onSelectIncident={setSelectedIncidentId}
                />
              )}
              {tab === 'schedule' && <DepotSchedulePanel />}
              {tab === 'standby' && (
                <>
                  <DepotStandbyPanel standby={standby} depotLabel={depotLabel} />
                  <DepotActionsPanel />
                </>
              )}
              {tab === 'roster' && rosterPanel}
              {tab === 'reports' && reportsPanel}
            </OpsStack>
          </div>
        </aside>
      </div>
    </OpsShell>
  );
}

/**
 * The corridor selector, offering only the corridors this depot is on.
 *
 * Marked BEFORE the choice, not after — the same decision the control room's
 * picker made and for the same reason: a corridor with no planned gap can be
 * watched and will report nothing, and a picker that offers it
 * indistinguishably spends the operator's click before explaining that. Here
 * the marking matters more, because on many depots EVERY option carries it.
 *
 * The three detection states get three different marks rather than two. A
 * corridor the control service says nothing about is not the same as one it
 * says cannot be checked, and collapsing them would make the picker state a
 * fact nobody established.
 */
function CorridorPicker({
  snapshot,
  onSelect,
}: {
  snapshot: DepotConsoleSnapshot;
  onSelect: (routeDirectionId: string) => void;
}) {
  if (snapshot.corridors.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="depot-corridor" className="ops-eyebrow">
        Corridor
      </label>
      <select
        id="depot-corridor"
        className="ops-input max-w-[22rem] py-1 text-xs"
        value={snapshot.selectedCorridor?.routeDirectionId ?? ''}
        onChange={(event) => onSelect(event.target.value)}
      >
        {snapshot.corridors.map((corridor) => {
          const detection = corridorDetection(corridor);
          return (
            <option key={corridor.routeDirectionId} value={corridor.routeDirectionId}>
              {depotCorridorLabel(corridor)} · {corridor.depotVehicleCount}{' '}
              {corridor.depotVehicleCount === 1 ? 'bus' : 'buses'}
              {detection === 'observation-only'
                ? ' — cannot report buses closing up'
                : detection === 'unknown'
                  ? ' — not known whether it can report'
                  : ''}
            </option>
          );
        })}
      </select>
    </div>
  );
}
