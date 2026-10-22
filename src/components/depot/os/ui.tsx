'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { DATA_STATUS_LABEL, DATA_STATUS_TITLE, type DataStatus } from '@/lib/depot/os/dataStatus';
import { DEPOT_TONE_COLOUR, type DepotTone } from '@/lib/depot/palette';
import type { Severity } from '@/lib/depot/os/intel/types';

/** The OS's shared instruments. Thin borders, sans for words, mono for figures. */

const STATUS_CLASS: Readonly<Record<DataStatus, string>> = {
  live: 'border-alert-green/40 bg-alert-green/[0.08] text-alert-green',
  derived: 'border-holo-glow/35 bg-holo-glow/[0.07] text-holo-glow',
  forecast: 'border-holo-teal/40 bg-holo-teal/[0.08] text-holo-teal',
  estimate: 'border-slate-400/40 bg-slate-400/[0.08] text-slate-300',
  scenario: 'border-slate-400/40 bg-slate-400/[0.08] text-slate-300',
  proposed: 'border-alert-amber/45 bg-alert-amber/[0.08] text-alert-amber',
};

/** A small tag saying what kind of figure sits beside it; the tooltip says more. */
export function StatusTag({ status }: { readonly status: DataStatus }) {
  return (
    <span className={`os-chip ${STATUS_CLASS[status]}`} title={DATA_STATUS_TITLE[status]}>
      {DATA_STATUS_LABEL[status]}
    </span>
  );
}

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const SEVERITY_TONE: Readonly<Record<Severity, DepotTone>> = {
  critical: 'crimson',
  high: 'amber',
  medium: 'cyan',
  low: 'slate',
};

const SEVERITY_CLASS: Readonly<Record<Severity, string>> = {
  critical: 'border-alert-crimson/50 bg-alert-crimson/10 text-alert-crimson',
  high: 'border-alert-amber/50 bg-alert-amber/10 text-alert-amber',
  medium: 'border-holo-glow/40 bg-holo-glow/[0.08] text-holo-glow',
  low: 'border-slate-400/40 bg-slate-400/[0.08] text-slate-300',
};

const SEVERITY_DOT: Readonly<Record<Severity, string>> = {
  critical: 'bg-alert-crimson',
  high: 'bg-alert-amber',
  medium: 'bg-holo-glow',
  low: 'bg-slate-400',
};

export function SeverityChip({ severity }: { readonly severity: Severity }) {
  return <span className={`os-chip ${SEVERITY_CLASS[severity]}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function SeverityDot({ severity, pulse = false }: { readonly severity: Severity; readonly pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[severity]} ${pulse ? 'os-pulse' : ''}`}
    />
  );
}

interface PanelProps {
  readonly title?: ReactNode;
  readonly kicker?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly strong?: boolean;
  readonly id?: string;
  readonly testId?: string;
}

/** A boxed instrument with an optional head (kicker over title, actions on the right). */
export function Panel({
  title,
  kicker,
  actions,
  children,
  className = '',
  bodyClassName = '',
  strong = false,
  id,
  testId,
}: PanelProps) {
  const head = title !== undefined || kicker !== undefined || actions !== undefined;
  return (
    <section
      id={id}
      data-testid={testId}
      className={`os-panel ${strong ? 'os-panel-strong' : ''} flex flex-col ${className}`}
    >
      {head ? (
        <header className="os-panel-head">
          <div className="min-w-0">
            {kicker ? <div className="os-kicker truncate">{kicker}</div> : null}
            {title ? <h2 className="os-heading truncate">{title}</h2> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

const TONE_TEXT: Readonly<Record<DepotTone, string>> = {
  cyan: 'text-holo-glow',
  green: 'text-alert-green',
  amber: 'text-alert-amber',
  slate: 'text-slate-300',
  crimson: 'text-alert-crimson',
  teal: 'text-holo-teal',
};

export function toneText(tone: DepotTone): string {
  return TONE_TEXT[tone];
}

interface MetricProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly sub?: ReactNode;
  readonly tone?: DepotTone | null;
  readonly status?: DataStatus;
  readonly href?: string;
  readonly onClick?: () => void;
  readonly active?: boolean;
  readonly testId?: string;
}

/** One cell of a telemetry strip: label, a strong figure, one line under it. */
export function Metric({ label, value, sub, tone = null, status, href, onClick, active, testId }: MetricProps) {
  const body = (
    <>
      <div className="os-kicker truncate" title={label}>
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className={`os-value whitespace-nowrap ${tone ? TONE_TEXT[tone] : ''}`}>{value}</span>
        {status ? <StatusTag status={status} /> : null}
      </div>
      {sub ? <div className="os-sub mt-0.5 truncate">{sub}</div> : null}
    </>
  );
  const base = `block min-w-0 px-4 py-3 text-left transition-colors ${
    active ? 'bg-depot-selected' : ''
  }`;
  if (href) {
    return (
      <Link href={href} data-testid={testId} className={`${base} hover:bg-depot-raised`}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" data-testid={testId} onClick={onClick} className={`${base} hover:bg-depot-raised`}>
        {body}
      </button>
    );
  }
  return (
    <div data-testid={testId} className={base}>
      {body}
    </div>
  );
}

/** A strip of metrics in one panel, divided by hairlines. */
export function MetricStrip({
  children,
  columns,
  className = '',
}: {
  readonly children: ReactNode;
  readonly columns: number;
  readonly className?: string;
}) {
  const cols: Readonly<Record<number, string>> = {
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    5: 'sm:grid-cols-3 lg:grid-cols-5',
    6: 'sm:grid-cols-3 xl:grid-cols-6',
    8: 'sm:grid-cols-4 2xl:grid-cols-8',
  };
  return (
    <div
      className={`os-panel grid grid-cols-2 overflow-hidden [&>*]:border-b [&>*]:border-r [&>*]:border-holo-glow/[0.08] ${
        cols[columns] ?? 'sm:grid-cols-4'
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** A horizontal share bar; the value is clamped to the bar. */
export function MeterBar({
  value,
  max,
  tone = 'cyan',
  marker,
}: {
  readonly value: number;
  readonly max: number;
  readonly tone?: DepotTone;
  readonly marker?: number;
}) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const mark = marker !== undefined && max > 0 ? Math.max(0, Math.min(1, marker / max)) : null;
  return (
    <div className="os-bar-track" aria-hidden>
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${share * 100}%`, backgroundColor: DEPOT_TONE_COLOUR[tone] }}
      />
      {mark !== null ? (
        <div className="absolute inset-y-[-2px] w-px bg-depot-ink" style={{ left: `${mark * 100}%` }} />
      ) : null}
    </div>
  );
}

/** A small line of values; flat when there is no spread. */
export function Sparkline({
  values,
  tone = 'cyan',
  width = 96,
  height = 24,
  dashedFrom,
}: {
  readonly values: readonly number[];
  readonly tone?: DepotTone;
  readonly width?: number;
  readonly height?: number;
  /** Index from which the line is a projection (drawn dashed). */
  readonly dashedFrom?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number): number => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number): number => height - 2 - ((v - min) / span) * (height - 4);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const colour = DEPOT_TONE_COLOUR[tone];
  const split = dashedFrom !== undefined && dashedFrom > 0 && dashedFrom < values.length;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <polyline
        points={(split ? points.slice(0, dashedFrom + 1) : points).join(' ')}
        fill="none"
        stroke={colour}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {split ? (
        <polyline
          points={points.slice(dashedFrom).join(' ')}
          fill="none"
          stroke={colour}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          strokeOpacity={0.8}
        />
      ) : null}
    </svg>
  );
}

/** A label and its value on one line, for evidence lists and profiles. */
export function Fact({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: DepotTone;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-holo-glow/[0.07] py-1.5 last:border-b-0">
      <dt className="font-sans text-[12px] text-depot-prose">{label}</dt>
      <dd className={`text-right font-mono text-[12.5px] tabular-nums ${tone ? TONE_TEXT[tone] : 'text-depot-ink'}`}>
        {value}
      </dd>
    </div>
  );
}

/** A quiet sentence in a box, for an empty or not-yet-connected state. */
export function EmptyNote({ children, icon = true }: { readonly children: ReactNode; readonly icon?: boolean }) {
  return (
    <div className="flex items-start gap-2 px-4 py-6 text-depot-prose">
      {icon ? <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-depot-muted" aria-hidden /> : null}
      <p className="depot-note">{children}</p>
    </div>
  );
}

/** A skeleton block while a panel waits for its first answer. */
export function PanelLoading({ rows = 4, label }: { readonly rows?: number; readonly label: string }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="depot-skeleton h-6" />
      ))}
    </div>
  );
}

export interface TabItem<K extends string> {
  readonly key: K;
  readonly label: string;
  readonly count?: number;
}

/** In-panel tabs (not routes): a tablist with arrow-key movement. */
export function LocalTabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  readonly items: readonly TabItem<K>[];
  readonly value: K;
  readonly onChange: (key: K) => void;
  readonly label: string;
}) {
  const onKeyDown = (event: React.KeyboardEvent, index: number): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = items[(index + (event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
    if (next) onChange(next.key);
  };
  return (
    <div role="tablist" aria-label={label} className="flex min-w-0 items-center overflow-x-auto border-b border-holo-glow/10">
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          tabIndex={item.key === value ? 0 : -1}
          onKeyDown={(event) => onKeyDown(event, index)}
          onClick={() => onChange(item.key)}
          className={`os-tab ${item.key === value ? 'os-tab-active' : ''}`}
        >
          {item.label}
          {item.count !== undefined ? (
            <span className="font-mono text-[10.5px] text-depot-muted">{item.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
