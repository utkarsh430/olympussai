/**
 * The view model every scene on /trial renders from.
 *
 * `resolveShowcase` merges two sources: the authored figures in `figures.ts`
 * (which win wherever they are set) and the real trial shapes in
 * `generated/trialData.json` (trajectories, incident curves, station holds,
 * per-scenario results, arm summaries). Scenes take slices of the result as
 * props and carry no numbers of their own.
 *
 * Every corridor the data carries is resolved: the live replay, the gallery
 * and the report all offer the three routes, while the hero, verdict,
 * pipeline and balance tell the story of the lead corridor.
 *
 * No `'use client'`: the server page calls this and passes slices down.
 */
import type { BunchingScenarioId } from '@/models/fleetTrial';
import { LAW_LABEL } from '@/models/fleetTrial';
import { routeForPreset, stopForSequence, type CorridorRoute, type CorridorStop } from './corridor';
import type {
  ControllabilityBand,
  CorridorFigure,
  LawFigure,
  PipelineStageFigure,
  ShowcaseFigures,
} from './figures';
import {
  corridorData,
  headlinePhase,
  type TrialArmSummary,
  type TrialContrast,
  type TrialCorridorData,
  type TrialData,
  type TrialPhase,
  type TrialScenario,
  type TrialSweepPoint,
  type TrialTrajectory,
} from './trialData';

// ─── Shared atoms ─────────────────────────────────────────────────────────

/** One number a scene shows with a label. Decimals default to 0. */
export interface StatFigure {
  id: string;
  label: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  note?: string;
}

export type ScenarioFamily = 'corridor' | 'estimator' | 'adversarial';
export type ScenarioOutcome = 'helped' | 'no_effect' | 'stress_test';

// ─── Scene models ─────────────────────────────────────────────────────────

export interface HeroModel {
  eyebrow: string;
  title: string;
  subtitle: string;
  stats: readonly StatFigure[];
  networkBuses: number;
}

export interface CorridorTile {
  presetId: string;
  name: string;
  shape: string;
  netPercent: number;
  excessWaitPercent: number;
  seedsAgreeing: number;
  seedsTotal: number;
  band: ControllabilityBand;
  bandLabel: string;
}

export interface VerdictModel {
  sentence: string;
  because: string;
  netPercent: number;
  excessWaitPercent: number;
  corridors: readonly CorridorTile[];
}

export interface ReplayScenarioModel {
  id: BunchingScenarioId;
  title: string;
  note: string;
  horizonSeconds: number;
  vehicleCount: number;
  trajectories: {
    controlled: readonly TrialTrajectory[];
    uncontrolled: readonly TrialTrajectory[];
  };
  sweeps: {
    controlled: readonly TrialSweepPoint[];
    uncontrolled: readonly TrialSweepPoint[];
  };
  netPercent: number | null;
  excessWaitPercent: number | null;
  incidentsAvoided: number;
}

/** One route in the live trial: its geometry, its thresholds and its replayable scenarios. */
export interface LiveCorridorModel {
  presetId: string;
  name: string;
  shape: string;
  netPercent: number;
  excessWaitPercent: number;
  route: CorridorRoute;
  /** The simulator's own corridor length; trajectories' `d` is in these metres. */
  trialCorridorLengthMeters: number;
  targetHeadwaySeconds: number;
  bunchedThresholdRatio: number;
  warningThresholdRatio: number;
  /** Station names in sequence order, from the map corridor. */
  stationNames: readonly string[];
  scenarios: readonly ReplayScenarioModel[];
}

export interface LiveTrialModel {
  corridors: readonly LiveCorridorModel[];
}

export interface ScenarioCardModel {
  id: BunchingScenarioId;
  title: string;
  whatGoesWrong: string;
  family: ScenarioFamily;
  outcome: ScenarioOutcome;
  netPercent: number | null;
  excessWaitPercent: number | null;
  incidentsBefore: number;
  incidentsAfter: number;
  horizonSeconds: number;
  sweeps: {
    controlled: readonly TrialSweepPoint[];
    uncontrolled: readonly TrialSweepPoint[];
  };
}

export interface GalleryCorridorModel {
  presetId: string;
  name: string;
  shape: string;
  cards: readonly ScenarioCardModel[];
  families: readonly { id: ScenarioFamily; label: string; count: number }[];
}

export interface GalleryModel {
  /** The lead corridor's cards, for a scene that does not switch. */
  cards: readonly ScenarioCardModel[];
  families: readonly { id: ScenarioFamily; label: string; count: number }[];
  /** Every corridor's cards, in preset order, for the corridor toggle. */
  corridors: readonly GalleryCorridorModel[];
}

export interface LawBarModel {
  id: string;
  name: string;
  oneLiner: string;
  decisionsGenerating: number;
  decisionsTotal: number;
  sharePercent: number;
  holdCount: number;
  holdSeconds: number;
}

export interface StationHoldModel {
  sequence: number;
  name: string;
  holdSeconds: number;
  holdCount: number;
  /** 0..1 of the busiest station. */
  share: number;
}

export interface PipelineModel {
  stages: readonly PipelineStageFigure[];
  laws: readonly LawBarModel[];
  stationHolds: readonly StationHoldModel[];
  detector: ShowcaseFigures['detector'];
}

export interface BalanceModel {
  waitingRemovedHours: number;
  timeAboardAddedHours: number;
  netHoursSaved: number;
  netPercent: number;
  excessWaitPercent: number;
  incidents: {
    before: { detected: number; resolvedPercent: number };
    after: { detected: number; resolvedPercent: number };
    cutPercent: number;
  };
  onTime: { beforePercent: number; afterPercent: number };
  holdMinutesPerBus: number;
}

export interface ScaleModel {
  fromBuses: number;
  toBuses: number;
  stats: readonly StatFigure[];
}

// ─── The report ───────────────────────────────────────────────────────────

/** The change cell of a comparison row: an improvement with a direction, a cost stated in words, or nothing measurable. */
export type ReportChange =
  { kind: 'improvement'; percent: number; good: boolean } | { kind: 'cost'; label: string } | null;

/**
 * One measurement, both arms, the change: the ops console's own comparison
 * table (`SimulatorConsole.tsx#ArmContrastTable`), carried into the report
 * with the same rows, hints and arrow rule.
 */
export interface ReportComparisonRow {
  id: string;
  label: string;
  hint: string | null;
  leftAlone: string;
  leftAloneNote: string | null;
  underControl: string;
  underControlNote: string | null;
  change: ReportChange;
}

export interface ReportCorridorRow {
  presetId: string;
  name: string;
  shape: string;
  lengthKm: number;
  stops: number;
  headwayMinutes: number;
  band: ControllabilityBand;
  bandLabel: string;
  maxHoldSeconds: number;
  netPercent: number;
  excessWaitCutPercent: number;
  /** The trial's own uncontrolled excess wait; the "after" is derived from the authored cut. */
  ewtBeforeSeconds: number | null;
  ewtAfterSeconds: number | null;
  headwayCvBefore: number | null;
  headwayCvAfter: number | null;
  bunchingRateBefore: number;
  bunchingRateAfter: number;
  incidentsBefore: number;
  incidentsAfter: number;
  resolvedBeforePercent: number | null;
  resolvedAfterPercent: number | null;
  onTimeBeforePercent: number | null;
  onTimeAfterPercent: number | null;
  meanHoldSecondsPerVehicle: number;
  deniedBefore: number;
  deniedAfter: number;
  seedsAgreeing: number;
  seedsTotal: number;
  scenariosPooled: number;
  scenariosExcluded: number;
  conclusion: string;
  comparison: readonly ReportComparisonRow[];
}

export interface ReportScenarioRow {
  id: BunchingScenarioId;
  title: string;
  family: ScenarioFamily;
  familyLabel: string;
  netPercent: number | null;
  excessWaitPercent: number | null;
  incidentsBefore: number;
  incidentsAfter: number;
  outcome: ScenarioOutcome;
  outcomeLabel: string;
}

export interface ReportActivityModel {
  presetId: string;
  name: string;
  laws: readonly LawBarModel[];
  /** The busiest eight stations by hold time, in route order. */
  stationHolds: readonly StationHoldModel[];
}

export interface ReportModel {
  title: string;
  reference: string;
  generatedAt: string;
  generatedLabel: string;
  setup: readonly { label: string; value: string }[];
  summary: {
    sentence: string;
    because: string;
    netPercent: number;
    excessWaitPercent: number;
    corridorLines: readonly string[];
  };
  corridors: readonly ReportCorridorRow[];
  scenarios: readonly { presetId: string; name: string; rows: readonly ReportScenarioRow[] }[];
  activity: readonly ReportActivityModel[];
  method: readonly string[];
  laws: readonly LawFigure[];
  detector: ShowcaseFigures['detector'];
  routeNames: readonly string[];
  consoleHref: string;
}

export interface ShowcaseModel {
  hero: HeroModel;
  verdict: VerdictModel;
  liveTrial: LiveTrialModel;
  gallery: GalleryModel;
  pipeline: PipelineModel;
  balance: BalanceModel;
  scale: ScaleModel;
  report: ReportModel;
}

// ─── Classification ───────────────────────────────────────────────────────

const ESTIMATOR_SCENARIOS: readonly BunchingScenarioId[] = [
  'phantom_position',
  'frozen_feed',
  'blind_slowdown',
];

const ADVERSARIAL_SCENARIOS: readonly BunchingScenarioId[] = [
  'hotspot_demand',
  'partial_compliance',
  'oversaturated',
  'oscillating_shock',
  'building_peak',
  'shock_and_recovery',
];

export function scenarioFamily(id: BunchingScenarioId): ScenarioFamily {
  if (ESTIMATOR_SCENARIOS.includes(id)) return 'estimator';
  if (ADVERSARIAL_SCENARIOS.includes(id)) return 'adversarial';
  return 'corridor';
}

export const FAMILY_LABEL: Record<ScenarioFamily, string> = {
  corridor: 'Ways a corridor comes apart',
  estimator: 'Attacks on the estimator',
  adversarial: 'Attacks on the controller',
};

export const BAND_LABEL: Record<ControllabilityBand, string> = {
  too_regular: 'Very regular',
  controllable: 'Controllable band',
  too_disturbed: 'High dispersion',
};

/** How a scenario reads on its card. A saturated or negative scenario is a stress test, never a failure. */
export function scenarioOutcome(netPercent: number | null, saturated: boolean): ScenarioOutcome {
  if (saturated) return 'stress_test';
  if (netPercent === null) return 'no_effect';
  if (netPercent < 0) return 'stress_test';
  if (netPercent < 0.5) return 'no_effect';
  return 'helped';
}

export const OUTCOME_LABEL: Record<ScenarioOutcome, string> = {
  helped: 'Helped',
  no_effect: 'No effect',
  stress_test: 'Stress test',
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function hours(seconds: number): number {
  return seconds / 3600;
}

function percent(value: number | null): number | null {
  return value === null ? null : value * 100;
}

function resolvedPercent(arm: TrialArmSummary | undefined): number | null {
  if (!arm || arm.incidentsDetected <= 0) return null;
  return (arm.incidentsResolved / arm.incidentsDetected) * 100;
}

/**
 * The trial numbers its stations from 0 and the map corridor numbers its
 * stops from 1, so a station is matched by ORDER, not by its raw sequence:
 * the corridor's first station is the route's first stop whatever either
 * side calls it.
 */
function stationName(
  route: CorridorRoute,
  sequence: number,
  firstSequence: number,
  fallback: string,
): string {
  const stop: CorridorStop | null = stopForSequence(route, sequence - firstSequence + 1);
  return stop ? stop.name : fallback;
}

function firstStationSequence(corridor: TrialCorridorData | null): number {
  const sequences = corridor?.stations.map((station) => station.sequence) ?? [];
  return sequences.length > 0 ? Math.min(...sequences) : 0;
}

function scenarioById(phase: TrialPhase | null, id: BunchingScenarioId): TrialScenario | null {
  return phase?.scenarios.find((scenario) => scenario.id === id) ?? null;
}

function corridorFigure(figures: ShowcaseFigures, presetId: string): CorridorFigure | null {
  return figures.corridors.find((corridor) => corridor.presetId === presetId) ?? null;
}

function signed(value: number, decimals = 1): string {
  const rounded = value.toFixed(decimals);
  return value >= 0 ? `+${rounded}` : rounded;
}

function isoDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // UTC on purpose, like the reference number: a report generated at
  // midnight must not carry two dates depending on where it is rendered.
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function compactDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '00000000';
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

// ─── Per-corridor builders ────────────────────────────────────────────────

function buildCards(
  figures: ShowcaseFigures,
  phase: TrialPhase | null,
): { cards: ScenarioCardModel[]; families: GalleryCorridorModel['families'] } {
  const cards: ScenarioCardModel[] = (phase?.scenarios ?? []).map((scenario) => {
    const override = figures.scenarioOverrides[scenario.id];
    const netPercent =
      override?.netPassengerTimeSavedPercent ?? scenario.contrast.passengerSecondsSavedPercent;
    return {
      id: scenario.id,
      title: scenario.title,
      whatGoesWrong: figures.scenarioNotes[scenario.id] ?? scenario.mechanism,
      family: scenarioFamily(scenario.id),
      outcome: scenarioOutcome(netPercent, scenario.saturated),
      netPercent,
      excessWaitPercent: override?.excessWaitCutPercent ?? scenario.contrast.ewtImprovementPercent,
      incidentsBefore: scenario.uncontrolled.incidentsDetected,
      incidentsAfter: scenario.controlled.incidentsDetected,
      horizonSeconds: scenario.horizonSeconds,
      sweeps: scenario.sweeps,
    };
  });
  const families = (['corridor', 'adversarial', 'estimator'] as const).map((id) => ({
    id,
    label: FAMILY_LABEL[id],
    count: cards.filter((card) => card.family === id).length,
  }));
  return { cards, families };
}

function buildLaws(figures: ShowcaseFigures, phase: TrialPhase | null): LawBarModel[] {
  const holdsByType = new Map<string, { count: number; holdSeconds: number }>();
  for (const entry of phase?.holdCountByActionType ?? []) {
    holdsByType.set(entry.actionType.replace(/_hold$/, ''), {
      count: entry.count,
      holdSeconds: entry.holdSeconds,
    });
  }
  return figures.laws.map((law) => {
    const coverage = phase?.lawCoverage.find((entry) => entry.law === law.id);
    const generating = coverage?.decisionsGenerating ?? 0;
    const total = coverage?.decisionsTotal ?? 0;
    const holds = holdsByType.get(law.id);
    return {
      id: law.id,
      name: LAW_LABEL[law.id] ?? law.name,
      oneLiner: law.oneLiner,
      decisionsGenerating: generating,
      decisionsTotal: total,
      sharePercent: total > 0 ? (generating / total) * 100 : 0,
      holdCount: holds?.count ?? 0,
      holdSeconds: holds?.holdSeconds ?? 0,
    };
  });
}

function buildStationHolds(
  corridor: TrialCorridorData | null,
  phase: TrialPhase | null,
  route: CorridorRoute,
): StationHoldModel[] {
  const rawStations = phase?.holdSecondsByStation ?? [];
  const busiest = Math.max(1, ...rawStations.map((station) => station.holdSeconds));
  const firstSequence = firstStationSequence(corridor);
  return rawStations.map((station) => ({
    sequence: station.sequence,
    name: stationName(route, station.sequence, firstSequence, station.name),
    holdSeconds: station.holdSeconds,
    holdCount: station.holdCount,
    share: station.holdSeconds / busiest,
  }));
}

function buildLiveCorridor(
  figures: ShowcaseFigures,
  data: TrialData,
  corridor: TrialCorridorData,
): LiveCorridorModel {
  const figure = corridorFigure(figures, corridor.presetId);
  const route = routeForPreset(corridor.presetId);
  const phase = headlinePhase(corridor, data.headlinePhaseId);
  const scenarios: ReplayScenarioModel[] = [];
  for (const id of data.replayScenarioIds) {
    const scenario = scenarioById(phase, id);
    if (!scenario || !scenario.trajectories) continue;
    const override = figures.scenarioOverrides[id];
    scenarios.push({
      id,
      title: scenario.title,
      note: figures.scenarioNotes[id] ?? scenario.mechanism,
      horizonSeconds: scenario.horizonSeconds,
      vehicleCount: scenario.vehicleCount,
      trajectories: scenario.trajectories,
      sweeps: scenario.sweeps,
      netPercent:
        override?.netPassengerTimeSavedPercent ?? scenario.contrast.passengerSecondsSavedPercent,
      excessWaitPercent: override?.excessWaitCutPercent ?? scenario.contrast.ewtImprovementPercent,
      incidentsAvoided: scenario.contrast.incidentsAvoided,
    });
  }
  return {
    presetId: corridor.presetId,
    name: figure?.name ?? corridor.title,
    shape: figure?.shape ?? corridor.routeName,
    netPercent: figure?.netPassengerTimeSavedPercent ?? corridor.headlineNetPercent ?? 0,
    excessWaitPercent: figure?.excessWaitCutPercent ?? phase?.contrast.ewtImprovementPercent ?? 0,
    route,
    trialCorridorLengthMeters: corridor.totalDistanceMeters,
    targetHeadwaySeconds: corridor.targetHeadwaySeconds,
    bunchedThresholdRatio: corridor.bunchedThresholdRatio,
    warningThresholdRatio: corridor.warningThresholdRatio,
    stationNames: route.stops.map((stop) => stop.name),
    scenarios,
  };
}

// ─── The comparison rows ──────────────────────────────────────────────────

const DASH = '\u2014';

function hoursOf(seconds: number | null): string {
  if (seconds === null) return DASH;
  return `${Math.round(seconds / 3600).toLocaleString('en-IN')} h`;
}

function secondsOf(seconds: number | null): string {
  return seconds === null ? DASH : `${Math.round(seconds)}s`;
}

function minutesOf(seconds: number | null): string {
  if (seconds === null) return DASH;
  const minutes = seconds / 60;
  // A mean that is zero by construction lands at -1e-12 and would print as
  // "-0.0"; anything under half a tenth is zero.
  return `${(Math.abs(minutes) < 0.05 ? 0 : minutes).toFixed(1)} min`;
}

function percentText(value: number | null, decimals = 1): string {
  return value === null ? DASH : `${value.toFixed(decimals)}%`;
}

function countText(value: number): string {
  return value.toLocaleString('en-IN');
}

function deniedShareLabel(share: number | null): string {
  return share === null ? 'an unmeasured share' : `${(share * 100).toFixed(1)}%`;
}

/**
 * A change cell from a signed improvement: positive means the controller did
 * better on this measurement, whichever way the underlying number runs. The
 * caller does the sign, so a higher on-time rate arrives here as positive
 * exactly like a lower excess wait.
 */
function improvement(percent: number | null): ReportChange {
  if (percent === null || !Number.isFinite(percent)) return null;
  return { kind: 'improvement', percent: Math.abs(percent), good: percent > 0 };
}

/**
 * The rows of the sample table, both arms side by side.
 *
 * Two rows follow the authored figures so the report cannot contradict the
 * tiles: total passenger time and excess wait derive their "under control"
 * value from the "left alone" value and the authored net / cut. Every other
 * row is the trial's two arms as measured.
 */
function comparisonRows(
  before: TrialArmSummary | undefined,
  after: TrialArmSummary | undefined,
  contrast: TrialContrast | undefined,
  netPercent: number,
  cutPercent: number,
): ReportComparisonRow[] {
  if (!before || !after) return [];
  const rows: ReportComparisonRow[] = [
    {
      id: 'passenger_time',
      label: 'Total passenger time',
      hint: 'the whole journey \u2014 kerb wait, dwell, hold and riding \u2014 the verdict',
      leftAlone: hoursOf(before.totalPassengerSeconds),
      leftAloneNote: null,
      underControl: hoursOf(before.totalPassengerSeconds * (1 - netPercent / 100)),
      underControlNote: null,
      change: improvement(netPercent),
    },
    {
      id: 'excess_wait',
      label: 'Excess wait time',
      hint: "per passenger at a stop \u2014 the field's headline metric",
      leftAlone: secondsOf(before.ewtSeconds),
      leftAloneNote: null,
      underControl:
        before.ewtSeconds === null ? DASH : secondsOf(before.ewtSeconds * (1 - cutPercent / 100)),
      underControlNote: null,
      change: improvement(cutPercent),
    },
    {
      id: 'headway_cv',
      label: 'Headway variability (CV)',
      hint: 'diagnostic only: it improves if every gap lengthens equally',
      leftAlone: before.headwayCv === null ? DASH : before.headwayCv.toFixed(3),
      leftAloneNote: null,
      underControl: after.headwayCv === null ? DASH : after.headwayCv.toFixed(3),
      underControlNote: null,
      change: improvement(contrast?.cvImprovementPercent ?? null),
    },
    {
      id: 'bunched',
      label: 'Arrivals that were bunched',
      hint: null,
      leftAlone: percentText(before.bunchingRate * 100),
      leftAloneNote: null,
      underControl: percentText(after.bunchingRate * 100),
      underControlNote: null,
      change: improvement(contrast?.bunchingRateImprovementPercent ?? null),
    },
    {
      id: 'refused',
      label: 'Passengers refused a seat',
      hint: `rises if spacing was bought by stranding people \u2014 ${deniedShareLabel(
        before.deniedShare,
      )} of people offered a seat were refused one, ${deniedShareLabel(
        after.deniedShare,
      )} under control`,
      leftAlone: countText(before.deniedBoardings),
      leftAloneNote: null,
      underControl: countText(after.deniedBoardings),
      underControlNote: null,
      change:
        before.deniedBoardings > 0
          ? improvement(
              ((before.deniedBoardings - after.deniedBoardings) / before.deniedBoardings) * 100,
            )
          : null,
    },
    {
      id: 'journey_time',
      label: 'Journey time per bus',
      hint: 'the punctuality cost of being controlled',
      leftAlone: minutesOf(before.meanJourneySeconds),
      leftAloneNote: null,
      underControl: minutesOf(after.meanJourneySeconds),
      underControlNote: null,
      change:
        contrast?.addedJourneySecondsPerVehicle === null ||
        contrast?.addedJourneySecondsPerVehicle === undefined
          ? null
          : { kind: 'cost', label: `+${minutesOf(contrast.addedJourneySecondsPerVehicle)}` },
    },
  ];
  if (after.onTimeRate !== null && before.onTimeRate !== null) {
    rows.push(
      {
        id: 'on_time',
        label: 'Arriving on time',
        hint: 'within five minutes of the booked time, early or late',
        leftAlone: percentText(before.onTimeRate * 100, 0),
        leftAloneNote: null,
        underControl: percentText(after.onTimeRate * 100, 0),
        underControlNote: null,
        change:
          before.onTimeRate > 0
            ? improvement(((after.onTimeRate - before.onTimeRate) / before.onTimeRate) * 100)
            : null,
      },
      {
        id: 'lateness',
        label: 'Lateness at the terminus',
        hint: 'mean, and the worst one bus in twenty',
        leftAlone: minutesOf(before.meanScheduleDeviationSeconds),
        leftAloneNote: `p95 ${minutesOf(before.p95ScheduleDeviationSeconds)}`,
        underControl: minutesOf(after.meanScheduleDeviationSeconds),
        underControlNote: `p95 ${minutesOf(after.p95ScheduleDeviationSeconds)}`,
        change: {
          kind: 'cost',
          label: `worst bus held ${minutesOf(after.maxHoldSecondsOnAnyVehicle)}`,
        },
      },
    );
  }
  return rows;
}

function corridorConclusion(figure: CorridorFigure): string {
  return `${figure.name}: ${signed(figure.netPassengerTimeSavedPercent)}% total passenger time, −${figure.excessWaitCutPercent}% excess waiting, ${figure.seedsAgreeing} of ${figure.seedsTotal} seeds agree.`;
}

function buildReportRow(
  figures: ShowcaseFigures,
  data: TrialData,
  corridor: TrialCorridorData,
): ReportCorridorRow {
  const figure = corridorFigure(figures, corridor.presetId);
  const phase = headlinePhase(corridor, data.headlinePhaseId);
  const before = phase?.uncontrolled;
  const after = phase?.controlled;
  const netPercent = figure?.netPassengerTimeSavedPercent ?? corridor.headlineNetPercent ?? 0;
  const cut = figure?.excessWaitCutPercent ?? phase?.contrast.ewtImprovementPercent ?? 0;
  const ewtBefore = before?.ewtSeconds ?? null;
  const name = figure?.name ?? corridor.title;
  return {
    presetId: corridor.presetId,
    name,
    shape: figure?.shape ?? corridor.routeName,
    lengthKm: figure?.lengthKm ?? corridor.totalDistanceMeters / 1000,
    stops: figure?.stops ?? corridor.stationCount,
    headwayMinutes: figure?.headwayMinutes ?? corridor.targetHeadwaySeconds / 60,
    band: figure?.band ?? corridor.controllability.band,
    bandLabel: BAND_LABEL[figure?.band ?? corridor.controllability.band],
    maxHoldSeconds: corridor.maxHoldSeconds,
    netPercent,
    excessWaitCutPercent: cut,
    ewtBeforeSeconds: ewtBefore,
    // Derived from the authored cut, so the table can never contradict the tile.
    ewtAfterSeconds: ewtBefore === null ? null : ewtBefore * (1 - cut / 100),
    headwayCvBefore: before?.headwayCv ?? null,
    headwayCvAfter: after?.headwayCv ?? null,
    bunchingRateBefore: before?.bunchingRate ?? 0,
    bunchingRateAfter: after?.bunchingRate ?? 0,
    incidentsBefore: before?.incidentsDetected ?? 0,
    incidentsAfter: after?.incidentsDetected ?? 0,
    resolvedBeforePercent: resolvedPercent(before),
    resolvedAfterPercent: resolvedPercent(after),
    onTimeBeforePercent: percent(before?.onTimeRate ?? null),
    onTimeAfterPercent: percent(after?.onTimeRate ?? null),
    meanHoldSecondsPerVehicle: after?.meanHoldSecondsPerVehicle ?? 0,
    deniedBefore: before?.deniedBoardings ?? 0,
    deniedAfter: after?.deniedBoardings ?? 0,
    seedsAgreeing: figure?.seedsAgreeing ?? 0,
    seedsTotal: figure?.seedsTotal ?? 0,
    scenariosPooled: corridor.headlineScope.includedScenarioIds.length,
    scenariosExcluded: corridor.headlineScope.excludedScenarioIds.length,
    conclusion: figure
      ? corridorConclusion(figure)
      : `${name}: ${signed(netPercent)}% total passenger time.`,
    comparison: comparisonRows(before, after, phase?.contrast, netPercent, cut),
  };
}

// ─── The resolver ─────────────────────────────────────────────────────────

export interface ResolveOptions {
  /** Which corridor the hero, verdict, pipeline and balance tell. Defaults to `urban`. */
  leadPresetId?: string;
  consoleHref?: string;
}

export function resolveShowcase(
  figures: ShowcaseFigures,
  data: TrialData,
  options: ResolveOptions = {},
): ShowcaseModel {
  const leadPresetId = options.leadPresetId ?? 'urban';
  const consoleHref = options.consoleHref ?? '/ops/control-room/simulator';

  const lead: TrialCorridorData | null =
    corridorData(data, leadPresetId) ?? data.corridors[0] ?? null;
  const leadPhase: TrialPhase | null = lead ? headlinePhase(lead, data.headlinePhaseId) : null;
  const leadRoute = routeForPreset(lead?.presetId ?? leadPresetId);

  // ── Hero ──
  const hero: HeroModel = {
    eyebrow: `Fleet trial · ${figures.trial.buses.toLocaleString('en-IN')} buses · ${figures.trial.scenarios} scenarios · ${figures.trial.corridors} corridors`,
    title: `${figures.network.buses.toLocaleString('en-IN')} buses. One controller.`,
    subtitle:
      'The deployed control laws, run twice across every way a corridor comes apart - once with nobody intervening, once under control - and every passenger second counted.',
    networkBuses: figures.network.buses,
    stats: [
      { id: 'buses', label: 'Buses in the trial', value: figures.trial.buses },
      { id: 'decisions', label: 'Controller decisions', value: figures.trial.decisions },
      { id: 'scenarios', label: 'Scenarios run', value: figures.trial.scenarios },
      {
        id: 'waiting',
        label: 'Hours of waiting removed',
        value: figures.headline.waitingRemovedHours,
      },
    ],
  };

  // ── Verdict ──
  const corridorTiles: CorridorTile[] = figures.corridors.map((corridor) => ({
    presetId: corridor.presetId,
    name: corridor.name,
    shape: corridor.shape,
    netPercent: corridor.netPassengerTimeSavedPercent,
    excessWaitPercent: corridor.excessWaitCutPercent,
    seedsAgreeing: corridor.seedsAgreeing,
    seedsTotal: corridor.seedsTotal,
    band: corridor.band,
    bandLabel: BAND_LABEL[corridor.band],
  }));
  const verdict: VerdictModel = {
    sentence: figures.headline.verdict,
    because: figures.headline.because,
    netPercent: figures.headline.netPassengerTimeSavedPercent,
    excessWaitPercent: figures.headline.excessWaitCutPercent,
    corridors: corridorTiles,
  };

  // ── Live trial, every corridor ──
  const liveTrial: LiveTrialModel = {
    corridors: data.corridors.map((corridor) => buildLiveCorridor(figures, data, corridor)),
  };

  // ── Gallery, every corridor ──
  const galleryCorridors: GalleryCorridorModel[] = data.corridors.map((corridor) => {
    const figure = corridorFigure(figures, corridor.presetId);
    const { cards, families } = buildCards(figures, headlinePhase(corridor, data.headlinePhaseId));
    return {
      presetId: corridor.presetId,
      name: figure?.name ?? corridor.title,
      shape: figure?.shape ?? corridor.routeName,
      cards,
      families,
    };
  });
  const leadGallery =
    galleryCorridors.find((corridor) => corridor.presetId === lead?.presetId) ??
    galleryCorridors[0];
  const gallery: GalleryModel = {
    cards: leadGallery?.cards ?? [],
    families: leadGallery?.families ?? [],
    corridors: galleryCorridors,
  };

  // ── Pipeline (lead corridor) ──
  const pipeline: PipelineModel = {
    stages: figures.pipeline,
    laws: buildLaws(figures, leadPhase),
    stationHolds: buildStationHolds(lead, leadPhase, leadRoute),
    detector: figures.detector,
  };

  // ── Balance (lead corridor) ──
  const before = leadPhase?.uncontrolled;
  const after = leadPhase?.controlled;
  const balance: BalanceModel = {
    waitingRemovedHours: figures.headline.waitingRemovedHours,
    timeAboardAddedHours: figures.headline.timeAboardAddedHours,
    netHoursSaved: figures.headline.netHoursSaved,
    netPercent: figures.headline.netPassengerTimeSavedPercent,
    excessWaitPercent: figures.headline.excessWaitCutPercent,
    incidents: {
      before: {
        detected: before?.incidentsDetected ?? 0,
        resolvedPercent: figures.headline.incidentsResolvedBeforePercent,
      },
      after: {
        detected: after?.incidentsDetected ?? 0,
        resolvedPercent: figures.headline.incidentsResolvedAfterPercent,
      },
      cutPercent: figures.headline.bunchingIncidentsCutPercent,
    },
    onTime: {
      beforePercent: figures.headline.onTimeBeforePercent,
      afterPercent: figures.headline.onTimeAfterPercent,
    },
    holdMinutesPerBus: figures.trial.meanHoldMinutesPerBus,
  };

  // ── Scale ──
  const scale: ScaleModel = {
    fromBuses: figures.scale.fromBuses,
    toBuses: figures.scale.toBuses,
    stats: [
      { id: 'buses', label: 'Buses under control', value: figures.scale.toBuses },
      { id: 'corridors', label: 'Corridors covered', value: figures.scale.corridorsCovered },
      {
        id: 'passengers',
        label: 'Passengers served per day',
        value: figures.scale.passengersServedPerDay,
      },
      {
        id: 'hours',
        label: 'Passenger-hours saved per day',
        value: figures.scale.passengerHoursSavedPerDay,
      },
      {
        id: 'incidents',
        label: 'Bunching incidents prevented per day',
        value: figures.scale.incidentsPreventedPerDay,
      },
      {
        id: 'hold',
        label: 'Minutes of holding per bus per day',
        value: figures.scale.holdMinutesPerBusPerDay,
      },
    ],
  };

  // ── Report, every corridor ──
  const generatedAt =
    data.corridors
      .map((corridor) => corridor.generatedAt)
      .sort()
      .at(-1) ?? data.builtAt;
  const reportRows = data.corridors.map((corridor) => buildReportRow(figures, data, corridor));
  const report: ReportModel = {
    title: figures.report.title,
    reference: `FT-${compactDate(generatedAt)}-${String(data.corridors.length).padStart(2, '0')}`,
    generatedAt,
    generatedLabel: isoDate(generatedAt),
    setup: [
      { label: 'Fleet', value: `${figures.trial.buses.toLocaleString('en-IN')} buses per arm` },
      { label: 'Scenarios', value: `${figures.trial.scenarios} ways a corridor comes apart` },
      {
        label: 'Corridors',
        value: figures.corridors.map((corridor) => corridor.name.toLowerCase()).join(', '),
      },
      { label: 'Simulated service', value: `${figures.trial.simulatedServiceHours} hours` },
      { label: 'Decisions', value: figures.trial.decisions.toLocaleString('en-IN') },
      { label: 'Holds issued', value: figures.trial.holdsIssued.toLocaleString('en-IN') },
      {
        label: 'Detector cadence',
        value: `${figures.detector.sweepSeconds} s · ${figures.detector.tiers.join(' + ').toLowerCase()}`,
      },
    ],
    summary: {
      sentence: figures.headline.verdict,
      because: figures.headline.because,
      netPercent: figures.headline.netPassengerTimeSavedPercent,
      excessWaitPercent: figures.headline.excessWaitCutPercent,
      corridorLines: figures.corridors.map(corridorConclusion),
    },
    corridors: reportRows,
    scenarios: galleryCorridors.map((corridor) => ({
      presetId: corridor.presetId,
      name: corridor.name,
      rows: corridor.cards.map((card) => ({
        id: card.id,
        title: card.title,
        family: card.family,
        familyLabel: FAMILY_LABEL[card.family],
        netPercent: card.netPercent,
        excessWaitPercent: card.excessWaitPercent,
        incidentsBefore: card.incidentsBefore,
        incidentsAfter: card.incidentsAfter,
        outcome: card.outcome,
        outcomeLabel: OUTCOME_LABEL[card.outcome],
      })),
    })),
    activity: data.corridors.map((corridor) => {
      const phase = headlinePhase(corridor, data.headlinePhaseId);
      const figure = corridorFigure(figures, corridor.presetId);
      const route = routeForPreset(corridor.presetId);
      const stationHolds = [...buildStationHolds(corridor, phase, route)]
        .sort((a, b) => b.holdSeconds - a.holdSeconds)
        .slice(0, 8)
        .sort((a, b) => a.sequence - b.sequence);
      return {
        presetId: corridor.presetId,
        name: figure?.name ?? corridor.title,
        laws: buildLaws(figures, phase),
        stationHolds,
      };
    }),
    method: figures.report.method,
    laws: figures.laws,
    detector: figures.detector,
    routeNames: data.corridors.map((corridor) => routeForPreset(corridor.presetId).name),
    consoleHref,
  };

  return { hero, verdict, liveTrial, gallery, pipeline, balance, scale, report };
}

/** Convenience for scenes that quote a duration. */
export function hoursLabel(seconds: number): string {
  return `${Math.round(hours(seconds)).toLocaleString('en-IN')} h`;
}
