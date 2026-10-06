'use client';

import { useState } from 'react';
import type { ParseResult } from '@/lib/depot/rebalance/scenarioParsers';
import { NumberField } from './NumberField';
import type { DepotOption } from './useDistributionView';

export interface DepotValueFieldProps {
  readonly id: string;
  readonly legend: string;
  readonly depots: readonly DepotOption[];
  /** With a value field, the value commits like every other number field. */
  readonly value?: {
    readonly label: string;
    readonly placeholder: string;
    readonly parse: (raw: string) => ParseResult;
    readonly onCommit: (depotId: string, value: number) => void;
  };
  /** Without a value field, a button applies the choice (lock or exclude). */
  readonly action?: { readonly label: string; readonly onApply: (depotId: string) => void };
}

/** A depot chooser with either a committed number or an apply button. */
export function DepotValueField({ id, legend, depots, value, action }: DepotValueFieldProps) {
  const [depotId, setDepotId] = useState('');
  const [error, setError] = useState('');
  return (
    <fieldset className="flex min-w-0 flex-wrap items-end gap-2">
      <legend className="depot-label mb-1">{legend}</legend>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="sr-only">Depot for {legend.toLowerCase()}</span>
        <select
          className="depot-field max-w-[220px] scroll-mt-40"
          value={depotId}
          onChange={(e) => {
            setDepotId(e.target.value);
            setError('');
          }}
        >
          <option value="">Choose a depot</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {value && depotId ? (
        // Keyed by depot, so choosing another depot starts an empty field.
        <NumberField
          key={depotId}
          id={`${id}-${depotId}`}
          label={value.label}
          placeholder={value.placeholder}
          parse={value.parse}
          onCommit={(v) => {
            if (v !== null) value.onCommit(depotId, v);
          }}
        />
      ) : null}
      {action ? (
        <button
          type="button"
          className="depot-filter-button"
          onClick={() => (depotId ? action.onApply(depotId) : setError('Choose a depot.'))}
        >
          {action.label}
        </button>
      ) : null}
      {error ? <p className="w-full text-[11px] text-alert-amber">{error}</p> : null}
    </fieldset>
  );
}
