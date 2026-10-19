'use client';

import { useId, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, X } from 'lucide-react';
import { signFor } from '@/lib/depot/format';

/*
 * The scheduler pages' instruments: labelled ranges, toggles and choices for the
 * parameters, a registration picker, a route checklist, and the before/after table.
 */

export function FieldGroup({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 border-b border-holo-glow/[0.08] px-4 py-3 last:border-b-0">
      <legend className="os-kicker float-left mb-1 w-full">{title}</legend>
      <div className="clear-both space-y-3">{children}</div>
    </fieldset>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (v: number) => string;
  readonly onChange: (v: number) => void;
  readonly hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-sans text-[12px] font-medium text-depot-ink">
          {label}
        </label>
        <span className="font-mono text-[12px] text-holo-glow">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="os-range"
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
      {hint ? <p className="mt-0.5 font-sans text-[11px] leading-4 text-depot-muted">{hint}</p> : null}
    </div>
  );
}

export function ToggleField({ label, checked, onChange, hint }: { readonly label: string; readonly checked: boolean; readonly onChange: (v: boolean) => void; readonly hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block font-sans text-[12px] font-medium text-depot-ink">{label}</span>
        {hint ? <span className="block font-sans text-[11px] leading-4 text-depot-muted">{hint}</span> : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="os-switch" aria-hidden />
      </span>
    </label>
  );
}

export function SelectField<K extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: K;
  readonly options: readonly { readonly key: K; readonly label: string }[];
  readonly onChange: (v: K) => void;
  readonly hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-sans text-[12px] font-medium text-depot-ink">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as K)} className="depot-control depot-select w-full font-sans">
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-0.5 font-sans text-[11px] leading-4 text-depot-muted">{hint}</p> : null}
    </div>
  );
}

/** Picks registrations from the depot's roster, shown as removable chips. */
export function BusPicker({ label, options, value, onChange, hint }: { readonly label: string; readonly options: readonly string[]; readonly value: readonly string[]; readonly onChange: (v: string[]) => void; readonly hint?: string }) {
  const id = useId();
  const [text, setText] = useState('');
  const matches = useMemo(() => {
    const q = text.trim().toUpperCase();
    return q.length < 2 ? [] : options.filter((o) => o.includes(q) && !value.includes(o)).slice(0, 6);
  }, [text, options, value]);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-sans text-[12px] font-medium text-depot-ink">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a registration"
        className="depot-field w-full font-mono text-[12px] text-depot-ink"
        autoComplete="off"
      />
      {matches.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-1">
          {matches.map((m) => (
            <li key={m}>
              <button
                type="button"
                onClick={() => {
                  onChange([...value, m]);
                  setText('');
                }}
                className="os-chip border-depot-line text-depot-prose hover:border-holo-glow/50 hover:text-holo-glow"
              >
                + {m}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {value.map((v) => (
            <li key={v} className="os-chip border-alert-amber/40 text-alert-amber">
              {v}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Make ${v} available again`} className="hover:text-depot-ink">
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hint ? <p className="mt-0.5 font-sans text-[11px] leading-4 text-depot-muted">{hint}</p> : null}
    </div>
  );
}

/** Routes to include; an empty choice means every route. */
export function RouteChecklist({ routes, value, onChange }: { readonly routes: readonly { readonly id: string; readonly label: string }[]; readonly value: readonly string[]; readonly onChange: (v: string[]) => void }) {
  const all = value.length === 0;
  const has = (id: string): boolean => all || value.includes(id);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-sans text-[12px] font-medium text-depot-ink">Routes to include</span>
        <button type="button" onClick={() => onChange([])} className="font-sans text-[11px] text-holo-glow hover:underline" disabled={all}>
          All {routes.length}
        </button>
      </div>
      <ul className="os-scroll max-h-40 space-y-0.5 overflow-y-auto rounded-[4px] border border-depot-line p-1.5">
        {routes.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-[3px] px-1 py-0.5 hover:bg-depot-raised">
              <input
                type="checkbox"
                className="depot-checkbox"
                checked={has(r.id)}
                onChange={(e) => {
                  const current = all ? routes.map((x) => x.id) : [...value];
                  const next = e.target.checked ? [...current, r.id] : current.filter((x) => x !== r.id);
                  onChange(next.length === routes.length || next.length === 0 ? [] : next);
                }}
              />
              <span className="truncate font-mono text-[11.5px] text-depot-ink">{r.id}</span>
              <span className="ml-auto truncate font-sans text-[11px] text-depot-muted">{r.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface CompareRow {
  readonly label: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly format: (v: number) => string;
  /** Which way is an improvement; neutral rows show the change without colour. */
  readonly better: 'lower' | 'higher' | 'neutral';
}

/** Before and after side by side, the change coloured by whether it is an improvement. */
export function CompareTable({ rows, beforeLabel, afterLabel }: { readonly rows: readonly CompareRow[]; readonly beforeLabel: string; readonly afterLabel: string }) {
  return (
    <table className="os-table" data-testid="os-compare-table">
      <thead>
        <tr>
          <th>Measure</th>
          <th className="text-right">{beforeLabel}</th>
          <th className="text-right">{afterLabel}</th>
          <th className="text-right">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const delta = r.before !== null && r.after !== null ? r.after - r.before : null;
          const good = delta === null || delta === 0 || r.better === 'neutral' ? null : (delta < 0) === (r.better === 'lower');
          const Icon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
          return (
            <tr key={r.label} className="border-b border-holo-glow/[0.06]">
              <td className="text-depot-prose">{r.label}</td>
              <td className="os-num text-depot-prose">{r.before === null ? '—' : r.format(r.before)}</td>
              <td className="os-num text-depot-ink">{r.after === null ? '—' : r.format(r.after)}</td>
              <td className={`os-num ${good === null ? 'text-depot-muted' : good ? 'text-alert-green' : 'text-alert-crimson'}`}>
                <span className="inline-flex items-center justify-end gap-0.5">
                  <Icon className="h-3 w-3" aria-hidden />
                  {delta === null || delta === 0 ? '—' : `${signFor(delta)}${r.format(Math.abs(delta))}`}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
