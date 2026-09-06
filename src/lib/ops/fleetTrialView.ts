/**
 * What the simulator's top line says, and whose report it is.
 *
 * Two rules that both belong to REPORTING rather than to the controller, kept
 * here because the page (a server component) and the console (a client one)
 * both need them and neither may derive them differently.
 *
 * ─── 1. THE HEADLINE POOLS ONLY WHAT CAN BE READ ─────────────────────────
 *
 * The scenario library contains scenarios that exist to prove the harness
 * reports NOTHING: `oversaturated` runs the corridor past the denied-boarding
 * line, where waiting time is bounded by how many seats exist rather than by
 * how they are spaced, so spacing control cannot move the figure and a working
 * controller correctly reports no effect. Pooling one of those in with
 * eighteen readable scenarios does not average an effect, it dilutes one
 * towards zero with a measurement that never carried a signal.
 *
 * MEASURED on urban at 500 buses/phase: all nineteen scenarios gave a net
 * passenger time of +0.8%; the eighteen readable ones gave +2.5%. Anyone
 * comparing +0.8% with last week's number would have concluded the controller
 * had got three times worse overnight, when what changed was the test set.
 *
 * The control service decides the scope (`FleetTrialReport.headlineScope`) and
 * publishes both pools. This module only presents them, and it presents BOTH -
 * the all-scenarios figure is never dropped, only labelled.
 *
 * ─── 2. A REPORT THE READER DID NOT RUN IS SAID TO BE ONE ────────────────
 *
 * `GET /v1/fleet-trial/latest` serves the last report the control-service
 * process produced, to every caller: a trial anyone runs through the API
 * overwrites what the next person sees, and a restart loses it entirely. The
 * page rendered that on load with no statement of when it was produced, at
 * what fleet size or on which corridor - which is how a 60-bus diagnostic run
 * reporting -7.9% was read off a page whose own controls said 1,000 buses.
 *
 * The fix is provenance, not per-user state in the control service. A trial is
 * a pure computation over its own spec and writes nothing; the report is not
 * private data and there is no user to attach it to at that layer. Giving the
 * service sessions to solve a labelling problem would add state to a
 * deliberately stateless endpoint and still leave the label missing. So the
 * page says what the report IS - when, which corridor, how many buses, and
 * whether the reader is looking at their own run or at whatever ran last.
 */
import type { CorridorPresetId } from '@/models/fleetTrial';

// ─── The headline ─────────────────────────────────────────────────────────

/** Just enough of a phase to build a passenger-time percent from. */
interface NetPassengerTimePhase {
  contrast: { passengerSecondsSaved: number };
  uncontrolled: { passengers: { totalPassengerSeconds: number } };
  allScenarios: {
    contrast: { passengerSecondsSaved: number };
    uncontrolled: { passengers: { totalPassengerSeconds: number } };
  };
}

export interface NetPassengerTimeInput {
  headlineScope: {
    includedScenarioIds: readonly string[];
    excludedScenarios: readonly { id: string; title: string; deniedShare: number }[];
    fellBackToAllScenarios: boolean;
    note: string;
  };
  phases: readonly NetPassengerTimePhase[];
}

export interface NetPassengerTimeView {
  /** The figure to lead with: the scenarios whose numbers can be read. Null when no passenger time was billed at all. */
  headlinePercent: number | null;
  /** The same trial over every scenario it ran, including any built to report nothing. */
  allScenariosPercent: number | null;
  includedScenarioCount: number;
  totalScenarioCount: number;
  excludedScenarios: readonly { id: string; title: string; deniedShare: number }[];
  /** True when the two figures are not the same number, which is the only case worth explaining. */
  differs: boolean;
  fellBackToAllScenarios: boolean;
  note: string;
}

/**
 * Passenger-seconds summed across phases and divided ONCE.
 *
 * Not a mean of the phases' own percents: the two phases carry different
 * fleets and different passenger bills, so averaging percents weights the
 * smaller phase equally with the larger one, and the arithmetic does not
 * commute. Same reason `run.ts#poolArm` pools samples rather than means.
 */
function netPercent(
  phases: readonly NetPassengerTimePhase[],
  pick: (phase: NetPassengerTimePhase) => {
    contrast: { passengerSecondsSaved: number };
    uncontrolled: { passengers: { totalPassengerSeconds: number } };
  },
): number | null {
  let saved = 0;
  let total = 0;
  for (const phase of phases) {
    const part = pick(phase);
    saved += part.contrast.passengerSecondsSaved;
    total += part.uncontrolled.passengers.totalPassengerSeconds;
  }
  // Null, not zero. No passenger time billed is an absence; zero would read as
  // "the controller changed nothing", which is a measurement.
  return total > 0 ? (saved / total) * 100 : null;
}

export function headlineNetPassengerTime(report: NetPassengerTimeInput): NetPassengerTimeView {
  const headlinePercent = netPercent(report.phases, (phase) => phase);
  const allScenariosPercent = netPercent(report.phases, (phase) => phase.allScenarios);
  const included = report.headlineScope.includedScenarioIds.length;
  const excluded = report.headlineScope.excludedScenarios;

  return {
    headlinePercent,
    allScenariosPercent,
    includedScenarioCount: included,
    totalScenarioCount: included + excluded.length,
    excludedScenarios: excluded,
    differs: headlinePercent !== allScenariosPercent,
    fellBackToAllScenarios: report.headlineScope.fellBackToAllScenarios,
    note: report.headlineScope.note,
  };
}

// ─── Whose report this is ─────────────────────────────────────────────────

export interface TrialProvenanceInput {
  generatedAt: string;
  corridorPreset: { id: string; title: string; description: string };
  vehiclesSimulated: number;
  phases: readonly { vehicleCount: number }[];
}

/** Where the report on screen came from. Not a property of the report - a property of this page load. */
export type TrialOrigin = 'stored' | 'this-session';

export interface TrialProvenanceView {
  isThisSessionsRun: boolean;
  /** Absolute time the trial ran, or null when the service sent something that is not a date. */
  generatedAtLabel: string | null;
  /** How long ago, in words. Null on an unparseable timestamp OR before the clock is available - never a guess. */
  age: string | null;
  /** Old enough that the deployed laws it measured may no longer be the deployed laws. */
  stale: boolean;
  corridorPresetId: CorridorPresetId | null;
  corridorTitle: string;
  /** Buses per phase, read off the report itself. The page controls describe the NEXT run, not this one. */
  vehiclesPerPhase: number | null;
  vehiclesSimulated: number;
  /** One line: corridor, fleet, and when. */
  summary: string;
  /** One line: who this belongs to. */
  ownership: string;
}

const PRESET_IDS: readonly string[] = ['intercity', 'suburban', 'urban'];

/**
 * Six hours.
 *
 * Not a freshness contract - a trial is reproducible from its own spec and
 * does not decay. It is the point past which "the deployed laws" the report
 * measured may not be the deployed laws any more, which is the only claim on
 * the page that time can invalidate.
 */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function ageInWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.round(ms / 3_600_000);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

/**
 * `now` is null when the reader's clock is not available yet.
 *
 * ─── WHY THE CLOCK IS PASSED IN AND NOT READ HERE ────────────────────────
 *
 * The console is a client component, so Next renders it on the SERVER for the
 * first paint and again in the browser to hydrate. A relative age read off
 * `new Date()` in both places is two different strings, which is a hydration
 * mismatch - and "23 minutes ago" flickering to "24 minutes ago" is the mild
 * version; React discarding the server HTML is the other one. So the age and
 * the staleness verdict are absent until the component has mounted and can
 * pass a real clock, and everything the report itself knows - corridor, fleet,
 * absolute timestamp - is rendered on the first paint regardless.
 */
export function trialProvenance(
  report: TrialProvenanceInput,
  origin: TrialOrigin,
  now: Date | null = null,
): TrialProvenanceView {
  const generatedMs = Date.parse(report.generatedAt);
  const parsed = Number.isFinite(generatedMs);
  const elapsedMs = parsed && now !== null ? Math.max(0, now.getTime() - generatedMs) : 0;
  const isThisSessionsRun = origin === 'this-session';

  const vehiclesPerPhase = report.phases[0]?.vehicleCount ?? null;
  const corridorPresetId = PRESET_IDS.includes(report.corridorPreset.id)
    ? (report.corridorPreset.id as CorridorPresetId)
    : null;
  const age = parsed && now !== null ? ageInWords(elapsedMs) : null;

  const fleet = vehiclesPerPhase === null ? null : `${vehiclesPerPhase.toLocaleString()} buses per phase`;
  const summary = [
    report.corridorPreset.title,
    fleet,
    age === null ? null : `run ${age}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return {
    isThisSessionsRun,
    generatedAtLabel: parsed ? new Date(generatedMs).toISOString() : null,
    age,
    // A run the reader just triggered is never stale, whatever the clock says:
    // `generatedAt` is the service's clock, and skew there must not make a
    // fresh run look old.
    stale: !isThisSessionsRun && parsed && now !== null && elapsedMs > STALE_AFTER_MS,
    corridorPresetId,
    corridorTitle: report.corridorPreset.title,
    vehiclesPerPhase,
    vehiclesSimulated: report.vehiclesSimulated,
    summary,
    ownership: isThisSessionsRun
      ? 'You ran this trial from this page. The numbers below are that run.'
      : 'This is the last trial this service ran, and it may not be yours — anyone with API access overwrites it, and a restart loses it. Run one to get your own.',
  };
}
