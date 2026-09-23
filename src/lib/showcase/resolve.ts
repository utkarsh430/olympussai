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