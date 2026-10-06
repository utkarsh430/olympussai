'use client';

import { DEFAULT_REBALANCE_PARAMS, DEFAULT_SPARE_RATIO } from '@/lib/depot/optimise/config';
import { FIELD_LABELS } from '@/lib/depot/rebalance/scenarioFields';
import {
  parseBusDelta,
  parseDistanceKm,
  parseSparePercent,
  parseSurgePercent,
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
import { ActiveList } from './ActiveList';
import { DepotValueField } from './DepotValueField';
import { NumberField } from './NumberField';
import type { DepotOption } from './useDistributionView';

type Update = (form: ScenarioFormState) => ScenarioFormState;

export interface ScenarioPanelProps {
  readonly form: ScenarioFormState;
  /** Receives a function so a late commit always builds on the latest form. */
  readonly onChange: (update: Update) => void;
  readonly onReset: () => void;
  readonly depots: readonly DepotOption[];
  /** The optimiser's clamp notes, already in the planner's units and depot names. */
  readonly clampNotes: readonly string[];
}

const PERCENT = 100;

function signed(n: number): string {
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/**
 * The what-if form. A committed change re-plans in this browser; nothing is
 * sent. Values pass on as typed: the optimiser clamps, and says so below.
 */
export function ScenarioPanel(props: ScenarioPanelProps) {
  const { form, onChange, onReset, depots, clampNotes } = props;
  const nameOf = (id: string): string => depots.find((d) => d.id === id)?.name ?? id;
  const list = (
    items: readonly { key: string; text: string }[],
    remove: (id: string) => Update,
  ) => <ActiveList items={items} onRemove={(id) => onChange(remove(id))} />;
  return (
    <div data-testid="rebalance-sandbox">
      <p className="depot-prose mb-3 text-xs">
        Change an assumption and the plan is recomputed here in your browser once you pause, leave
        the field or press Enter. Nothing is sent and nothing is dispatched.
      </p>
      <form className="depot-panel flex flex-col gap-4 p-4" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-wrap gap-4">
          <NumberField
            id="scenario-spare"
            label={FIELD_LABELS.spare}
            placeholder={`${DEFAULT_SPARE_RATIO * PERCENT} (default)`}
            parse={parseSparePercent}
            onCommit={(v) => onChange((f) => withSparePercent(f, v))}
          />
          <NumberField
            id="scenario-distance"
            label={FIELD_LABELS.distance}
            placeholder={`${DEFAULT_REBALANCE_PARAMS.maxTransferKm} (default)`}
            parse={parseDistanceKm}
            onCommit={(v) => onChange((f) => withMaxTransferKm(f, v))}
          />
        </div>
        <DepotValueField
          id="scenario-lock"
          legend="Lock a depot (it may receive but never give)"
          depots={depots}
          action={{ label: 'Lock', onApply: (id) => onChange((f) => withLocked(f, id, true)) }}
        />
        {list(
          form.lockedDepotIds.map((id) => ({ key: id, text: `${nameOf(id)} locked` })),
          (id) => (f) => withLocked(f, id, false),
        )}
        <DepotValueField
          id="scenario-exclude"
          legend="Exclude a depot (it neither gives nor receives)"
          depots={depots}
          action={{ label: 'Exclude', onApply: (id) => onChange((f) => withExcluded(f, id, true)) }}
        />
        {list(
          form.excludedDepotIds.map((id) => ({ key: id, text: `${nameOf(id)} excluded` })),
          (id) => (f) => withExcluded(f, id, false),
        )}
        <DepotValueField
          id="scenario-fleet"
          legend="Add or remove buses at a depot"
          depots={depots}
          value={{
            label: FIELD_LABELS.fleet,
            placeholder: '+12 or -5',
            parse: parseBusDelta,
            onCommit: (id, v) => onChange((f) => withFleetAdjustment(f, id, v)),
          }}
        />
        {list(
          form.fleetAdjustments.map((a) => ({
            key: a.depotId,
            text: `${nameOf(a.depotId)} ${signed(a.deltaBuses)} buses`,
          })),
          (id) => (f) => withoutFleetAdjustment(f, id),
        )}
        <DepotValueField
          id="scenario-surge"
          legend="Demand change at a depot"
          depots={depots}
          value={{
            label: FIELD_LABELS.surge,
            placeholder: '+15 or -10',
            parse: parseSurgePercent,
            onCommit: (id, v) => onChange((f) => withSurge(f, id, v)),
          }}
        />
        {list(
          form.demandSurges.map((s) => ({
            key: s.depotId,
            text: `${nameOf(s.depotId)} demand ${signed(s.percent)}%`,
          })),
          (id) => (f) => withoutSurge(f, id),
        )}
        <div role="status" aria-live="polite">
          {clampNotes.length ? (
            <div className="border-l-2 border-alert-amber pl-3">
              <p className="depot-label text-alert-amber">Inputs the optimiser adjusted</p>
              <ul className="mt-1 list-none text-[13px] text-depot-ink">
                {clampNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div>
          <button type="button" className="hud-button" onClick={onReset}>
            Reset to the server plan
          </button>
        </div>
      </form>
    </div>
  );
}
