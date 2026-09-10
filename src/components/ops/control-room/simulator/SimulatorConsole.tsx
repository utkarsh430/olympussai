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
 * wait 46% while making total passenger time 12% WORSE. So the two sit side by
 * side at the top of the page, and the VERDICT is taken on passenger time.
 *
 * Total passenger time here means the WHOLE journey - kerb wait, dwell, hold
 * and riding, each second counted once. It used to mean waiting plus the hold,
 * which is the wrong half: holding is the only in-vehicle term control makes
 * worse. See `fleetTrial/types.ts#PassengerOutcome`.
 *
 * ─── THE PAGE ANSWERS BEFORE IT EXPLAINS ─────────────────────────────────
 *
 * It did not. On a completed 1,000-bus trial it rendered 1,055 separate blocks
 * of visible text, everything expanded at once, five banners stacked above a
 * report, and no particular place where "did the controller help" was
 * answered. Every individual piece was worth having; none of it was ordered,
 * so a reader had to consume all of it to find any of it.
 *
 * An operator opens this to learn four things IN THAT ORDER - did it help, by
 * how much, can I trust that, and why - so the page is now those four:
 *
 *   1-3. `TrialAnswer`, on one screen. The verdict sentence, the two figures,
 *        and the qualifications ATTACHED to the figure they qualify rather
 *        than stacked beside it as banners nobody correlates by hand.
 *   4.   Everything else, in `OpsDisclosure`s, closed until asked for.
 *
 * NOTHING WAS DELETED. The default view is 87 blocks and the fully expanded
 * page is 1,121 - more text than before, not less, because saying the
 * timetable IS fine turns out to be worth a line too. The reasoning that
 * filled the old banners is one click away on the line it belongs to, and
 * several of those paragraphs exist to prevent a specific misreading that has
 * already happened once. Shorten one, move one, hide one behind a disclosure -
 * but a caveat is never removed to make this page look calmer.
 *
 * The one thing that may not move is what became of the RUN. `TrialRunStatus`
 * stays first and outside every disclosure: a progress or failure notice below
 * a full report reads as though the report were the answer to it.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import {
  OpsAlert,
  OpsBadge,
  OpsButton,
  OpsCoverage,
  OpsDisclosure,
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
import { cn } from '@/lib/utils';
import { MareyComparison, PassengerBalance, StationHolds, SweepBands } from './TrialCharts';
import {
  headlineNetPassengerTime,
  trialProvenance,
  trialVerdict,
  type TrialOrigin,
  type TrialProvenanceView,
  type TrialVerdictView,
} from '@/lib/ops/fleetTrialView';
import {
  initialTrialConsoleState,
  trialConsoleReducer,
  elapsedLabel,
  type TrialFailureKind,
  type TrialRunState,
  type TrialStage,
} from '@/lib/ops/fleetTrialRun';
import {
  CLOSE_REASON_LABEL,
  DECLINE_LABEL,
  LAW_LABEL,
  REJECTION_LABEL,
  SEVERITY_LABEL,
  type ArmReport,
  type CorridorPresetId,
  type DetectedIncident,
  type FleetTrialReport,
  type PhaseReport,
  type ScenarioReport,
} from '@/models/fleetTrial';

const num = (value: number) => value.toLocaleString();
const secs = (value: number | null, digits = 0) =>
  value === null ? '—' : `${value.toFixed(digits)}s`;
const mins = (value: number | null) => (value === null ? '—' : `${(value / 60).toFixed(1)} min`);
const pct = (value: number | null, digits = 1) =>
  value === null ? '—' : `${value.toFixed(digits)}%`;
const hrs = (value: number) => `${Math.round(value / 3600).toLocaleString()} h`;
/** Null is "nobody was offered a seat", which is not zero. */
const deniedShareLabel = (share: number | null) =>
  share === null ? 'no passenger reached this arm' : pct(share * 100);

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

function ArmContrastTable({
  arm,
}: {
  arm: { uncontrolled: ArmReport; controlled: ArmReport; contrast: PhaseReport['contrast'] };
}) {
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
            hint="the whole journey — kerb wait, dwell, hold and riding — the verdict"
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
            // The refusal-EVENT count with the HEADCOUNT share beside it. A
            // reader shown only the event count builds a share by dividing it
            // by boardings, which divides a rate by a headcount and reads
            // about four times high - 52% on a corridor whose saturation flag
            // correctly said false.
            hint={`rises if spacing was bought by stranding people — ${deniedShareLabel(
              u.spacing.deniedShare,
            )} of people offered a seat were refused one, ${deniedShareLabel(
              c.spacing.deniedShare,
            )} under control`}
            baseline={num(u.spacing.deniedBoardings)}
            controlled={num(c.spacing.deniedBoardings)}
            improvement={
              u.spacing.deniedBoardings > 0
                ? ((u.spacing.deniedBoardings - c.spacing.deniedBoardings) /
                    u.spacing.deniedBoardings) *
                  100
                : null
            }
          />
          <tr className={opsTrClass}>
            <td className={opsTdClass}>
              Journey time per bus
              <div className="text-[11px] text-subtle">
                the punctuality cost of being controlled
              </div>
            </td>
            <td className={opsTdNumericClass}>{mins(u.punctuality.meanJourneySeconds)}</td>
            <td className={opsTdNumericClass}>{mins(c.punctuality.meanJourneySeconds)}</td>
            <td className={opsTdNumericClass}>
              <span className="text-muted-foreground">
                +{mins(contrast.addedJourneySecondsPerVehicle)}
              </span>
            </td>
          </tr>
          {c.punctuality.alightingOnlyActions === 0 ? null : (
            <tr className={opsTrClass}>
              <td className={opsTdClass}>
                Alighting-only instructions
                <div className="text-[11px] text-subtle">
                  let people off, take nobody on — the one lever that removes delay instead of
                  adding it
                </div>
              </td>
              <td className={opsTdMutedClass}>none</td>
              <td className={opsTdNumericClass}>
                {num(c.punctuality.alightingOnlyActions)}
                <div className="text-[11px] text-subtle">
                  {num(c.punctuality.alightingOnlyPassengersPassed)} passengers left for the bus
                  behind
                </div>
              </td>
              <td className={opsTdMutedClass}>—</td>
            </tr>
          )}
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

function IncidentTable({
  incidents,
  emptyLabel,
}: {
  incidents: DetectedIncident[];
  emptyLabel: string;
}) {
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
              <td className={opsTdNumericClass}>
                {(incident.minRatio * 100).toFixed(0)}% of target
              </td>
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

const signedPct = (value: number | null) =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;

/**
 * One qualification, attached to the number it qualifies.
 *
 * ─── WHY THESE ARE NOT BANNERS ANY MORE ──────────────────────────────────
 *
 * They were: five stacked alerts above the report — the controllability band,
 * what is invented, the timetable fit, which scenarios the headline pools, and
 * whose run this is. Each was true and each was worth saying, but a reader had
 * to hold all five in their head and correlate them with a figure further down
 * the page by hand. Nobody does that. What they qualify is ONE number, so they
 * belong beside that number, in one list, in the order a reader would ask.
 *
 * ─── THE STATE IS IN THE WORDS FIRST ─────────────────────────────────────
 *
 * `headline` is written to be readable on its own: "In the controllable band",
 * "16 of 19 scenarios averaged", "This timetable is tighter than the corridor
 * can keep". The glyph is a SHAPE and the colour is third, for the same reason
 * OpsBadge's dot is a shape — a hue pair this console has already measured at
 * 1.22:1 under deuteranopia cannot be the thing carrying a caveat.
 *
 * Deliberately not `OpsBadge`'s live/sim/fixture vocabulary: those three mean
 * something specific about where data came from, and every number in this
 * trial is simulated.
 *
 * ─── AND NOTHING IS DELETED TO MAKE THE LIST SHORT ───────────────────────
 *
 * The reasoning that used to fill each banner is still here in full, one click
 * away, and several of these paragraphs exist to stop a specific misreading
 * that has already happened once. `children` is where they live; the summary
 * line never replaces them.
 */
function Qualification({
  state,
  headline,
  children,
}: {
  state: 'ok' | 'caution' | 'note';
  headline: ReactNode;
  children?: ReactNode;
}) {
  const glyph = state === 'ok' ? '✓' : state === 'caution' ? '!' : '·';
  const tone =
    state === 'ok' ? 'text-success' : state === 'caution' ? 'text-warning' : 'text-subtle';

  const line = (
    <>
      <span aria-hidden className={cn('mt-px w-3 shrink-0 text-center text-xs font-bold', tone)}>
        {glyph}
      </span>
      <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        {headline}
      </span>
    </>
  );

  // A qualification with nothing more to say is a plain line, not a control
  // that opens onto nothing.
  if (!children) {
    return <li className="flex items-start gap-2 py-1.5">{line}</li>;
  }

  return (
    <li>
      <details className="group">
        <summary
          className={cn(
            'flex cursor-pointer list-none items-start gap-2 rounded py-1.5',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            '[&::-webkit-details-marker]:hidden',
          )}
        >
          {line}
          <span className="shrink-0 pt-px text-[11px] font-medium text-subtle group-hover:text-muted-foreground">
            <span className="group-open:hidden">why</span>
            <span className="hidden group-open:inline">close</span>
          </span>
        </summary>
        <div className="max-w-prose pb-2 pl-5 text-[11px] leading-relaxed text-subtle">
          {children}
        </div>
      </details>
    </li>
  );
}

/**
 * Which scenarios the headline is an average of.
 *
 * ─── WHY THIS IS NOT THE OLD SATURATION BANNER ───────────────────────────
 *
 * There was one, and it fired on the POOLED arm: "this phase ran a saturated
 * corridor". Pooling eighteen readable scenarios with one built to saturate
 * put the pooled first-time denied share at 12% - under the one-fifth bar - so
 * the banner stayed silent while one of the ingredients behind every number on
 * the page was a scenario that cannot respond to control at all.
 *
 * The scope is decided per scenario on the service. Three states, and each is
 * a different thing to tell a reader:
 *
 *   * scenarios were excluded — say which, and what the full set says;
 *   * nothing was excluded — say that too, so silence is never ambiguous;
 *   * everything saturated — the headline IS the full set, and the figures
 *     cannot be read as a verdict on the controller.
 *
 * It now renders as a qualification ON the headline rather than as a banner
 * beside it, because that is what it is: "16 of 19" is a property of the
 * number, not a separate topic a reader should have to join up by hand.
 */
function ScopeQualification({ report }: { report: FleetTrialReport }) {
  const headline = headlineNetPassengerTime(report);

  if (headline.fellBackToAllScenarios) {
    return (
      <Qualification
        state="caution"
        headline="Every scenario in this trial ran past the saturation line"
      >
        {headline.note} There was no readable subset to average, so the figures are the whole set —
        and past that line a working controller correctly reports very little effect. Read them as a
        check on the harness, not as a verdict on the controller.
      </Qualification>
    );
  }

  if (headline.excludedScenarios.length === 0) {
    return (
      <Qualification
        state="ok"
        headline={`Averaged over all ${headline.totalScenarioCount} scenarios — none saturated`}
      >
        None of them ran past the saturation line, so every scenario this trial ran is behind the
        figures above.
      </Qualification>
    );
  }

  return (
    <Qualification
      state="caution"
      headline={
        <>
          Averaged over{' '}
          <span className="tabular-nums text-foreground">
            {headline.includedScenarioCount} of {headline.totalScenarioCount}
          </span>{' '}
          scenarios — {headline.excludedScenarios.length} ran past the saturation line
        </>
      }
    >
      {headline.excludedScenarios
        .map(
          (s) =>
            `${s.title} (${pct(s.deniedShare * 100, 0)} of people offered a seat were refused one)`,
        )
        .join(', ')}{' '}
      {headline.excludedScenarios.length === 1 ? 'is' : 'are'} left out. Past the saturation line
      waiting time is bounded by how many seats exist rather than by how they are spaced, so spacing
      control cannot move the figure there and averaging it in only pulls the headline towards zero.
      Over all {headline.totalScenarioCount} the trial reads{' '}
      <span className="tabular-nums text-foreground">
        {signedPct(headline.allScenariosPercent)}
      </span>{' '}
      net passenger time against{' '}
      <span className="tabular-nums text-foreground">{signedPct(headline.headlinePercent)}</span>{' '}
      here; the excluded scenarios are still shown in full under &ldquo;Scenario by scenario&rdquo;,
      and in the agreement count.
    </Qualification>
  );
}

function PhaseBody({ phase, report }: { phase: PhaseReport; report: FleetTrialReport }) {
  const [scenarioId, setScenarioId] = useState(phase.scenarios[0]?.id ?? null);
  const scenario = phase.scenarios.find((s) => s.id === scenarioId) ?? phase.scenarios[0] ?? null;

  return (
    <div className="space-y-3">
      <OpsDisclosure
        title="How the answer was arrived at"
        description="The passenger-time trade this phase struck, and what the deployed detector saw while it was being struck."
      >
        <OpsGrid columns={2}>
          <OpsPanel
            title="The trade, in passenger-seconds"
            description="Waiting removed at stations against delay added to people already aboard. Whichever bar is longer is the answer."
          >
            <PassengerBalance
              waitSecondsSaved={phase.contrast.waitSecondsSaved}
              onboardDelayImposed={phase.contrast.onboardDelayImposed}
              inVehicleSecondsSaved={phase.contrast.inVehicleSecondsSaved}
              netSeconds={phase.contrast.passengerSecondsSaved}
              netPercent={phase.contrast.passengerSecondsSavedPercent}
            />
            {/* This PHASE's own two pools. The trial-level pair is attached to
              the headline above; these are the same comparison for this phase
              alone, and dropping them would put a figure on the page (the
              headline pool) whose full-set counterpart was unreachable. */}
            <p className="mt-4 max-w-prose text-[11px] leading-relaxed text-subtle">
              Over the{' '}
              <span className="tabular-nums text-foreground">
                {report.headlineScope.includedScenarioIds.length}
              </span>{' '}
              scenarios in the headline this phase reads{' '}
              <span className="tabular-nums text-foreground">
                {signedPct(phase.contrast.passengerSecondsSavedPercent)}
              </span>
              ; over all{' '}
              <span className="tabular-nums text-foreground">{phase.scenarios.length}</span> it ran,{' '}
              <span className="tabular-nums text-foreground">
                {signedPct(phase.allScenarios.contrast.passengerSecondsSavedPercent)}
              </span>
              .
            </p>
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
                    ? (phase.controlled.incidents.resolved / phase.controlled.incidents.detected) *
                        100
                    : null,
                  0,
                )}
                hint={`against ${pct(
                  phase.uncontrolled.incidents.detected > 0
                    ? (phase.uncontrolled.incidents.resolved /
                        phase.uncontrolled.incidents.detected) *
                        100
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
              forecaster is watching, so it opens more <em>predicted</em> incidents — and far more
              of them reach a real resolution instead of merely ending when a bus left the route.
            </p>
          </OpsPanel>
        </OpsGrid>
      </OpsDisclosure>

      <OpsDisclosure
        title="Everything, both arms"
        count={`${phase.controlled.punctuality.onTimeRate === null ? 6 : 8} measurements`}
        description="Every KPI this phase produced, with the arm it is being compared against beside it."
      >
        <ArmContrastTable
          arm={{
            uncontrolled: phase.uncontrolled,
            controlled: phase.controlled,
            contrast: phase.contrast,
          }}
        />
      </OpsDisclosure>

      <OpsDisclosure
        title="What the controller did, and what stopped it"
        description="Where the holds landed, which law produced them, and every candidate the hard safety filter threw out."
      >
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
              <p className="ops-eyebrow mb-2">Guardrails that refused a hold</p>
              <p className="mb-3 max-w-prose text-[11px] leading-relaxed text-subtle">
                The hard safety filter throwing a candidate out is half the story of what the
                controller did, and it is the half that is usually invisible. A reader who cannot
                see this cannot tell a controller that decided not to act from one that was stopped.
              </p>
              {phase.safetyRejections.length === 0 ? (
                <p className="text-xs text-subtle">No candidate was refused in this phase.</p>
              ) : (
                <ul className="space-y-1.5">
                  {phase.safetyRejections.map((rejection) => (
                    <li key={rejection.reason} className="text-xs">
                      <span className="tabular-nums text-foreground">{num(rejection.count)}</span>
                      <span className="text-subtle">
                        {' — '}
                        {REJECTION_LABEL[rejection.reason] ?? rejection.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-5 border-t border-border pt-4">
              <p className="ops-eyebrow mb-2">Law coverage</p>
              <p className="mb-3 max-w-prose text-[11px] leading-relaxed text-subtle">
                How often each law produced a candidate at all. A law at zero is the first thing
                worth knowing about a controller — and the reason it declined matters more than the
                number.
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
      </OpsDisclosure>

      <OpsDisclosure
        title="Scenario by scenario"
        count={`${phase.scenarios.length} scenarios`}
        description="Every way this corridor was made to come apart. Each ran the same fleet on the same corridor with one thing different — including any the headline leaves out."
      >
        <OpsSection>
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
      </OpsDisclosure>
    </div>
  );
}

/**
 * When this report was produced, on what, and whether it is the reader's own.
 *
 * ─── THE PAGE LOAD IS THE DEFECT, NOT THE RUN ────────────────────────────
 *
 * Clicking Run does update the page: the POST returns a fresh report and it is
 * rendered. What was wrong is the LOAD. `GET /v1/fleet-trial/latest` serves the
 * last report the control-service PROCESS produced, to every caller, from a
 * single module-level variable - so a trial anyone runs through the API becomes
 * what the next person sees, and a restart loses it. A 60-bus diagnostic run
 * reporting -7.9% was read this way off a page whose own controls said 1,000
 * buses.
 *
 * The fix is to say what the report is rather than to give the control service
 * per-user state. Deliberately: the trial is a pure computation over its own
 * spec, it writes nothing and reads no database, and the report is not private
 * data - there is no user at that layer to attach it to. Sessions there would
 * add state to a deliberately stateless endpoint AND still leave the label
 * missing, because a stale report of your own is just as misleading as a fresh
 * one of somebody else's. What a reader needs is when, what, and whose.
 */
function ProvenanceQualification({ view }: { view: TrialProvenanceView }) {
  return (
    <Qualification
      state={view.stale ? 'caution' : 'note'}
      headline={
        <>
          <span className="text-foreground">
            {view.isThisSessionsRun ? 'Your run' : 'A stored result — not necessarily yours'}
          </span>
          {' — '}
          {view.summary}
        </>
      }
    >
      <p>{view.ownership}</p>
      <p className="mt-1">
        {view.generatedAtLabel === null ? (
          'The service did not send a readable timestamp, so how old this is cannot be said.'
        ) : (
          <>
            Produced <time dateTime={view.generatedAtLabel}>{view.generatedAtLabel}</time>,{' '}
            {num(view.vehiclesSimulated)} buses in all.
          </>
        )}
      </p>
      {view.stale ? (
        <p className="mt-1 text-warning">
          Old enough that the deployed control laws it measured may not be the deployed laws any
          more. Run it again before quoting it.
        </p>
      ) : null}
    </Qualification>
  );
}

/**
 * The answer, in the order an operator asks for it.
 *
 * ─── WHY THIS PANEL EXISTS ───────────────────────────────────────────────
 *
 * The page used to open with five stacked banners and then a report, and a
 * reader had to consume all of it to find any of it: 1,106 separate blocks of
 * text on a completed 1,000-bus trial. Every piece was worth having and none
 * of it was ordered. An operator opens this to learn four things IN ORDER —
 * did it help, by how much, can I trust that, and why — and this panel is the
 * first three of them, on one screen, with the fourth reachable underneath.
 *
 * ─── THE VERDICT IS ONE SENTENCE AND IT COMES OFF PASSENGER TIME ─────────
 *
 * See `fleetTrialView.ts#trialVerdict` for why it may not come off excess
 * wait, and why a sign the scenarios do not agree on is not a result. Excess
 * wait is beside it, per phase, because it is the field's headline metric and
 * because the two figures disagreeing is the single most important thing this
 * trial can tell anybody.
 *
 * ─── THE QUALIFICATIONS ARE ATTACHED, NOT STACKED ────────────────────────
 *
 * Controllability, saturation scope, timetable fit, what is invented and whose
 * run this is were five separate banners a reader had to correlate with a
 * number further down by hand. They all qualify the same figure, so they sit
 * under it in one list. Nothing was deleted: every paragraph is one click away
 * on the line it belongs to.
 */
function TrialAnswer({
  report,
  origin,
  controls,
}: {
  report: FleetTrialReport;
  origin: TrialOrigin;
  controls: ReactNode;
}) {
  // The clock arrives only after mount. This component is server-rendered for
  // the first paint and hydrated in the browser; a relative age read off
  // `new Date()` in both places is two different strings and a hydration
  // mismatch. Everything the report itself knows renders on the first paint.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, [report.generatedAt, origin]);

  const provenance = trialProvenance(report, origin, now);
  const verdict = trialVerdict(report);
  const controllable = report.controllability.band === 'controllable';
  const sigma = Math.round(report.controllability.legTimeSigmaSeconds);
  const ratio = Math.round(report.controllability.disturbanceRatio * 100);

  return (
    <OpsPanel
      headingLevel={2}
      title={report.corridor.routeName}
      description={`${Math.round(report.corridor.totalDistanceMeters / 1000)} km · ${report.corridor.stationCount} stations, all of them holding points · target headway ${Math.round(report.corridor.targetHeadwaySeconds / 60)} min · ${num(report.vehiclesSimulated)} buses simulated in ${(report.durationMs / 1000).toFixed(1)}s`}
      actions={controls}
      tone={verdict.verdict === 'helped' ? 'accent' : 'default'}
    >
      <VerdictHeadline verdict={verdict} />

      <div className="mt-5 border-t border-border pt-4">
        <p className="ops-eyebrow mb-1">Can I trust this?</p>
        <ul className="divide-y divide-border/60">
          <Qualification
            state={controllable ? 'ok' : 'caution'}
            headline={
              controllable
                ? `In the controllable band — one leg varies by ${sigma}s, ${ratio}% of the headway`
                : report.controllability.band === 'too_regular'
                  ? `Barely disturbed — one leg varies by only ${sigma}s, ${ratio}% of the headway`
                  : `More disturbed than a hold can recover — one leg varies by ${sigma}s, ${ratio}% of the headway`
            }
          >
            {report.controllability.note} Measured by varying headway, stop count and route length
            independently, the excess-wait improvement peaks around 5&ndash;10% and falls away on
            both sides — it is neither headway nor fleet size that predicts how much good control
            can do.
          </Qualification>

          <ScopeQualification report={report} />

          {/* Always stated, including when it is fine. Silence here used to be
              ambiguous, and this is the tripwire for a failure mode that is
              otherwise INVISIBLE: a timetable the corridor cannot keep makes
              every bus late, `max_lateness_seconds` then refuses every hold,
              and the controller switches itself off without saying so. That
              cost 33 points of excess-wait gain when it happened. */}
          <Qualification
            state={report.scheduleFit.band === 'achievable' ? 'ok' : 'caution'}
            headline={
              report.scheduleFit.band === 'achievable'
                ? 'The timetable is one this corridor can keep'
                : report.scheduleFit.band === 'tight'
                  ? 'This timetable is tighter than the corridor can keep'
                  : 'This timetable is looser than the corridor needs'
            }
          >
            {report.scheduleFit.note}
          </Qualification>

          <Qualification
            state="note"
            headline="Deployed control laws, invented corridor and traffic"
          >
            The CONTROL is the deployed one: the four control laws, their gains, the hard safety
            filter, the selection rule and both tiers of the bunching detector are the same modules
            the live decision cycle calls. The CORRIDOR and the TRAFFIC are a model — the geometry,
            the running times, the demand, the seat count and the disturbances were all invented,
            because no corridor in this network has ever carried a thousand buses or recorded a
            single passenger.
          </Qualification>

          <ProvenanceQualification view={provenance} />
        </ul>
      </div>

      <p className="mt-4 max-w-prose text-[11px] leading-relaxed text-subtle">
        {report.corridorPreset.description}
      </p>
    </OpsPanel>
  );
}

/**
 * The two numbers, with what qualifies each one attached to it.
 *
 * Passenger time is given the larger type because it is the one that can say
 * the controller made things worse while every other figure on the page
 * improved. Excess wait is beside it at equal prominence and is never pooled
 * across phases — `poolArm` recomputes it from raw headway samples rather than
 * averaging per-run means, so two phases' published figures cannot honestly be
 * combined, and the two phases are two configurations worth seeing apart.
 */
function VerdictHeadline({ verdict }: { verdict: TrialVerdictView }) {
  const tone =
    verdict.verdict === 'helped'
      ? 'text-success'
      : verdict.verdict === 'cost_more'
        ? 'text-destructive'
        : 'text-warning';

  return (
    <div>
      <p className={cn('text-xl font-semibold leading-tight', tone)}>{verdict.statement}</p>
      <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
        {verdict.because}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="ops-well px-3 py-2.5">
          <div className="ops-eyebrow">Total passenger time</div>
          <div className={cn('mt-1 text-2xl tabular-nums', tone)}>
            {signedPct(verdict.passengerTimePercent)}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-subtle">
            the whole journey — kerb wait, dwell, hold and riding, each second counted once.{' '}
            <span className="text-muted-foreground">This is the verdict.</span>
          </div>
        </div>

        <div className="ops-well px-3 py-2.5">
          <div className="ops-eyebrow">Excess wait</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {verdict.excessWaitByPhase.map((phase) => (
              <span key={phase.id} className="leading-tight">
                <span
                  className={cn(
                    'text-2xl tabular-nums',
                    phase.percent === null
                      ? 'text-subtle'
                      : phase.percent > 0
                        ? 'text-success'
                        : 'text-destructive',
                  )}
                >
                  {signedPct(phase.percent)}
                </span>
                <span className="ml-1.5 text-[11px] text-subtle">{phase.title}</span>
              </span>
            ))}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-subtle">
            per passenger at a stop — the field&rsquo;s headline metric, and the one that improves
            when a hold is paid for by everyone already aboard. Never pooled across the two phases.
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The API's error code, as one of the states an operator can act on.
 *
 * Anything unrecognised is a plain failure rather than an outage: claiming a
 * service is unreachable on the strength of a code this console does not know
 * is exactly the over-claim that sent a supervisor to the wrong machine.
 */
function failureKindFor(code: string | undefined): TrialFailureKind {
  switch (code) {
    case 'CONTROL_SERVICE_TIMEOUT':
      return 'timed_out';
    case 'CONTROL_SERVICE_CIRCUIT_OPEN':
      return 'circuit_open';
    case 'TRIAL_ALREADY_RUNNING':
      return 'already_running';
    case 'CONTROL_SERVICE_UNAVAILABLE':
    case 'NOT_CONFIGURED':
      return 'unreachable';
    default:
      return 'failed';
  }
}

/**
 * What the trial is doing, or what became of it.
 *
 * ─── ONE PANEL FOR SIX OUTCOMES, BECAUSE THEY ARE ONE QUESTION ───────────
 *
 * "Is it still going, and if not, what happened" - asked in the same place
 * every time, so an operator never has to work out where the answer will
 * appear. The console had none of this: a 30-second inter-city run changed the
 * button's label and nothing else, which is long enough that a reasonable
 * person concludes the page has hung, clicks again, or reloads and loses it.
 *
 * ─── THE PROGRESS IS A COUNT, NOT A BAR ──────────────────────────────────
 *
 * Rendered through `OpsCoverage`, whose own rule this obeys: a percentage
 * hides the denominator, and the denominator is the honest part. The trial's
 * runs are not equal in cost - a phase run carries several times the fleet of
 * a study run - so a share of runs done is NOT a share of the wait, and a bar
 * drawn from it would be an estimate wearing a fact's clothes. What is offered
 * instead is true: the stage, the runs, and the elapsed time.
 *
 * The elapsed time is doing real work here and is never dropped, including
 * before the first run lands. A trial that has reported nothing yet is still
 * saying something an operator needs - that this page is alive and counting.
 */
function TrialRunStatus({
  run,
  hasReport,
  nowMs,
}: {
  run: TrialRunState;
  hasReport: boolean;
  nowMs: number;
}) {
  if (run.status === 'idle' || run.status === 'succeeded') return null;

  if (run.status === 'running') {
    const elapsed = elapsedLabel(nowMs - run.startedAtMs);
    return (
      <OpsAlert tone="info" title={`Running — ${elapsed} so far`}>
        {run.progress ? (
          <>
            <p>{run.progress.label}</p>
            <OpsCoverage
              className="mt-2"
              covered={run.progress.done}
              total={run.progress.total}
              noun="simulated runs finished"
              caveat="The runs are not all the same size, so this counts work done rather than time left — there is no honest estimate of when it will finish."
            />
          </>
        ) : (
          // Started, nothing finished yet. Saying "0 of 0" here would invent a
          // denominator; the elapsed clock in the title is the true part.
          <p>Starting the trial. It has not finished its first run yet.</p>
        )}
      </OpsAlert>
    );
  }

  if (run.status === 'timed_out') {
    // WARNING, not error, and the wording is the whole point. The service is
    // healthy - this console gave up - and the run is very likely still going.
    return (
      <OpsAlert tone="warning" title="The console stopped waiting — the trial probably has not">
        <p>{run.message}</p>
        <p className="mt-1">
          Nothing was lost and nothing was changed.{' '}
          {hasReport
            ? 'The result below is still the one that was there before.'
            : 'There is still no result on this page.'}
        </p>
      </OpsAlert>
    );
  }

  if (run.status === 'already_running') {
    return (
      <OpsAlert tone="warning" title="A trial is already running">
        <p>{run.message}</p>
        <p className="mt-1">
          It may have been started in another tab, or by somebody else — this simulator runs one
          trial at a time. Nothing was started twice, and nothing was lost.
        </p>
      </OpsAlert>
    );
  }

  if (run.status === 'circuit_open') {
    // The third of the three, and the only one that says "escalate". The
    // console is not failing to reach the service on this attempt - it has
    // stopped attempting, on the evidence of a measured streak.
    return (
      <OpsAlert tone="error" title="The console has stopped calling the simulator service">
        <p>{run.message}</p>
        <p className="mt-1">
          This is not one bad request: the service has been failing repeatedly, so this console
          paused to stop making it worse.{' '}
          {hasReport
            ? 'The result below is still the one that was there before.'
            : 'There is no earlier result to fall back on.'}
        </p>
      </OpsAlert>
    );
  }

  if (run.status === 'unreachable') {
    return (
      <OpsAlert tone="error" title="The simulator service could not be reached">
        <p>{run.message}</p>
        <p className="mt-1">
          {hasReport
            ? 'No trial was run, so the result below is still the one that was there before.'
            : 'No trial was run, and there is no earlier result to fall back on.'}
        </p>
      </OpsAlert>
    );
  }

  return (
    <OpsAlert tone="error" title="The trial did not finish">
      <p>{run.message}</p>
      <p className="mt-1">
        {hasReport
          ? 'The result below is still the one that was there before — it was not replaced by a run that failed.'
          : 'There is still no result on this page.'}
      </p>
    </OpsAlert>
  );
}

/** The fleet sizes the control offers by default. */
const FLEET_SIZES = [100, 250, 500, 1000] as const;

/**
 * The sizes the control offers, with whatever the loaded report actually ran.
 *
 * A report run through the API at a size this list does not hold - a 60-bus
 * diagnostic run, say - would otherwise leave the control showing a size the
 * report on screen was not run at, which is precisely the mismatch that let
 * that run be read as a fleet trial. The control has to be able to say what
 * happened before it can be trusted to say what will.
 */
function fleetSizeOptions(ran: number | null): number[] {
  const sizes = new Set<number>(FLEET_SIZES);
  if (ran !== null && ran > 0) sizes.add(ran);
  return [...sizes].sort((a, b) => a - b);
}

/**
 * How often the console asks the trial what it is doing.
 *
 * One second. The trial's own runs land faster than that on a small fleet and
 * slower on a large one, so this is not tuned to them - it is tuned to a
 * person watching a page, for whom a count that moves about once a second
 * reads as alive and one that moves every five reads as stuck.
 */
const PROGRESS_POLL_MS = 1_000;

export function SimulatorConsole({ initialReport }: { initialReport: FleetTrialReport | null }) {
  // ─── ONE REDUCER, NOT FIVE useStates ─────────────────────────────────
  //
  // The report, whose report it is, and what became of the last run move
  // TOGETHER: a run that fails must leave the first two untouched, and a run
  // that succeeds must replace both in the same step or there is a render
  // between them showing neither. Held as separate pieces of state those are
  // rules nobody can check; held in `fleetTrialRun.ts` they are tested,
  // including the four failure outcomes that cannot be produced by hand.
  const [state, dispatch] = useReducer(
    trialConsoleReducer,
    initialReport,
    initialTrialConsoleState,
  );
  const { report, origin, run } = state;
  const [phaseId, setPhaseId] = useState(initialReport?.phases[0]?.id ?? 'occupancy_blind');
  const running = run.status === 'running';

  // A clock that ticks only while a run is in flight. Read in the browser
  // only - it starts at 0 and is never rendered until a run has been started
  // by a click, so it cannot differ between server and client paint.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!running) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  // Seeded from the loaded report, not from a fixed default. The controls
  // describe the next run, and a control saying 1,000 above a 60-bus report is
  // exactly how a 60-bus diagnostic run came to be read as a fleet trial.
  const initialProvenance = initialReport ? trialProvenance(initialReport, 'stored') : null;
  const [vehiclesPerPhase, setVehiclesPerPhase] = useState<number>(
    initialProvenance?.vehiclesPerPhase ?? 500,
  );
  const [corridorPreset, setCorridorPreset] = useState<CorridorPresetId>(
    initialProvenance?.corridorPresetId ?? 'intercity',
  );

  /**
   * Ask the trial what it is doing, and say nothing if it will not answer.
   *
   * A failed poll is NOT a failed trial and must never be reported as one:
   * the POST is what decides the run's outcome. A dropped poll while the
   * trial is perfectly healthy would otherwise turn a good run into a
   * reported failure, which is the same class of wrong message this whole
   * change exists to remove.
   */
  const pollProgress = useCallback(async () => {
    try {
      const response = await fetch('/api/ops/control-room/fleet-trial/progress', {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (
        typeof body === 'object' &&
        body !== null &&
        (body as { running?: boolean }).running === true
      ) {
        const p = body as {
          done: number;
          total: number | null;
          stage: TrialStage | null;
          label: string | null;
        };
        // A run the service has started but which has not finished its first
        // unit has no total yet. Nothing is rendered from a half-known
        // progress: the elapsed clock already says the run is alive.
        if (p.total === null || p.stage === null) return;
        dispatch({
          type: 'progress',
          progress: { done: p.done, total: p.total, stage: p.stage, label: p.label ?? '' },
        });
      }
    } catch {
      // Same rule: silence, not a failure.
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    let live = true;
    const tick = () => {
      if (live) void pollProgress();
    };
    tick();
    const timer = setInterval(tick, PROGRESS_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [running, pollProgress]);

  const startRun = useCallback(async () => {
    // ─── THE DOUBLE CLICK, GUARDED THREE TIMES ────────────────────────
    //
    // Here, in the reducer (which ignores `run_requested` while running), and
    // at the control service (which refuses a second trial with a 409). The
    // button is also disabled. Three, because they cover different things:
    // the button covers a click, the reducer covers this component, and only
    // the service covers a second TAB - which is exactly what somebody does
    // when a page looks hung.
    if (running) return;
    dispatch({ type: 'run_requested', atMs: Date.now() });
    try {
      const response = await fetch('/api/ops/control-room/fleet-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiclesPerPhase, corridorPreset }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const error =
          typeof body === 'object' && body !== null && 'error' in body
            ? (body as { error?: { code?: string; message?: string } }).error
            : undefined;
        dispatch({
          type: 'failed',
          kind: failureKindFor(error?.code),
          message: error?.message ?? 'The trial could not be run.',
        });
        return;
      }
      const fresh = body as FleetTrialReport;
      dispatch({ type: 'succeeded', report: fresh, atMs: Date.now() });
      setPhaseId(fresh.phases[0]?.id ?? 'occupancy_blind');
    } catch {
      // fetch itself rejected: the network went, or the page is offline.
      // Nothing answered, so this is the unreachable case, not a timeout.
      dispatch({
        type: 'failed',
        kind: 'unreachable',
        message: 'The simulator service could not be reached. Nothing was changed.',
      });
    }
  }, [vehiclesPerPhase, corridorPreset, running]);

  const phase = useMemo(
    () => report?.phases.find((p) => p.id === phaseId) ?? report?.phases[0] ?? null,
    [report, phaseId],
  );

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-muted-foreground">
        <span className="ops-eyebrow block">Corridor</span>
        <OpsSelect
          className="mt-1"
          value={corridorPreset}
          onChange={(event) => setCorridorPreset(event.target.value as CorridorPresetId)}
          disabled={running}
        >
          <option value="intercity">400 km inter-city trunk</option>
          <option value="suburban">60 km suburban radial</option>
          <option value="urban">24 km city trunk</option>
        </OpsSelect>
      </label>
      <label className="text-xs text-muted-foreground">
        <span className="ops-eyebrow block">Buses per phase</span>
        <OpsSelect
          className="mt-1"
          value={vehiclesPerPhase}
          onChange={(event) => setVehiclesPerPhase(Number(event.target.value))}
          disabled={running}
        >
          {fleetSizeOptions(initialProvenance?.vehiclesPerPhase ?? null).map((n) => (
            <option key={n} value={n}>
              {n} ({n * 2} in all)
            </option>
          ))}
        </OpsSelect>
      </label>
      <OpsButton variant="primary" onClick={() => void startRun()} disabled={running}>
        {running ? 'Running…' : report ? 'Run again' : 'Run the trial'}
      </OpsButton>
    </div>
  );

  if (!report) {
    return (
      <div className="space-y-4">
        <TrialRunStatus run={run} hasReport={false} nowMs={nowMs} />
        <OpsPanel
          title="No trial has been run yet"
          description="The simulator holds its last result in memory and loses it when the service restarts. Running one takes about half a minute on the largest corridor, and writes nothing anywhere."
          actions={controls}
        >
          <p className="max-w-prose text-sm text-muted-foreground">
            The trial runs the deployed control laws — the same modules the live decision cycle
            calls — against a thousand buses on a 400 km corridor with ten holding points, across
            every way a corridor comes apart, in two phases that differ only in whether the
            objective weighs how many passengers are aboard. Every result is shown beside what the
            same day would have done with nobody intervening.
          </p>
        </OpsPanel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        Above the provenance banner, and above the report. What became of the
        run the operator just started is the first thing they are looking for,
        and a failure notice below a full report reads as though the report
        were the answer to it.
      */}
      <TrialRunStatus run={run} hasReport nowMs={nowMs} />

      <TrialAnswer report={report} origin={origin} controls={controls} />

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

      {/* ─── EVERYTHING BELOW IS ABOUT THE TRIAL, NOT ABOUT THE PHASE ────
          The policy sweeps are ~87% of the run's wall clock and the single
          largest block of text on the page, and they answer a question an
          operator asks second at the earliest: not "did it help" but "what
          should this knob be set to". They stay closed until somebody asks. */}
      <OpsDisclosure
        title="Policy studies"
        count={`${report.policyStudies.length} knobs swept`}
        description="What each per-corridor policy knob is worth, swept across its range. These are route_policies columns, and a value fitted on one corridor can be actively harmful on another."
      >
        <div className="space-y-3">
          {report.policyStudies.map((study) => (
            <OpsDisclosure
              key={study.knob}
              title={study.title}
              count={`${study.rows.length} settings`}
              description={`${study.description} Each row is the same fleet and the same scenarios, averaged over ${study.seedsPerRow} seeds.`}
            >
              <p className="mb-4 max-w-prose text-sm text-muted-foreground">{study.verdict}</p>
              <OpsTableFrame>
                <table className={opsTableClass}>
                  <thead>
                    <tr className={opsTheadRowClass}>
                      <th className={opsThClass}>{study.knob}</th>
                      <th className={opsThClass}>Excess wait</th>
                      <th className={opsThClass}>Total passenger time</th>
                      <th className={opsThClass}>Hold per bus</th>
                      <th className={opsThClass}>Worst bus</th>
                      <th className={opsThClass}>Refused a seat</th>
                      <th className={opsThClass}>Incidents avoided</th>
                      <th className={opsThClass}>Seeds agreeing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {study.rows.map((row) => {
                      const net = row.passengerSecondsSavedPercent;
                      return (
                        <tr key={row.label} className={opsTrClass}>
                          <td className={opsTdClass}>
                            {row.label}
                            {row.label === study.recommended ? (
                              <span className="ml-2">
                                <OpsBadge variant="live">best</OpsBadge>
                              </span>
                            ) : null}
                            {row.isCurrent ? (
                              <div className="text-[11px] text-subtle">currently configured</div>
                            ) : null}
                          </td>
                          <td className={opsTdNumericClass}>
                            <span
                              className={
                                (row.ewtImprovementPercent ?? 0) > 0
                                  ? 'text-success'
                                  : 'text-destructive'
                              }
                            >
                              {pct(row.ewtImprovementPercent, 0)}
                            </span>
                          </td>
                          <td className={opsTdNumericClass}>
                            <span
                              className={
                                net !== null && net >= 0 ? 'text-success' : 'text-destructive'
                              }
                            >
                              {net === null ? '—' : `${net > 0 ? '+' : ''}${net.toFixed(1)}%`}
                            </span>
                          </td>
                          <td className={opsTdNumericClass}>
                            {mins(row.meanHoldSecondsPerVehicle)}
                          </td>
                          <td className={opsTdNumericClass}>{mins(row.worstBusHoldSeconds)}</td>
                          <td className={opsTdNumericClass}>{num(row.deniedBoardings)}</td>
                          <td className={opsTdNumericClass}>{num(row.incidentsAvoided)}</td>
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
                Excess wait is sampled at <em>every</em> station, not only the ones designated for
                holding — otherwise each row would be scored on a different set of stops. One seed
                is not enough to read: a row whose seeds do not agree on the sign is no measured
                effect, however large its mean. These are <code>route_policies</code> columns, and a
                value fitted on one corridor can be actively harmful on another — which is why they
                are swept here rather than fixed.
              </p>
            </OpsDisclosure>
          ))}
        </div>
      </OpsDisclosure>

      <OpsDisclosure
        title="What weighing passenger load changed"
        description="Measured by re-running the occupancy-aware phase's own scenarios with the switch off — same corridor, same plan, same seed, one input different."
      >
        <p className="max-w-prose text-sm text-muted-foreground">
          {report.occupancyContrast.verdict}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <OpsStat
            label="Decisions compared"
            value={num(report.occupancyContrast.decisionsCompared)}
          />
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
      </OpsDisclosure>

      <OpsDisclosure
        title="Where the numbers came from, and what this does not cover"
        count={`${report.provenance.length} fields · ${report.notExercised.length} limits`}
        description="Field by field: what is deployed code, what was chosen, and what was invented — beside the list of things a result off this page must not be read as covering."
      >
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
                        entry.source === 'deployed'
                          ? 'live'
                          : entry.source === 'configured'
                            ? 'neutral'
                            : 'sim'
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
                <li
                  key={item}
                  className="max-w-prose text-xs leading-relaxed text-muted-foreground"
                >
                  {item}
                </li>
              ))}
            </ul>
          </OpsPanel>
        </OpsGrid>
      </OpsDisclosure>
    </div>
  );
}
