'use client';

/**
 * The fleet-trial console.
 *
 * ─── WHAT THIS SCREEN IS FOR ─────────────────────────────────────────────
 *
 * Every other surface in this console shows the operator what the controller
 * IS doing. This one answers a different question - whether it should be doing
 * it at all - by running the deployed control laws against a thousand simulated
 * buses and showing, beside every result, what would have happened on the same
 * day with nobody intervening.
 *
 * ─── THE COUNTERFACTUAL IS NEVER OPTIONAL ────────────────────────────────
 *
 * No number on this page appears without the arm it is being compared against.
 * A controlled corridor can look calm because the controller worked or because
 * the day was quiet, and only the paired run separates those. The layout
 * enforces it: every panel is two columns or two bars, never one.
 *
 * ─── AND NEITHER IS THE PRICE ────────────────────────────────────────────
 *
 * The headline metric of this whole field - excess wait time - counts only the
 * people standing at stops, and holding a bus to help them is paid for by
 * everyone already aboard. The trial found a configuration that improved excess
 * wait 46% while making total passenger time 12% WORSE. So the passenger-time
 * balance sits at the top of every phase, above the wait figure, and the page
 * says which one is the verdict.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  OpsAlert,
  OpsBadge,
  OpsButton,
  OpsEmptyState,
  OpsGrid,
  OpsPanel,
  OpsReadout,
  OpsSection,
  OpsSelect,
  OpsStat,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTdNumericClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '@/components/ops/ui';
import { MareyComparison, PassengerBalance, StationHolds, SweepBands } from './TrialCharts';
import {
  CLOSE_REASON_LABEL,
  DECLINE_LABEL,
  LAW_LABEL,
  SEVERITY_LABEL,
  type ArmReport,
  type DetectedIncident,
  type FleetTrialReport,
  type PhaseReport,
  type ScenarioReport,
} from '@/models/fleetTrial';

const num = (value: number) => value.toLocaleString();
const secs = (value: number | null, digits = 0) => (value === null ? '—' : `${value.toFixed(digits)}s`);
const mins = (value: number | null) => (value === null ? '—' : `${(value / 60).toFixed(1)} min`);
const pct = (value: number | null, digits = 1) => (value === null ? '—' : `${value.toFixed(digits)}%`);
const hrs = (value: number) => `${Math.round(value / 3600).toLocaleString()} h`;

/**
 * Severity as one of the console's own chips.
 *
 * Only `bunched` gets `critical`. The chip carries its state in WORDS and in a
 * distinct dot shape regardless of variant (see OpsBadge), so the other two
 * rungs are distinguished by the label rather than by inventing a hue this
 * console does not have. Reaching for `sim` or `fixture` here would be worse
 * than a repeated variant: those two mean something specific about where data
 * came from, and every incident on this page is simulated.
 */
function severityVariant(severity: string) {
  return severity === 'bunched' ? ('critical' as const) : ('neutral' as const);
}

/** Both arms of one measurement, side by side, with the improvement stated in words. */
function ContrastRow({
  label,
  baseline,
  controlled,
  improvement,
  betterIsLower = true,
  hint,
}: {
  label: string;
  baseline: string;
  controlled: string;
  improvement: number | null;
  betterIsLower?: boolean;
  hint?: string;
}) {
  const good = improvement === null ? null : betterIsLower ? improvement > 0 : improvement < 0;
  return (
    <tr className={opsTrClass}>
      <td className={opsTdClass}>
        {label}
        {hint ? <div className="text-[11px] text-subtle">{hint}</div> : null}
      </td>
      <td className={opsTdNumericClass}>{baseline}</td>
      <td className={opsTdNumericClass}>{controlled}</td>
      <td className={opsTdNumericClass}>
        {improvement === null ? (
          <span className="text-subtle">—</span>
        ) : (
          <span className={good ? 'text-success' : 'text-destructive'}>
            {good ? '▲ ' : '▼ '}
            {pct(Math.abs(improvement))}
          </span>
        )}
      </td>
    </tr>
  );
}

function ArmContrastTable({ arm }: { arm: { uncontrolled: ArmReport; controlled: ArmReport; contrast: PhaseReport['contrast'] } }) {
  const { uncontrolled: u, controlled: c, contrast } = arm;
  return (
    <OpsTableFrame>
      <table className={opsTableClass}>
        <thead>
          <tr className={opsTheadRowClass}>
            <th className={opsThClass}>Measurement</th>
            <th className={opsThClass}>Left alone</th>
            <th className={opsThClass}>Under control</th>
            <th className={opsThClass}>Change</th>
          </tr>
        </thead>
        <tbody>
          <ContrastRow
            label="Total passenger time"
            hint="waiting at stops plus delay to people aboard — the verdict"
            baseline={hrs(u.passengers.totalPassengerSeconds)}
            controlled={hrs(c.passengers.totalPassengerSeconds)}
            improvement={contrast.passengerSecondsSavedPercent}
          />
          <ContrastRow
            label="Excess wait time"
            hint="per passenger at a stop — the field's headline metric"
            baseline={secs(u.spacing.ewtSeconds)}
            controlled={secs(c.spacing.ewtSeconds)}
            improvement={contrast.ewtImprovementPercent}
          />
          <ContrastRow
            label="Headway variability (CV)"
            hint="diagnostic only: it improves if every gap lengthens equally"
            baseline={u.spacing.headwayCv?.toFixed(3) ?? '—'}
            controlled={c.spacing.headwayCv?.toFixed(3) ?? '—'}
            improvement={contrast.cvImprovementPercent}
          />
          <ContrastRow
            label="Arrivals that were bunched"
            baseline={pct(u.spacing.bunchingRate * 100)}
            controlled={pct(c.spacing.bunchingRate * 100)}
            improvement={contrast.bunchingRateImprovementPercent}
          />
          <ContrastRow
            label="Passengers refused a seat"
            hint="rises if spacing was bought by stranding people"
            baseline={num(u.spacing.deniedBoardings)}
            controlled={num(c.spacing.deniedBoardings)}
            improvement={
              u.spacing.deniedBoardings > 0
                ? ((u.spacing.deniedBoardings - c.spacing.deniedBoardings) / u.spacing.deniedBoardings) * 100
                : null
            }
          />
          <tr className={opsTrClass}>
            <td className={opsTdClass}>
              Journey time per bus
              <div className="text-[11px] text-subtle">the punctuality cost of being controlled</div>
            </td>
            <td className={opsTdNumericClass}>{mins(u.punctuality.meanJourneySeconds)}</td>
            <td className={opsTdNumericClass}>{mins(c.punctuality.meanJourneySeconds)}</td>
            <td className={opsTdNumericClass}>
              <span className="text-muted-foreground">
                +{mins(contrast.addedJourneySecondsPerVehicle)}
              </span>
            </td>
          </tr>
          {c.punctuality.onTimeRate === null ? null : (
            <>
              <ContrastRow
                label="Arriving on time"
                hint="within five minutes of the booked time, early or late"
                baseline={pct((u.punctuality.onTimeRate ?? 0) * 100, 0)}
                controlled={pct((c.punctuality.onTimeRate ?? 0) * 100, 0)}
                improvement={
                  u.punctuality.onTimeRate
                    ? ((c.punctuality.onTimeRate - u.punctuality.onTimeRate) /
                        u.punctuality.onTimeRate) *
                      100
                    : null
                }
                betterIsLower={false}
              />
              <tr className={opsTrClass}>
                <td className={opsTdClass}>
                  Lateness at the terminus
                  <div className="text-[11px] text-subtle">
                    mean, and the worst one bus in twenty
                  </div>
                </td>
                <td className={opsTdNumericClass}>
                  {mins(u.punctuality.meanScheduleDeviationSeconds)}
                  <div className="text-[11px] text-subtle">
                    p95 {mins(u.punctuality.p95ScheduleDeviationSeconds)}
                  </div>
                </td>
                <td className={opsTdNumericClass}>
                  {mins(c.punctuality.meanScheduleDeviationSeconds)}
                  <div className="text-[11px] text-subtle">
                    p95 {mins(c.punctuality.p95ScheduleDeviationSeconds)}
                  </div>
                </td>
                <td className={opsTdNumericClass}>
                  <span className="text-muted-foreground">
                    worst bus held {mins(c.punctuality.maxHoldSecondsOnAnyVehicle)}
                  </span>
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </OpsTableFrame>
  );
}

function IncidentTable({ incidents, emptyLabel }: { incidents: DetectedIncident[]; emptyLabel: string }) {
  if (incidents.length === 0) return <OpsEmptyState>{emptyLabel}</OpsEmptyState>;
  return (
    <OpsTableFrame>
      <table className={opsTableClass}>
        <thead>
          <tr className={opsTheadRowClass}>
            <th className={opsThClass}>Pair</th>
            <th className={opsThClass}>Opened as</th>
            <th className={opsThClass}>Worst gap</th>
            <th className={opsThClass}>Lasted</th>
            <th className={opsThClass}>Ended because</th>
            <th className={opsThClass}>Holds served</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.incidentId} className={opsTrClass}>
              <td className={opsTdClass}>
                <span className="font-mono text-[11px]">{incident.followerVehicleId}</span>
                <span className="text-subtle"> behind </span>
                <span className="font-mono text-[11px]">{incident.leaderVehicleId}</span>
                {incident.observationLost ? (
                  <div className="text-[11px] text-subtle">feed was dark while open</div>
                ) : null}
              </td>
              <td className={opsTdClass}>
                <OpsBadge variant={severityVariant(incident.openedSeverity)}>
                  {SEVERITY_LABEL[incident.openedSeverity] ?? incident.openedSeverity}
                </OpsBadge>
                {incident.peakSeverity !== incident.openedSeverity ? (
                  <div className="mt-1 text-[11px] text-subtle">
                    rose to {SEVERITY_LABEL[incident.peakSeverity] ?? incident.peakSeverity}
                  </div>
                ) : null}
              </td>
              <td className={opsTdNumericClass}>{(incident.minRatio * 100).toFixed(0)}% of target</td>
              <td className={opsTdNumericClass}>
                {incident.durationSeconds === null ? '—' : mins(incident.durationSeconds)}
              </td>
              <td className={opsTdMutedClass}>
                {CLOSE_REASON_LABEL[incident.closeReason] ?? incident.closeReason}
              </td>
              <td className={opsTdNumericClass}>
                {incident.holdCount === 0 ? (
                  <span className="text-subtle">none</span>
                ) : (
                  `${incident.holdCount} · ${mins(incident.holdSecondsApplied)}`
                )}
                {incident.holdSecondsRefused > 0 ? (
                  <div className="text-[11px] text-subtle">
                    {mins(incident.holdSecondsRefused)} refused by the driver
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </OpsTableFrame>
  );
}

function ScenarioPanel({
  scenario,
  report,
}: {
  scenario: ScenarioReport;
  report: FleetTrialReport;
}) {
  const stations = report.corridor.stations.map((s) => ({
    name: s.name,
    cumulativeDistanceMeters: s.cumulativeDistanceMeters,
  }));
  return (
    <div className="space-y-5">
      <OpsPanel title={scenario.title} description={scenario.mechanism} headingLevel={3}>
        <p className="mb-4 max-w-prose text-xs leading-relaxed text-muted-foreground">
          <span className="ops-eyebrow">What it tests</span>
          <br />
          {scenario.whatItTests}
        </p>
        <ArmContrastTable
          arm={{
            uncontrolled: scenario.uncontrolled,
            controlled: scenario.controlled,
            contrast: scenario.contrast,
          }}
        />
      </OpsPanel>

      <OpsPanel
        title="Where the buses actually were"
        description={`Distance along the route against time, ${scenario.trajectories.controlled.length} consecutive buses from the middle of the fleet. Lines that converge are buses bunching. A dot is a hold that was served.`}
      >
        <MareyComparison
          trajectories={scenario.trajectories}
          stations={stations}
          totalDistanceMeters={report.corridor.totalDistanceMeters}
          horizonSeconds={scenario.horizonSeconds}
        />
      </OpsPanel>

      <SweepBands sweeps={scenario.sweeps} horizonSeconds={scenario.horizonSeconds} />

      <OpsGrid columns={2}>
        <OpsPanel
          title="Worst incidents, left alone"
          description="Deepest bunches the detector opened when nobody intervened."
        >
          <IncidentTable
            incidents={scenario.worstIncidentsUncontrolled}
            emptyLabel="The detector opened no incident on this scenario without control."
          />
        </OpsPanel>
        <OpsPanel
          title="Worst incidents, under control"
          description="The same detector, the same day, with the deployed laws running."
        >
          <IncidentTable
            incidents={scenario.worstIncidents}
            emptyLabel="The detector opened no incident on this scenario under control."
          />
        </OpsPanel>
      </OpsGrid>
    </div>
  );
}

function PhaseBody({ phase, report }: { phase: PhaseReport; report: FleetTrialReport }) {
  const [scenarioId, setScenarioId] = useState(phase.scenarios[0]?.id ?? null);
  const scenario = phase.scenarios.find((s) => s.id === scenarioId) ?? phase.scenarios[0] ?? null;

  return (
    <div className="space-y-6">
      {phase.controlled.spacing.saturated || phase.uncontrolled.spacing.saturated ? (
        <OpsAlert tone="warning" title="This phase ran a saturated corridor">
          More than a fifth of offered passengers were refused a seat. Past that line waiting time is
          bounded by how many seats exist rather than by how they are spaced, so the wait figures below
          cannot respond to control and a working controller correctly reports very little effect.
        </OpsAlert>
      ) : null}

      <OpsGrid columns={2}>
        <OpsPanel
          title="The trade, in passenger-seconds"
          description="Waiting removed at stations against delay added to people already aboard. Whichever bar is longer is the answer."
        >
          <PassengerBalance
            waitSecondsSaved={phase.contrast.waitSecondsSaved}
            onboardDelayImposed={phase.contrast.onboardDelayImposed}
            netSeconds={phase.contrast.passengerSecondsSaved}
            netPercent={phase.contrast.passengerSecondsSavedPercent}
          />
        </OpsPanel>
        <OpsPanel
          title="Incidents this phase"
          description={`Detected by the deployed rules, replayed at the live ${report.sweepIntervalSeconds}-second sweep cadence.`}
        >
          <div className="grid grid-cols-2 gap-4">
            <OpsStat
              label="Detected, left alone"
              value={num(phase.uncontrolled.incidents.detected)}
              hint={`${num(phase.uncontrolled.incidents.resolved)} resolved on their own`}
            />
            <OpsStat
              label="Detected, under control"
              value={num(phase.controlled.incidents.detected)}
              hint={`${num(phase.controlled.incidents.resolved)} resolved`}
            />
            <OpsStat
              label="Resolution rate"
              value={pct(
                phase.controlled.incidents.detected > 0
                  ? (phase.controlled.incidents.resolved / phase.controlled.incidents.detected) * 100
                  : null,
                0,
              )}
              hint={`against ${pct(
                phase.uncontrolled.incidents.detected > 0
                  ? (phase.uncontrolled.incidents.resolved / phase.uncontrolled.incidents.detected) * 100
                  : null,
                0,
              )} left alone`}
              tone="accent"
            />
            <OpsStat
              label="Median time to resolve"
              value={mins(phase.controlled.incidents.medianResolutionSeconds)}
              hint={`against ${mins(phase.uncontrolled.incidents.medianResolutionSeconds)} left alone`}
            />
          </div>
          <p className="mt-4 max-w-prose text-[11px] leading-relaxed text-subtle">
            A higher detected count under control is not a failure. Holding changes the gaps the
            forecaster is watching, so it opens more <em>predicted</em> incidents — and far more of them
            reach a real resolution instead of merely ending when a bus left the route.
          </p>
        </OpsPanel>
      </OpsGrid>

      <OpsPanel title="Everything, both arms" headingLevel={2}>
        <ArmContrastTable
          arm={{ uncontrolled: phase.uncontrolled, controlled: phase.controlled, contrast: phase.contrast }}
        />
      </OpsPanel>

      <OpsGrid columns={2}>
        <OpsPanel
          title="Where the holding happens"
          description="Seconds of hold served at each station, and how many instructions that was."
        >
          <StationHolds stations={phase.holdSecondsByStation} />
        </OpsPanel>
        <OpsPanel
          title="Which law did the work"
          description="Every hold served, split by the deployed law that produced it."
        >
          {phase.holdCountByActionType.length === 0 ? (
            <OpsEmptyState>No hold was served in this phase.</OpsEmptyState>
          ) : (
            <ul className="space-y-2">
              {phase.holdCountByActionType.map((action) => (
                <li key={action.actionType}>
                  <OpsReadout
                    label={action.actionType.replace(/_/g, ' ')}
                    value={`${num(action.count)} holds · ${mins(action.holdSeconds)}`}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 border-t border-border pt-4">
            <p className="ops-eyebrow mb-2">Law coverage</p>
            <p className="mb-3 max-w-prose text-[11px] leading-relaxed text-subtle">
              How often each law produced a candidate at all. A law at zero is the first thing worth
              knowing about a controller — and the reason it declined matters more than the number.
            </p>
            <ul className="space-y-1.5">
              {phase.lawCoverage.map((law) => (
                <li key={law.law} className="text-xs">
                  <span className="text-foreground">{LAW_LABEL[law.law] ?? law.law}</span>
                  <span className="text-subtle">
                    {' — '}
                    {num(law.decisionsGenerating)} of {num(law.decisionsTotal)} decisions
                    {law.commonestDecline
                      ? `; mostly ${DECLINE_LABEL[law.commonestDecline] ?? law.commonestDecline}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </OpsPanel>
      </OpsGrid>

      <OpsSection
        title="Scenario by scenario"
        description="Ten ways a corridor comes apart. Each ran the same fleet on the same corridor with one thing different."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {phase.scenarios.map((s) => {
            const net = s.contrast.passengerSecondsSavedPercent;
            const active = s.id === scenario?.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setScenarioId(s.id)}
                aria-pressed={active}
                className={
                  active
                    ? 'rounded-md border border-ring bg-accent px-3 py-1.5 text-left text-xs text-accent-foreground'
                    : 'rounded-md border border-border px-3 py-1.5 text-left text-xs text-muted-foreground hover:border-input'
                }
              >
                <span className="block">{s.title}</span>
                <span className="block text-[10px] tabular-nums text-subtle">
                  passenger time {net === null ? '—' : `${net > 0 ? '+' : ''}${net.toFixed(1)}%`}
                </span>
              </button>
            );
          })}
        </div>
        {scenario ? (
          <ScenarioPanel scenario={scenario} report={report} />
        ) : (
          <OpsEmptyState>This phase ran no scenarios.</OpsEmptyState>
        )}
      </OpsSection>
    </div>
  );
}

export function SimulatorConsole({ initialReport }: { initialReport: FleetTrialReport | null }) {
  const [report, setReport] = useState(initialReport);
  const [phaseId, setPhaseId] = useState(initialReport?.phases[0]?.id ?? 'occupancy_blind');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehiclesPerPhase, setVehiclesPerPhase] = useState(500);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/ops/control-room/fleet-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiclesPerPhase }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === 'object' && body !== null && 'error' in body
            ? ((body as { error?: { message?: string } }).error?.message ?? 'The trial could not be run.')
            : 'The trial could not be run.';
        setError(message);
        return;
      }
      setReport(body as FleetTrialReport);
      setPhaseId((body as FleetTrialReport).phases[0]?.id ?? 'occupancy_blind');
    } catch {
      setError('The trial could not be reached. Nothing was changed.');
    } finally {
      setRunning(false);
    }
  }, [vehiclesPerPhase]);

  const phase = useMemo(
    () => report?.phases.find((p) => p.id === phaseId) ?? report?.phases[0] ?? null,
    [report, phaseId],
  );

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-muted-foreground">
        <span className="ops-eyebrow block">Buses per phase</span>
        <OpsSelect
          className="mt-1"
          value={vehiclesPerPhase}
          onChange={(event) => setVehiclesPerPhase(Number(event.target.value))}
          disabled={running}
        >
          {[100, 250, 500, 1000].map((n) => (
            <option key={n} value={n}>
              {n} ({n * 2} in all)
            </option>
          ))}
        </OpsSelect>
      </label>
      <OpsButton variant="primary" onClick={() => void run()} disabled={running}>
        {running ? 'Running…' : report ? 'Run again' : 'Run the trial'}
      </OpsButton>
    </div>
  );

  if (!report) {
    return (
      <div className="space-y-4">
        {error ? <OpsAlert tone="error" title="The trial did not run">{error}</OpsAlert> : null}
        <OpsPanel
          title="No trial has been run yet"
          description="The simulator holds its last result in memory and loses it when the service restarts. Running one takes a couple of seconds and writes nothing anywhere."
          actions={controls}
        >
          <p className="max-w-prose text-sm text-muted-foreground">
            The trial runs the deployed control laws — the same modules the live decision cycle calls —
            against a thousand buses on a 400 km corridor with ten holding points, across ten ways a
            corridor comes apart, in two phases that differ only in whether the objective weighs how
            many passengers are aboard. Every result is shown beside what the same day would have done
            with nobody intervening.
          </p>
        </OpsPanel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? <OpsAlert tone="error" title="The last run failed">{error}</OpsAlert> : null}

      <OpsPanel
        title={report.corridor.routeName}
        headingLevel={2}
        description={`${Math.round(report.corridor.totalDistanceMeters / 1000)} km · ${report.corridor.stationCount} stations, all of them holding points · target headway ${Math.round(report.corridor.targetHeadwaySeconds / 60)} min · ${num(report.vehiclesSimulated)} buses simulated in ${(report.durationMs / 1000).toFixed(1)}s`}
        actions={controls}
      >
        <OpsAlert tone="info" title="What is real here and what is invented">
          The CONTROL is the deployed one: the four control laws, their gains, the hard safety filter,
          the selection rule and both tiers of the bunching detector are the same modules the live
          decision cycle calls. The CORRIDOR and the TRAFFIC are a model — the geometry, the running
          times, the demand, the seat count and the disturbances were all invented, because no corridor
          in this network has ever carried a thousand buses or recorded a single passenger.
        </OpsAlert>
      </OpsPanel>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Trial phase">
        {report.phases.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === phase?.id}
            onClick={() => setPhaseId(p.id)}
            className={
              p.id === phase?.id
                ? 'rounded-md border border-ring bg-accent px-4 py-2 text-sm text-accent-foreground'
                : 'rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:border-input'
            }
          >
            {p.title}
            <span className="ml-2 text-[11px] text-subtle">{num(p.vehicleCount)} buses</span>
          </button>
        ))}
      </div>

      {phase ? <PhaseBody phase={phase} report={report} /> : null}

      <OpsPanel
        title="Where the holding points should be"
        description={`Every station on this corridor can hold a bus. Which of them SHOULD is an operational choice, and it is the largest single lever in the trial. Each row is the same fleet and the same scenarios, averaged over ${report.holdingPointStudy.seedsPerRow} seeds.`}
      >
        <p className="mb-4 max-w-prose text-sm text-muted-foreground">
          {report.holdingPointStudy.verdict}
        </p>
        <OpsTableFrame>
          <table className={opsTableClass}>
            <thead>
              <tr className={opsTheadRowClass}>
                <th className={opsThClass}>Stations holding</th>
                <th className={opsThClass}>Excess wait</th>
                <th className={opsThClass}>Total passenger time</th>
                <th className={opsThClass}>Hold per bus</th>
                <th className={opsThClass}>Instructions</th>
                <th className={opsThClass}>Incidents resolved</th>
                <th className={opsThClass}>Seeds agreeing</th>
              </tr>
            </thead>
            <tbody>
              {report.holdingPointStudy.rows.map((row) => {
                const recommended = row.holdingPointCount === report.holdingPointStudy.recommendedCount;
                const net = row.passengerSecondsSavedPercent;
                return (
                  <tr key={row.holdingPointCount} className={opsTrClass}>
                    <td className={opsTdClass}>
                      {row.holdingPointCount} of {report.corridor.stationCount}
                      {recommended ? (
                        <span className="ml-2">
                          <OpsBadge variant="live">best affordable</OpsBadge>
                        </span>
                      ) : null}
                    </td>
                    <td className={opsTdNumericClass}>
                      <span className={(row.ewtImprovementPercent ?? 0) > 0 ? 'text-success' : 'text-destructive'}>
                        {pct(row.ewtImprovementPercent, 0)}
                      </span>
                    </td>
                    <td className={opsTdNumericClass}>
                      <span className={net !== null && net >= 0 ? 'text-success' : 'text-destructive'}>
                        {net === null ? '—' : `${net > 0 ? '+' : ''}${net.toFixed(1)}%`}
                      </span>
                    </td>
                    <td className={opsTdNumericClass}>{mins(row.meanHoldSecondsPerVehicle)}</td>
                    <td className={opsTdNumericClass}>{num(row.holdCount)}</td>
                    <td className={opsTdNumericClass}>
                      {num(row.incidentsResolved)} of {num(row.incidentsDetected)}
                    </td>
                    <td className={opsTdNumericClass}>
                      {row.seedsAgreeingWithSign} of {row.seedCount}
                      {row.seedsAgreeingWithSign <= row.seedCount / 2 ? (
                        <div className="text-[11px] text-subtle">no effect measured</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </OpsTableFrame>
        <p className="mt-3 max-w-prose text-[11px] leading-relaxed text-subtle">
          Excess wait is sampled at <em>every</em> station, not only the ones designated for holding —
          otherwise each row would be scored on a different set of stops and the column could not be
          compared down the page. One seed is not enough to read: a single run&rsquo;s net figure on this
          corridor ranges from &minus;6% to +4%, so a row whose seeds do not agree on the sign is no
          measured effect, however large its mean.
        </p>
      </OpsPanel>

      <OpsPanel
        title="What weighing passenger load changed"
        description="Measured by re-running the occupancy-aware phase's own scenarios with the switch off — same corridor, same plan, same seed, one input different."
      >
        <p className="max-w-prose text-sm text-muted-foreground">{report.occupancyContrast.verdict}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <OpsStat label="Decisions compared" value={num(report.occupancyContrast.decisionsCompared)} />
          <OpsStat
            label="Instructions changed"
            value={num(report.occupancyContrast.decisionsChanged)}
            tone={report.occupancyContrast.decisionsChanged > 0 ? 'accent' : 'default'}
          />
          <OpsStat
            label="Mean hold cost, load ignored"
            value={report.occupancyContrast.meanObjectiveCostBlind?.toFixed(0) ?? '—'}
            unit="pax·s"
          />
          <OpsStat
            label="Mean hold cost, load weighed"
            value={report.occupancyContrast.meanObjectiveCostAware?.toFixed(0) ?? '—'}
            unit="pax·s"
          />
        </div>
      </OpsPanel>

      <OpsGrid columns={2}>
        <OpsPanel
          title="Where every number came from"
          description="Measured, configured, or invented — field by field."
        >
          <ul className="space-y-3">
            {report.provenance.map((entry) => (
              <li key={entry.field} className="text-xs">
                <div className="flex flex-wrap items-baseline gap-2">
                  {/* The provenance chips map exactly onto the variant
                      vocabulary they were built for: deployed code is the live
                      system, an invented input is simulation. */}
                  <OpsBadge
                    variant={
                      entry.source === 'deployed' ? 'live' : entry.source === 'configured' ? 'neutral' : 'sim'
                    }
                  >
                    {entry.source === 'deployed'
                      ? 'Deployed code'
                      : entry.source === 'configured'
                        ? 'Chosen'
                        : 'Invented'}
                  </OpsBadge>
                  <span className="text-foreground">{entry.field}</span>
                  <span className="text-subtle">{entry.value}</span>
                </div>
                <p className="mt-1 max-w-prose leading-relaxed text-subtle">{entry.note}</p>
              </li>
            ))}
          </ul>
        </OpsPanel>
        <OpsPanel
          title="What this trial does not test"
          description="Stated so a result is not read as covering more than it does."
        >
          <ul className="space-y-3">
            {report.notExercised.map((item) => (
              <li key={item} className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </OpsPanel>
      </OpsGrid>
    </div>
  );
}
