'use client';

import { signedWhole } from '@/lib/depot/format';
import type { PlanInForce } from '@/lib/depot/rebalance/fieldsInForce';
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
  /** The server plan's own parameters: the number fields start with them. */
  readonly inForce: PlanInForce;
  readonly depots: readonly DepotOption[];
  /** The optimiser's clamp notes, already in the planner's units and depot names. */
  readonly clampNotes: readonly string[];
}

/** Sign and magnitude of a non-zero whole number; the form drops a zero entry first. */
function signedNonZero(n: number): string {
  return signedWhole(n);
}

/**
 * The what-if form. Every field shows the value in force, with its unit; a committed
 * change re-plans in this browser and nothing is sent. Values pass on as typed: the
 * optimiser clamps, and says so below. The page's one reset is in the what-if line.
 */
export function ScenarioPanel(props: ScenarioPanelProps) {
  const { form, onChange, inForce, depots, clampNotes } = props;
  const nameOf = (id: string): string => depots.find((d) => d.id === id)?.name ?? id;
  const list = (
    items: readonly { key: string; text: string }[],
    remove: (id: string) => Update,
  ) => <ActiveList items={items} onRemove={(id) => onChange(remove(id))} />;
  return (
    <div data-testid="rebalance-sandbox">
      <p className="depot-note mb-3">
        The plan is recomputed once you pause, leave a field or press Enter.
      </p>
      <form className="depot-panel flex flex-col gap-4 p-4" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-wrap gap-4">
          <NumberField
            id="scenario-spare"
            label={FIELD_LABELS.spare}
            inForce={inForce.sparePercent}
            unit="%"
            parse={parseSparePercent}
            onCommit={(v) => onChange((f) => withSparePercent(f, v))}
          />
          <NumberField
            id="scenario-distance"
            label={FIELD_LABELS.distance}
            inForce={inForce.maxTransferKm}
            unit="km"
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
            unit: 'buses',
            inForce: (id) => form.fleetAdjustments.find((a) => a.depotId === id)?.deltaBuses ?? 0,
            parse: parseBusDelta,
            onCommit: (id, v) =>
              onChange((f) =>
                v === 0 ? withoutFleetAdjustment(f, id) : withFleetAdjustment(f, id, v),
              ),
          }}
        />
        {list(
          form.fleetAdjustments.map((a) => ({
            key: a.depotId,
            text: `${nameOf(a.depotId)} ${signedNonZero(a.deltaBuses)} buses`,
          })),
          (id) => (f) => withoutFleetAdjustment(f, id),
        )}
        <DepotValueField
          id="scenario-surge"
          legend="Demand change at a depot"
          depots={depots}
          value={{
            label: FIELD_LABELS.surge,
            unit: '%',
            inForce: (id) => form.demandSurges.find((s) => s.depotId === id)?.percent ?? 0,
            parse: parseSurgePercent,
            onCommit: (id, v) =>
              onChange((f) => (v === 0 ? withoutSurge(f, id) : withSurge(f, id, v))),
          }}
        />
        {list(
          form.demandSurges.map((s) => ({
            key: s.depotId,
            text: `${nameOf(s.depotId)} demand ${signedNonZero(s.percent)}%`,
          })),
          (id) => (f) => withoutSurge(f, id),
        )}
        <div role="status" aria-live="polite">
          {clampNotes.length ? (
            <div className="border-l-2 border-alert-amber pl-3">
              <div className="depot-label text-alert-amber">Inputs the optimiser adjusted</div>
              <ul className="mt-1 list-none text-[13px] text-depot-ink">
                {clampNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}
