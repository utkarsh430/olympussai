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