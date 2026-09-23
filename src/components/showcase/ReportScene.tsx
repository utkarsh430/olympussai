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

// ─── Building blocks ─────────────────────────────────────────────────────

/**
 * A numbered section whose heading is the disclosure: a native `<details>`,
 * so the sheet needs no state to fold and find-in-page opens a closed one.
 * Only the first section opens by default.
 */
function Section({
  index,
  title,
  teaser,
  open = false,
  children,
}: {
  index: number;
  title: string;
  teaser: string;
  open?: boolean;
  children: ReactNode;
}) {
  const id = `report-section-${index}`;
  return (
    <details className="sc-details" open={open} aria-labelledby={id}>
      <summary>
        <h3 id={id} className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="sc-label">{String(index).padStart(2, '0')}</span>
          <span className="sc-display text-2xl">{title}</span>
          <span className="text-sm text-muted-foreground">{teaser}</span>
        </h3>
      </summary>
      <div className="flex flex-col gap-6 pb-8">{children}</div>
    </details>
  );
}

/** One corridor's block inside a section: its name and shape on the disclosure, the lead corridor open. */
function CorridorDetails({
  name,
  shape,
  open,
  children,
}: {
  name: string;
  shape: string | null;
  open: boolean;
  children: ReactNode;
}) {
  return (
    <details className="sc-details sc-details-nested" open={open}>
      <summary>
        <span className="sc-label">{name}</span>
        {shape ? <span className="text-xs text-muted-foreground">{shape}</span> : null}
      </summary>
      <div className="flex flex-col gap-4 pb-6">{children}</div>
    </details>
  );
}

function NumCell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('num', className)}>{children}</td>;
}

function SetupRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-border py-2">
      <dt className="sc-label pt-0.5">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}