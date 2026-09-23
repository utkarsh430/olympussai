'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  OUTCOME_LABEL,
  type GalleryCorridorModel,
  type GalleryModel,
  type ScenarioCardModel,
  type ScenarioFamily,
  type ScenarioOutcome,
} from '@/lib/showcase/resolve';
import { cn } from '@/lib/utils';
import { SceneHeader } from './SceneHeader';
import { Sparkline } from './Sparkline';

type Filter = 'all' | ScenarioFamily;

const MINUS = '−';

const OUTCOME_CHIP: Record<ScenarioOutcome, string> = {
  helped: 'sc-chip sc-chip-good',
  no_effect: 'sc-chip',
  stress_test: 'sc-chip sc-chip-warn',
};

/** Net passenger time: a gain reads "+3.8%", a loss "−1.2%". */
function signedPercent(value: number, decimals: number): string {
  const magnitude = Math.abs(value).toFixed(decimals);
  return value < 0 ? `${MINUS}${magnitude}%` : `+${magnitude}%`;
}

/** Excess wait is a cut, so an improvement reads "−54%" and a worsening "+12%". */
function cutPercent(value: number): string {
  const magnitude = Math.abs(Math.round(value));
  return value < 0 ? `+${magnitude}%` : `${MINUS}${magnitude}%`;
}

/**
 * The corridors the toggle offers. A model with no per-corridor split still
 * renders: its lead cards become the one, unnamed corridor.
 */
function corridorsOf(model: GalleryModel): readonly GalleryCorridorModel[] {
  if (model.corridors.length > 0) return model.corridors;
  return [{ presetId: 'lead', name: '', shape: '', cards: model.cards, families: model.families }];
}