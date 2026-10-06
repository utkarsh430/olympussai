'use client';

import { useState } from 'react';
import { DEFAULT_REBALANCE_PARAMS, DEFAULT_SPARE_RATIO } from '@/lib/depot/optimise/config';
import {
  parseBusDelta,
  parseDistanceKm,
  parseSparePercent,
  parseSurgePercent,
  type ParseResult,
} from '@/lib/depot/rebalance/scenarioParsers';
import {
  withExcluded,
  withFleetAdjustment,
  withLocked,
  withMaxTransferKm,
  withSparePercent,
  withSurge,
  withoutFleetAdjustment,
  withoutSurge,
  type ScenarioFormState,
} from '@/lib/depot/rebalance/scenarioForm';

export interface DepotOption {
  readonly id: string;
  readonly name: string;
}

export interface ScenarioPanelProps {
  readonly form: ScenarioFormState;
  readonly onChange: (next: ScenarioFormState) => void;
  readonly onReset: () => void;
  /** Operating depots, by name. */
  readonly depots: readonly DepotOption[];
  /** `runScenario`'s notes on inputs it had to clamp, shown verbatim. */
  readonly clamped: readonly string[];
}

function NumberField(props: {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly parse: (raw: string) => ParseResult;
  readonly onValue: (value: number | null) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={props.id} className="depot-label">
        {props.label}
      </label>
      <input
        id={props.id}
        type="text"
        inputMode="decimal"
        placeholder={props.placeholder}
        value={text}
        aria-invalid={error !== ''}
        aria-describedby={error ? `${props.id}-error` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') {
            setError('');
            props.onValue(null);
            return;
          }
          const result = props.parse(e.target.value);
          setError(result.ok ? '' : result.error);
          if (result.ok) props.onValue(result.value);
        }}
        className="depot-field w-32"
      />
      {error ? (
        <p id={`${props.id}-error`} className="text-[11px] text-alert-amber">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DepotValue(props: {
  readonly id: string;
  readonly legend: string;
  readonly valueLabel: string;
  readonly placeholder: string;
  readonly depots: readonly DepotOption[];
  readonly parse?: (raw: string) => ParseResult;
  readonly action: string;
  readonly onApply: (depotId: string, value: number) => void;
}) {
  const [depotId, setDepotId] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  function apply(): void {
    if (!depotId) return setError('Choose a depot.');
    const result = props.parse ? props.parse(text) : ({ ok: true, value: 0 } as const);
    if (!result.ok) return setError(result.error);
    setError('');
    setText('');
    props.onApply(depotId, result.value);
  }
  return (
    <fieldset className="flex min-w-0 flex-wrap items-end gap-2">
      <legend className="depot-label mb-1">{props.legend}</legend>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="sr-only">Depot for {props.legend.toLowerCase()}</span>
        <select
          className="depot-field max-w-[220px]"
          value={depotId}
          onChange={(e) => setDepotId(e.target.value)}
        >
          <option value="">Choose a depot</option>
          {props.depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {props.parse ? (
        <label className="flex flex-col gap-1">
          <span className="sr-only">{props.valueLabel}</span>
          <input
            id={props.id}
            type="text"
            placeholder={props.placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="depot-field w-24"
          />
        </label>
      ) : null}
      <button type="button" className="depot-filter-button" onClick={apply}>
        {props.action}
      </button>
      {error ? <p className="w-full text-[11px] text-alert-amber">{error}</p> : null}
    </fieldset>
  );
}

function ActiveList(props: {
  readonly items: readonly { readonly key: string; readonly text: string }[];
  readonly onRemove: (key: string) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {props.items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-2 text-[13px] text-depot-ink">
          <span className="min-w-0 truncate">{item.text}</span>
          <button
            type="button"
            className="depot-link text-[11px]"
            onClick={() => props.onRemove(item.key)}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The what-if form. Every change re-plans in this browser; nothing is sent.
 * Values are passed on as typed: the engine clamps, and says so below.
 */
export function ScenarioPanel({ form, onChange, onReset, depots, clamped }: ScenarioPanelProps) {
  const nameOf = (id: string): string => depots.find((d) => d.id === id)?.name ?? id;
  const signed = (n: number): string => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
  return (
    <section aria-labelledby="rebalance-sandbox-heading" data-testid="rebalance-sandbox">
      <h2 id="rebalance-sandbox-heading" className="depot-section-label">
        What-if sandbox
      </h2>
      <p className="depot-prose mb-3 text-xs">
        Change an assumption and the plan is recomputed here in your browser. Nothing is sent and
        nothing is dispatched.
      </p>
      <form className="depot-panel flex flex-col gap-4 p-4" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-wrap gap-4">
          <NumberField
            id="scenario-spare"
            label="Spare ratio, %"
            placeholder={`${DEFAULT_SPARE_RATIO * 100} (default)`}
            parse={parseSparePercent}
            onValue={(v) => onChange(withSparePercent(form, v))}
          />
          <NumberField
            id="scenario-distance"
            label="Maximum transfer distance, km"
            placeholder={`${DEFAULT_REBALANCE_PARAMS.maxTransferKm} (default)`}
            parse={parseDistanceKm}
            onValue={(v) => onChange(withMaxTransferKm(form, v))}
          />
        </div>
        <DepotValue
          id="scenario-lock"
          legend="Lock a depot (it may receive but never give)"
          valueLabel=""
          placeholder=""
          depots={depots}
          action="Lock"
          onApply={(id) => onChange(withLocked(form, id, true))}
        />
        <ActiveList
          items={form.lockedDepotIds.map((id) => ({ key: id, text: `${nameOf(id)} locked` }))}
          onRemove={(id) => onChange(withLocked(form, id, false))}
        />
        <DepotValue
          id="scenario-exclude"
          legend="Exclude a depot (it neither gives nor receives)"
          valueLabel=""
          placeholder=""
          depots={depots}
          action="Exclude"
          onApply={(id) => onChange(withExcluded(form, id, true))}
        />
        <ActiveList
          items={form.excludedDepotIds.map((id) => ({ key: id, text: `${nameOf(id)} excluded` }))}
          onRemove={(id) => onChange(withExcluded(form, id, false))}
        />
        <DepotValue
          id="scenario-fleet"
          legend="Add or remove buses at a depot"
          valueLabel="Change in buses, such as +12 or -5"
          placeholder="+12 or -5"
          depots={depots}
          parse={parseBusDelta}
          action="Apply"
          onApply={(id, v) => onChange(withFleetAdjustment(form, id, v))}
        />
        <ActiveList
          items={form.fleetAdjustments.map((a) => ({
            key: a.depotId,
            text: `${nameOf(a.depotId)} ${signed(a.deltaBuses)} buses`,
          }))}
          onRemove={(id) => onChange(withoutFleetAdjustment(form, id))}
        />
        <DepotValue
          id="scenario-surge"
          legend="Demand surge at a depot, %"
          valueLabel="Change in peak demand, percent"
          placeholder="+15 or -10"
          depots={depots}
          parse={parseSurgePercent}
          action="Apply"
          onApply={(id, v) => onChange(withSurge(form, id, v))}
        />
        <ActiveList
          items={form.demandSurges.map((s) => ({
            key: s.depotId,
            text: `${nameOf(s.depotId)} demand ${signed(s.percent)}%`,
          }))}
          onRemove={(id) => onChange(withoutSurge(form, id))}
        />
        <div role="status" aria-live="polite">
          {clamped.length ? (
            <div className="border-l-2 border-alert-amber pl-3">
              <p className="depot-label text-alert-amber">Inputs the planner adjusted</p>
              <ul className="mt-1 list-none text-[13px] text-depot-ink">
                {clamped.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div>
          <button type="button" className="hud-button" onClick={onReset}>
            Reset to baseline
          </button>
        </div>
      </form>
    </section>
  );
}
