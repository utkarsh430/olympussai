'use client';

import { useCallback, useMemo, useState } from 'react';
import { OpsShell } from '@/components/ops/OpsShell';
import {
  OpsAlert,
  OpsBadge,
  OpsButton,
  OpsEmptyState,
  OpsField,
  OpsInput,
  OpsPanel,
  OpsSelect,
  OpsStack,
  OpsStat,
  OpsStatGroup,
  OpsStatStrip,
} from '@/components/ops/ui';
import type { OpsRole } from '@/lib/auth/rbac/roles';
import type { RouteDirectionMeta } from '@/models/control';
import {
  REHEARSAL_DISTURBANCE_DETAIL,
  REHEARSAL_DISTURBANCE_LABEL,
  rehearsalResultSchema,
  type RehearsalDisturbance,
  type RehearsalResult,
} from '@/models/rehearsal';
import { describeCalibrationSource } from '@/lib/ops/calibrationSource';
import { RehearsalMap } from './RehearsalMap';
import { ComparisonPanel } from './ComparisonPanel';
import { ProvenancePanel } from './ProvenancePanel';
import { DecisionsPanel } from './DecisionsPanel';
import { OccupancyPanel } from './OccupancyPanel';

/**
 * Rehearsing a control strategy on a real corridor, without touching a
 * single live bus.
 *
 * ─── WHAT THIS REPLACED, AND WHY ─────────────────────────────────────────
 *
 * A four-bus scripted scenario on a fabricated corridor, with a synthetic
 * occupancy model, its own Google Maps mount and a hand-tuned recovery
 * curve. Every number in it was invented, including the target headway it
 * scored itself against, and it had its own visual language. It was a
 * demonstration, and it looked like the product.
 *
 * What runs now is the control service's own mesoscopic simulator over one
 * of the 759 seeded route-directions, its real stops and geometry, and its
 * real `route_policies` row — driven by the DEPLOYED control laws rather
 * than by a curve written for this page. See
 * control-service/src/rehearsal/deployedControlLaws.ts for exactly which
 * production modules are called and which parts of the decision cycle are
 * not exercised.
 *
 * ─── THE SURFACE IT LIVES ON ─────────────────────────────────────────────
 *
 * `OpsShell variant="full"`, map on the left, analysis in a scrolling rail
 * on the right — the same shape as the control room and the depot console,
 * for the reason the design system exists: four dashboards must not become
 * four looks. `full` is also what makes the map size at all; a map inside
 * an auto-height ancestor resolves to zero.
 *
 * ─── AND IT MUST NEVER READ AS OPERATIONS ────────────────────────────────
 *
 * Every bus on it is invented. The `sim` badge sits in the shell's own
 * title row and in the status band, the buses carry `SIM-` identifiers
 * rather than registration numbers, they are drawn as annotations rather
 * than as vehicles, and the provenance panel is permanent rather than
 * disclosed. An operator glancing at this page from across a room has to be
 * able to tell it is not the fleet.
 */

/** Which corridors can be rehearsed at all — the same flag live detection answers with. */
function isSimulable(corridor: RouteDirectionMeta): boolean {
  return corridor.hasActivePolicy === true;
}

function corridorLabel(corridor: RouteDirectionMeta): string {
  return `${corridor.routeId} · ${corridor.directionCode}${corridor.isLoop ? ' (loop)' : ''} — ${Math.round(corridor.totalDistanceMeters / 1000)} km`;
}

type RailTab = 'outcome' | 'decisions' | 'occupancy' | 'provenance';

const RAIL_TABS: readonly { id: RailTab; label: string }[] = [
  { id: 'outcome', label: 'Outcome' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'occupancy', label: 'How full the buses are' },
  { id: 'provenance', label: 'What is real' },
];

export interface BunchingSimulatorProps {
  email: string;
  role?: OpsRole;
  corridors: RouteDirectionMeta[];
  /** Set when the corridor list itself could not be read, so the page explains an outage rather than an empty picker. */
  corridorsError: string | null;
}

export function BunchingSimulator({
  email,
  role,
  corridors,
  corridorsError,
}: BunchingSimulatorProps) {
  const simulable = useMemo(() => corridors.filter(isSimulable), [corridors]);
  const observationOnly = corridors.length - simulable.length;

  const [routeDirectionId, setRouteDirectionId] = useState(
    () => simulable[0]?.routeDirectionId ?? '',
  );
  const [disturbance, setDisturbance] = useState<RehearsalDisturbance>('none');
  const [vehicleCount, setVehicleCount] = useState(6);
  const [cruiseSpeedKmph, setCruiseSpeedKmph] = useState(35);
  const [result, setResult] = useState<RehearsalResult | null>(null);
  const [arm, setArm] = useState<'controlled' | 'uncontrolled'>('controlled');
  const [tab, setTab] = useState<RailTab>('outcome');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!routeDirectionId) return;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/ops/rehearsal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeDirectionId, disturbance, vehicleCount, cruiseSpeedKmph }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof payload === 'object' &&
          payload !== null &&
          typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
            ? (payload as { error: { message: string } }).error.message
            : 'The practice run could not be started.';
        setError(message);
        setResult(null);
        return;
      }

      // Parsed on this side too. A result whose provenance manifest did not
      // arrive intact must not be drawn: the labels are the only thing
      // separating this page from a page of invented operational numbers.
      const parsed = rehearsalResultSchema.safeParse(payload);
      if (!parsed.success) {
        setError(
          'The practice run came back with a result this page cannot label honestly, so it is not shown.',
        );
        setResult(null);
        return;
      }
      setResult(parsed.data);
    } catch {
      setError('The practice-run service could not be reached.');
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [routeDirectionId, disturbance, vehicleCount, cruiseSpeedKmph]);

  const selectedCorridor = simulable.find((c) => c.routeDirectionId === routeDirectionId) ?? null;

  return (
    <OpsShell
      title="Practice run"
      email={email}
      role={role}
      variant="full"
      subtitle={
        /*
          THE STRONGEST SENTENCE ON THIS PAGE, AND IT STAYS STRONG.

          The brief asked for plainer words without losing the force, so each
          clause was re-checked against what it is actually preventing rather
          than merely shortened:

            "Every bus on this page is invented" — kept WORD FOR WORD. It is
            already the plainest possible way to say it, it is the first thing
            read, and "invented" is doing work that "simulated" and "modelled"
            do not: those are the words a reader has learned to skim.

            "No live vehicle is read" -> "No real bus is being watched." Same
            claim, no jargon. `read` is an engineer's verb for it.

            "nothing here can issue an instruction" -> "nothing here can send
            an instruction to a driver." The old phrasing left open the
            question "issue to whom?", and the answer — a driver, at a wheel —
            is the whole reason the sentence exists.
        */
        <span className="flex flex-wrap items-center gap-2">
          <OpsBadge variant="sim">Practice run</OpsBadge>
          <span>
            Every bus on this page is invented. No real bus is being watched, and nothing here can
            send an instruction to a driver.
          </span>
        </span>
      }
      statusStrip={
        <OpsStatStrip>
          <OpsStatGroup label="Corridor">
            <OpsStat
              label="Selected"
              value={
                selectedCorridor
                  ? `${selectedCorridor.routeId} ${selectedCorridor.directionCode}`
                  : '—'
              }
              hint={result ? (result.corridor.routeName ?? undefined) : undefined}
            />
            <OpsStat
              label="Planned gap"
              // One decimal, not rounded: the provenance panel prints the
              // same figure, and a glance stat that says 23 beside a manifest
              // that says 22.5 invites a reader to wonder which number the
              // thresholds were computed from.
              value={result ? (result.policy.targetHeadwaySeconds / 60).toFixed(1) : '—'}
              unit="min"
              // NOT "measured from the od timetable", which was wrong twice —
              // see src/lib/ops/calibrationSource.ts. Undefined rather than a
              // guess when the source is one this build does not recognise.
              hint={
                result
                  ? (describeCalibrationSource(result.corridor.calibrationSource) ?? undefined)
                  : undefined
              }
              tone="accent"
            />
            <OpsStat
              label="Stops where a bus can be held"
              value={result ? result.corridor.controlPointCount : '—'}
              hint={result ? `of ${result.corridor.stops.length} stops` : undefined}
            />
          </OpsStatGroup>
          <OpsStatGroup label="Network coverage">
            <OpsStat label="Can be practised on" value={simulable.length} tone="accent" />
            <OpsStat
              label="Watch-only"
              value={observationOnly}
              hint="no planned gap set"
              tone="warn"
            />
          </OpsStatGroup>
        </OpsStatStrip>
      }
    >
      {/*
        TWO LAYOUTS, and the narrow one is not just the wide one squeezed.
        MEASURED at 820x900 before this: stacked, the map column took
        `flex-1` inside a shell that never scrolls, so the playback row
        overflowed onto the map's caption and the "Run the rehearsal"
        button sat 30px below the fold with no way to reach it.

        So below the split, the surface behaves like an ordinary scrolling
        document and the map takes a definite height. At and above it, the
        shell's no-scroll pane is what lets the map fill the screen, which
        is the whole reason this page uses `variant="full"`.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex h-[26rem] shrink-0 flex-col lg:h-auto lg:min-h-0 lg:w-[60%] lg:flex-1 lg:shrink">
          {result ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="ops-eyebrow">Showing</span>
                {(['controlled', 'uncontrolled'] as const).map((option) => (
                  <OpsButton
                    key={option}
                    variant={arm === option ? 'primary' : 'quiet'}
                    onClick={() => setArm(option)}
                  >
                    {option === 'controlled' ? 'With automatic spacing' : 'Without'}
                  </OpsButton>
                ))}
              </div>
              <RehearsalMap result={result} arm={result.arms[arm]} armLabel={arm} />
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-ops-line">
              <OpsEmptyState>
                Choose a corridor and a scenario, then start the practice run. It is run twice over
                the same made-up conditions: once with the automatic spacing rules allowed to act,
                and once without. The only difference between the two is those rules.
              </OpsEmptyState>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:min-h-0 lg:w-[40%] lg:overflow-y-auto">
          <OpsPanel
            title="Set up the practice run"
            description="The corridor and its planned gap are real. Everything below the corridor is a made-up figure you can change."
          >
            <OpsStack>
              {corridorsError ? (
                <OpsAlert tone="error">{corridorsError}</OpsAlert>
              ) : simulable.length === 0 ? (
                <OpsAlert tone="warning">
                  No corridor in this network has a planned gap set, so there is nothing to practise
                  against. All {corridors.length} surveyed corridors are watch-only.
                </OpsAlert>
              ) : null}

              <OpsField
                label="Corridor"
                htmlFor="rehearsal-corridor"
                hint={`${simulable.length} of ${corridors.length} surveyed corridors have a planned gap set. The other ${observationOnly} are watch-only and are not offered here, because every bunching threshold is worked out as a proportion of that planned gap.`}
              >
                <OpsSelect
                  id="rehearsal-corridor"
                  value={routeDirectionId}
                  onChange={(event) => setRouteDirectionId(event.target.value)}
                  disabled={simulable.length === 0}
                >
                  {simulable.map((corridor) => (
                    <option key={corridor.routeDirectionId} value={corridor.routeDirectionId}>
                      {corridorLabel(corridor)}
                    </option>
                  ))}
                </OpsSelect>
              </OpsField>

              <OpsField
                label="Scenario"
                htmlFor="rehearsal-scenario"
                hint={REHEARSAL_DISTURBANCE_DETAIL[disturbance]}
              >
                <OpsSelect
                  id="rehearsal-scenario"
                  value={disturbance}
                  onChange={(event) => setDisturbance(event.target.value as RehearsalDisturbance)}
                >
                  {(Object.keys(REHEARSAL_DISTURBANCE_LABEL) as RehearsalDisturbance[]).map(
                    (key) => (
                      <option key={key} value={key}>
                        {REHEARSAL_DISTURBANCE_LABEL[key]}
                      </option>
                    ),
                  )}
                </OpsSelect>
              </OpsField>

              <div className="grid gap-4 sm:grid-cols-2">
                <OpsField
                  label="Buses on the corridor"
                  htmlFor="rehearsal-vehicle-count"
                  hint="Made up. Sent out one planned gap apart."
                >
                  <OpsInput
                    id="rehearsal-vehicle-count"
                    type="number"
                    min={2}
                    max={24}
                    value={vehicleCount}
                    onChange={(event) => setVehicleCount(Number(event.target.value))}
                  />
                </OpsField>
                <OpsField
                  label="Running speed (km/h)"
                  htmlFor="rehearsal-cruise-speed"
                  hint="Made up. This system holds no record of a real running time."
                >
                  <OpsInput
                    id="rehearsal-cruise-speed"
                    type="number"
                    min={5}
                    max={120}
                    value={cruiseSpeedKmph}
                    onChange={(event) => setCruiseSpeedKmph(Number(event.target.value))}
                  />
                </OpsField>
              </div>

              <OpsButton
                variant="primary"
                onClick={() => void run()}
                disabled={running || !routeDirectionId}
              >
                {running ? 'Running…' : 'Start the practice run'}
              </OpsButton>

              {error ? <OpsAlert tone="error">{error}</OpsAlert> : null}
            </OpsStack>
          </OpsPanel>

          {result ? (
            <>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Practice run result">
                {RAIL_TABS.map((entry) => (
                  <OpsButton
                    key={entry.id}
                    role="tab"
                    aria-selected={tab === entry.id}
                    variant={tab === entry.id ? 'primary' : 'quiet'}
                    onClick={() => setTab(entry.id)}
                  >
                    {entry.label}
                  </OpsButton>
                ))}
              </div>

              {tab === 'outcome' ? <ComparisonPanel result={result} /> : null}
              {tab === 'decisions' ? <DecisionsPanel result={result} /> : null}
              {tab === 'occupancy' ? <OccupancyPanel result={result} /> : null}
              {tab === 'provenance' ? <ProvenancePanel result={result} /> : null}
            </>
          ) : null}
        </div>
      </div>
    </OpsShell>
  );
}
