'use client';

import { Printer } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type {
  ReportActivityModel,
  ReportChange,
  ReportComparisonRow,
  ReportCorridorRow,
  ReportModel,
  ReportScenarioRow,
  ScenarioOutcome,
} from '@/lib/showcase/resolve';
import { cn } from '@/lib/utils';
import { StatTile } from './StatTile';

const MINUS = '−';
const ARROW = '→';
const DASH = '—';

/** The header line quotes these four from the setup list, by label. */
const HEADER_SETUP_LABELS: readonly string[] = [
  'Fleet',
  'Scenarios',
  'Corridors',
  'Simulated service',
];

/**
 * How long the Export button waits for `afterprint` before closing the
 * sections it opened itself. Every current browser fires the event, and
 * most fire it before `window.print()` even returns, so this only ever
 * runs where the event never arrives.
 */
const RESTORE_FALLBACK_MS = 2_000;

const OUTCOME_CHIP: Record<ScenarioOutcome, string> = {
  helped: 'sc-chip sc-chip-good',
  no_effect: 'sc-chip',
  stress_test: 'sc-chip sc-chip-warn',
};

// ─── Formatting ──────────────────────────────────────────────────────────

function count(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}

/** Net passenger time: a gain reads "+3.8%", a loss "−1.2%". */
function signedPercent(value: number | null, decimals = 1): string {
  if (value === null) return DASH;
  const magnitude = Math.abs(value).toFixed(decimals);
  return value < 0 ? `${MINUS}${magnitude}%` : `+${magnitude}%`;
}

/** Excess wait is a cut, so an improvement reads "−54%" and a worsening "+12%". */
function cutPercent(value: number | null): string {
  if (value === null) return DASH;
  const magnitude = Math.abs(Math.round(value));
  return value < 0 ? `+${magnitude}%` : `${MINUS}${magnitude}%`;
}

function beforeAfter(before: string, after: string): string {
  return `${before} ${ARROW} ${after}`;
}

function minutesOf(seconds: number): string {
  return `${(seconds / 60).toFixed(1)} min`;
}

function sharePercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** The scenario section's teaser counts what the model holds rather than quoting a library size. */
function scenarioTeaser(scenarios: ReportModel['scenarios']): string {
  const counts = scenarios.map((corridor) => corridor.rows.length);
  const first = counts[0];
  if (first !== undefined && counts.every((n) => n === first)) {
    return `${count(first)} scenarios per corridor`;
  }
  const total = counts.reduce((sum, n) => sum + n, 0);
  return `${count(total)} scenarios across ${count(counts.length)} corridors`;
}

/** The shape a corridor was described with in the setup table, for the sections that only carry its name. */
function shapeOf(corridors: readonly ReportCorridorRow[], presetId: string): string | null {
  return corridors.find((row) => row.presetId === presetId)?.shape ?? null;
}