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