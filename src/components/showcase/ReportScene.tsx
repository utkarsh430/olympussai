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

// ─── Sections ────────────────────────────────────────────────────────────

function ReportHeader({ model, onExport }: { model: ReportModel; onExport: () => void }) {
  const headerSetup = HEADER_SETUP_LABELS.flatMap((label) => {
    const row = model.setup.find((entry) => entry.label === label);
    return row ? [row] : [];
  });

  return (
    <header className="flex flex-col gap-6 pb-10 md:flex-row md:items-start md:justify-between">
      <div className="flex flex-col gap-4">
        <p className="sc-eyebrow">{model.title}</p>
        <h2 className="sc-display sc-h2 text-foreground">
          {'Reference '}
          <span className="tabular-nums">{model.reference}</span>
        </h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <dt className="sc-label">Generated</dt>
            <dd className="text-sm text-foreground">{model.generatedLabel}</dd>
          </div>
          {headerSetup.map((row) => (
            <div key={row.label} className="flex items-baseline gap-2">
              <dt className="sc-label">{row.label}</dt>
              <dd className="text-sm text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <button type="button" className="sc-button-primary sc-print-hide shrink-0" onClick={onExport}>
        <Printer className="h-4 w-4" aria-hidden />
        Export as PDF
      </button>
    </header>
  );
}

function Summary({ model }: { model: ReportModel['summary'] }) {
  return (
    <Section
      index={1}
      title="Summary"
      teaser="Verdict, headline figures, one line per corridor"
      open
    >
      <p className="sc-display text-3xl text-foreground">{model.sentence}</p>
      <p className="ol-body">{model.because}</p>
      <div className="grid gap-8 sm:grid-cols-2">
        <StatTile
          size="lg"
          tone="glow"
          stat={{
            id: 'report-net',
            label: 'Total passenger time saved',
            value: Math.abs(model.netPercent),
            decimals: 1,
            prefix: model.netPercent < 0 ? MINUS : '+',
            suffix: '%',
          }}
        />
        <StatTile
          size="lg"
          tone="foreground"
          stat={{
            id: 'report-ewt',
            label: 'Excess waiting removed',
            value: model.excessWaitPercent,
            prefix: MINUS,
            suffix: '%',
          }}
        />
      </div>
      <ul className="flex flex-col gap-2">
        {model.corridorLines.map((line) => (
          <li key={line} className="text-sm text-foreground">
            {line}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function TrialSetup({
  setup,
  corridors,
}: {
  setup: ReportModel['setup'];
  corridors: readonly ReportCorridorRow[];
}) {
  return (
    <Section index={2} title="Trial setup" teaser="Fleet, scenarios, corridors, detector">
      <dl className="grid gap-x-10 sm:grid-cols-2">
        {setup.map((row) => (
          <SetupRow key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
      <div className="overflow-x-auto">
        <table className="sc-table">
          <thead>
            <tr>
              <th scope="col">Corridor</th>
              <th scope="col">Shape</th>
              <th scope="col" className="num">
                Length (km)
              </th>
              <th scope="col" className="num">
                Stops
              </th>
              <th scope="col" className="num">
                Headway (min)
              </th>
              <th scope="col">Band</th>
              <th scope="col" className="num">
                Hold cap (s)
              </th>
            </tr>
          </thead>
          <tbody>
            {corridors.map((row) => (
              <tr key={row.presetId}>
                <td className="font-medium text-foreground">{row.name}</td>
                <td className="text-muted-foreground">{row.shape}</td>
                <NumCell>{count(row.lengthKm)}</NumCell>
                <NumCell>{count(row.stops)}</NumCell>
                <NumCell>{count(row.headwayMinutes)}</NumCell>
                <td>{row.bandLabel}</td>
                <NumCell>{count(row.maxHoldSeconds)}</NumCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** A figure with its optional note beneath: the mean with its p95, say. */
function ValueCell({ value, note }: { value: string; note: string | null }) {
  return (
    <NumCell>
      {value}
      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </NumCell>
  );
}

/**
 * The change cell's three shapes: an improvement with its direction, a cost
 * stated in words, or nothing measurable. The arrow carries a label so the
 * direction does not rest on the colour alone.
 */
function ChangeCell({ change }: { change: ReportChange }) {
  if (change === null) {
    return (
      <NumCell>
        <span className="text-muted-foreground">{DASH}</span>
      </NumCell>
    );
  }
  if (change.kind === 'cost') {
    return (
      <NumCell>
        <span className="text-muted-foreground">{change.label}</span>
      </NumCell>
    );
  }
  return (
    <NumCell>
      <span className={change.good ? 'text-success' : 'text-destructive'}>
        <span aria-label={change.good ? 'better' : 'worse'}>{change.good ? '▲' : '▼'}</span>
        {` ${change.percent.toFixed(1)}%`}
      </span>
    </NumCell>
  );
}

/** One measurement, both arms, the change. The strings arrive formatted; nothing is recomputed here. */
function ComparisonRow({ entry }: { entry: ReportComparisonRow }) {
  return (
    <tr>
      <td>
        <div className="font-medium text-foreground">{entry.label}</div>
        {entry.hint ? <div className="text-xs text-muted-foreground">{entry.hint}</div> : null}
      </td>
      <ValueCell value={entry.leftAlone} note={entry.leftAloneNote} />
      <ValueCell value={entry.underControl} note={entry.underControlNote} />
      <ChangeCell change={entry.change} />
    </tr>
  );
}

/** One corridor, left alone against under control: the ops console's own comparison table, on the sheet. */
function ComparisonTable({ row }: { row: ReportCorridorRow }) {
  return (
    <div className="overflow-x-auto">
      <table className="sc-table">
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col" className="num">
              Left alone
            </th>
            <th scope="col" className="num">
              Under control
            </th>
            <th scope="col" className="num">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {row.comparison.map((entry) => (
            <ComparisonRow key={entry.id} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsByCorridor({ corridors }: { corridors: readonly ReportCorridorRow[] }) {
  return (
    <Section
      index={3}
      title="Results by corridor"
      teaser="Eight measurements, both arms, per corridor"
    >
      <div className="flex flex-col">
        {corridors.map((row, position) => (
          <CorridorDetails
            key={row.presetId}
            name={row.name}
            shape={row.shape}
            open={position === 0}
          >
            <ComparisonTable row={row} />
          </CorridorDetails>
        ))}
      </div>
      <ul className="flex flex-col gap-1">
        {corridors.map((row) => (
          <li key={row.presetId} className="text-sm text-muted-foreground">
            {row.conclusion}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ScenarioTable({ rows }: { rows: readonly ReportScenarioRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="sc-table">
        <thead>
          <tr>
            <th scope="col">Scenario</th>
            <th scope="col">Family</th>
            <th scope="col" className="num">
              Net
            </th>
            <th scope="col" className="num">
              Excess wait cut
            </th>
            <th scope="col" className="num">
              Incidents
            </th>
            <th scope="col">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="font-medium text-foreground">{row.title}</td>
              <td className="text-muted-foreground">{row.familyLabel}</td>
              <NumCell>{signedPercent(row.netPercent)}</NumCell>
              <NumCell>{cutPercent(row.excessWaitPercent)}</NumCell>
              <NumCell>
                {beforeAfter(count(row.incidentsBefore), count(row.incidentsAfter))}
              </NumCell>
              <td>
                <span className={OUTCOME_CHIP[row.outcome]}>{row.outcomeLabel}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsByScenario({
  scenarios,
  corridors,
}: {
  scenarios: ReportModel['scenarios'];
  corridors: readonly ReportCorridorRow[];
}) {
  return (
    <Section index={4} title="Results by scenario" teaser={scenarioTeaser(scenarios)}>
      <div className="flex flex-col">
        {scenarios.map((corridor, position) => (
          <CorridorDetails
            key={corridor.presetId}
            name={corridor.name}
            shape={shapeOf(corridors, corridor.presetId)}
            open={position === 0}
          >
            <ScenarioTable rows={corridor.rows} />
          </CorridorDetails>
        ))}
      </div>
    </Section>
  );
}

function ActivityBlock({ activity }: { activity: ReportActivityModel }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="overflow-x-auto">
        <table className="sc-table">
          <thead>
            <tr>
              <th scope="col">Law</th>
              <th scope="col" className="num">
                Decisions
              </th>
              <th scope="col" className="num">
                Share
              </th>
              <th scope="col" className="num">
                Holds
              </th>
              <th scope="col" className="num">
                Hold time
              </th>
            </tr>
          </thead>
          <tbody>
            {activity.laws.map((law) => (
              <tr key={law.id}>
                <td className="font-medium text-foreground">{law.name}</td>
                <NumCell>{`${count(law.decisionsGenerating)} of ${count(law.decisionsTotal)}`}</NumCell>
                <NumCell>{sharePercent(law.sharePercent)}</NumCell>
                <NumCell>{count(law.holdCount)}</NumCell>
                <NumCell>{minutesOf(law.holdSeconds)}</NumCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3">
        <p className="sc-label">Busiest stations</p>
        {activity.stationHolds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No holds were issued.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {activity.stationHolds.map((station) => (
              <li
                key={station.sequence}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-1"
              >
                <span className="truncate text-sm text-foreground">{station.name}</span>
                <span className="font-mono text-xs tabular-nums text-foreground">
                  {minutesOf(station.holdSeconds)}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {`${count(station.holdCount)} holds`}
                </span>
                <div className="col-span-3 h-1.5 overflow-hidden rounded-full bg-primary/10">
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: 'var(--sim-hold)',
                      opacity: 0.8,
                      width: `${Math.max(0, Math.min(100, station.share * 100))}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}