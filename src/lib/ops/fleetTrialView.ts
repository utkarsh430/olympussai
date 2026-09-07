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

// ─── The one-line answer ──────────────────────────────────────────────────

/**
 * Did the controller help, or not.
 *
 * ─── WHY THE SENTENCE IS DECIDED ON PASSENGER TIME ───────────────────────
 *
 * Excess wait is the field's headline metric and it is on the page beside
 * this, but it cannot be the verdict: it counts only the people standing at
 * stops, and holding a bus to help them is paid for by everyone already
 * aboard. This trial has already found a configuration that improved excess
 * wait 46% while making total passenger time 12% WORSE. A page whose one-line
 * answer came off excess wait would have called that a success.
 *
 * So the sentence comes off net total passenger time - the whole journey,
 * every second counted once - pooled across phases by `headlineNetPassengerTime`,
 * which divides once rather than averaging two percents over two different
 * passenger bills.
 *
 * ─── AND WHY A SIGN IS NOT ENOUGH TO CLAIM ONE ───────────────────────────
 *
 * The trial's own headline is ONE SEED per scenario, so a small mean with the
 * scenarios split about evenly either side of zero is not a small effect, it
 * is no measured effect. The page already applies exactly this rule to the
 * policy sweeps ("a row whose seeds do not agree on the sign is no measured
 * effect, however large its mean") and this applies the same test to the
 * verdict rather than inventing a second, softer one for the top line: the
 * scenarios have to agree with the sign of the pooled figure before the page
 * will say the word "helped".
 *
 * TWO tests, and both have to pass, because each catches a different lie.
 * Agreement catches a large mean carried by one scenario. It does NOT catch a
 * figure too small to have been resolved at all: on the inter-city preset a
 * measured +0.1% came with 21 of 38 scenarios agreeing - a coin flip on a
 * corridor the repo already records as "zero to within +/- 0.5" - and the
 * agreement test alone let the page say "the controller helped" about it.
 *
 * `NET_PASSENGER_TIME_NOISE_PCT` is that second test and it is a MEASUREMENT,
 * not a taste: over six seeds at 250 buses/phase the trial reads urban
 * +2.9% +/- 0.3, suburban +0.5% +/- 0.3, and inter-city zero to within +/- 0.5
 * (AGENTS.md, "Report the seed spread, never a single run"). Half a point is
 * the seed-to-seed spread on the flattest of the three, and the headline is a
 * SINGLE draw, so a pooled figure smaller than that in magnitude is inside the
 * noise of the one draw it came from. Urban's +2.9% clears it by six times
 * over; inter-city's +0.1% does not clear it at all, which is the right answer.
 *
 * Both figures are still published either way - this decides the WORD, never
 * which numbers are shown.
 *
 * `scenarioAgreement` deliberately counts EVERY scenario, including any the
 * headline pool excludes, because a scenario built to lose is exactly where a
 * broad claim should be visible. That is why the agreement count here can name
 * a larger denominator than the headline's scenario count, and why both are
 * reported rather than reconciled.
 */
export type TrialVerdict = 'helped' | 'cost_more' | 'no_effect' | 'unreadable';

/** Just enough of a phase to decide a verdict from. */
interface VerdictPhase extends NetPassengerTimePhase {
  id: string;
  title: string;
  scenarioAgreement: { positive: number; count: number };
  contrast: { passengerSecondsSaved: number; ewtImprovementPercent: number | null };
}

export interface TrialVerdictInput extends NetPassengerTimeInput {
  phases: readonly VerdictPhase[];
}

export interface TrialVerdictView {
  verdict: TrialVerdict;
  /** The whole answer in one sentence, with no number in it. */
  statement: string;
  /** Why that word and not another one, in one more sentence. */
  because: string;
  /** Net total passenger time, pooled across phases. The figure the verdict is taken on. */
  passengerTimePercent: number | null;
  /**
   * Excess wait per phase, never pooled. `poolArm` recomputes excess wait from
   * the raw headway samples rather than averaging per-run means, so there is no
   * honest way to combine two phases' published figures into one - and the two
   * phases are two configurations of the controller, which is worth seeing
   * separately anyway.
   */
  excessWaitByPhase: readonly { id: string; title: string; percent: number | null }[];
  /** How many scenarios landed on the same side of zero as the pooled figure, of how many ran. */
  agreeingScenarios: number;
  totalScenariosCounted: number;
}

/**
 * The seed-to-seed spread of net passenger time, in percentage points.
 *
 * MEASURED, over six seeds at 250 buses/phase: urban +2.9% +/- 0.3, suburban
 * +0.5% +/- 0.3, inter-city zero to within +/- 0.5. Half a point is the spread
 * on the flattest of the three corridors, and the page's headline is ONE draw,
 * so a pooled figure smaller than this cannot be told apart from the noise of
 * the draw it came from. Raise it only against a new measurement of the same
 * kind, never to make a result look stronger.
 */
export const NET_PASSENGER_TIME_NOISE_PCT = 0.5;

const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;

export function trialVerdict(report: TrialVerdictInput): TrialVerdictView {
  const headline = headlineNetPassengerTime(report);
  const percent = headline.headlinePercent;

  // The agreement test runs on the sign the pooled figure actually has. A
  // controller that made things worse on sixteen of nineteen scenarios is a
  // BROAD result, not a weak one, and counting only the positive scenarios
  // would have reported it as "no effect measured".
  let positive = 0;
  let counted = 0;
  for (const phase of report.phases) {
    positive += phase.scenarioAgreement.positive;
    counted += phase.scenarioAgreement.count;
  }
  const agreeing = percent === null || percent >= 0 ? positive : counted - positive;

  const excessWaitByPhase = report.phases.map((phase) => ({
    id: phase.id,
    title: phase.title,
    percent: phase.contrast.ewtImprovementPercent,
  }));

  const base = {
    passengerTimePercent: percent,
    excessWaitByPhase,
    agreeingScenarios: agreeing,
    totalScenariosCounted: counted,
  };

  if (headline.fellBackToAllScenarios || percent === null) {
    return {
      ...base,
      verdict: 'unreadable',
      statement: 'This trial cannot say whether the controller helped.',
      because:
        percent === null
          ? 'No passenger time was billed on either arm, so there is nothing to compare.'
          : 'Every scenario it ran went past the saturation line, where waiting is bounded by how many seats exist rather than by how they are spaced — so a working controller correctly moves nothing, and the figures below are a check on the harness rather than a verdict on the controller.',
    };
  }

  // Inside the seed-to-seed spread the trial itself shows on its flattest
  // corridor, so this single draw cannot resolve a direction at all.
  if (Math.abs(percent) < NET_PASSENGER_TIME_NOISE_PCT) {
    return {
      ...base,
      verdict: 'no_effect',
      statement: 'This trial did not measure an effect.',
      because: `At ${signed(percent)} the figure is smaller than the ${NET_PASSENGER_TIME_NOISE_PCT}-point spread the same trial shows between seeds on its flattest corridor, and this headline is a single draw. Run it again on more seeds before reading a direction into it.`,
    };
  }

  // Strictly more than half, so an even split is never read as agreement.
  if (counted > 0 && agreeing * 2 <= counted) {
    return {
      ...base,
      verdict: 'no_effect',
      statement: 'This trial did not measure an effect.',
      because: `The scenarios do not agree on the sign — ${agreeing} of ${counted} landed on the same side of zero as the ${percent >= 0 ? 'positive' : 'negative'} total. One seed per scenario is one draw, so a mean without agreement behind it is not a result, however large it looks.`,
    };
  }

  if (percent >= 0) {
    return {
      ...base,
      verdict: 'helped',
      statement: 'The controller helped.',
      because: `It gave passengers back ${percent.toFixed(1)}% of their total journey time, and ${agreeing} of ${counted} scenarios agreed on the sign.`,
    };
  }

  return {
    ...base,
    verdict: 'cost_more',
    statement: 'The controller cost more than it saved.',
    because: `It added ${Math.abs(percent).toFixed(1)}% to total passenger time — the waiting it removed at stops was smaller than the delay it imposed on people already aboard — and ${agreeing} of ${counted} scenarios agreed on the sign.`,
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

  const fleet =
    vehiclesPerPhase === null ? null : `${vehiclesPerPhase.toLocaleString()} buses per phase`;
  const summary = [report.corridorPreset.title, fleet, age === null ? null : `run ${age}`]
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
