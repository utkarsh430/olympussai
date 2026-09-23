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