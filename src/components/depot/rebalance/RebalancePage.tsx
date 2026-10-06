'use client';

import { useMemo, useState } from 'react';
import {
  EmptyState,
  ErrorPanel,
  LoadingBlock,
  StaleStrip,
} from '@/components/depot/shell/DataStates';
import { useDepotDistribution, type DepotDistributionState } from '@/hooks/useDepotDistribution';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import type { DepotDistributionResponse } from '@/lib/depot/api';
import {
  decisionEvent,
  decisionKindsFor,
  decisionTrail,
  decisionsFor,
  undoEvent,
} from '@/lib/depot/decisions';
import { compareOutcomes, runScenario } from '@/lib/depot/optimise/scenario';
import type { ScenarioOutcome } from '@/lib/depot/optimise/types';
import { mapGeometry } from '@/lib/depot/rebalance/mapGeometry';
import { balanceRows, busesWord, planSummary } from '@/lib/depot/rebalance/rebalanceModel';
import { transferRows, uncoveredRows } from '@/lib/depot/rebalance/transferModel';
import { BASELINE_FORM, isBaseline, toScenario } from '@/lib/depot/rebalance/scenarioForm';
import { effectiveMaxTransferKm, summariseScenario } from '@/lib/depot/rebalance/scenarioSummary';
import { BalanceSummary } from './BalanceSummary';
import { BalanceTable } from './BalanceTable';
import { DecisionTrail, useDecisionLog } from './DecisionTrail';
import { ScenarioCompare } from './ScenarioCompare';
import { ScenarioPanel } from './ScenarioPanel';
import { TransferMap } from './TransferMap';
import { TransferMapLegend } from './TransferMapLegend';
import { TransferTable } from './TransferTable';

const RECOMMENDATION_ONLY = 'Recommendation only. No transfer order is issued.';
const PERCENT = 100;

/** The fleet distribution page: live supply, modelled need, and the plan between them. */
export function RebalancePage() {
  const state = useDepotDistribution();
  if (state.loading) return <LoadingBlock rows={10} label="Loading fleet distribution" />;
  if (!state.data) {
    return (
      <ErrorPanel message={state.error ?? DEPOT_UNAVAILABLE_MESSAGE} onRetry={state.refresh} />
    );
  }
  return <Distribution data={state.data} state={state} />;
}

function Distribution({
  data,
  state,
}: {
  readonly data: DepotDistributionResponse;
  readonly state: DepotDistributionState;
}) {
  const [form, setForm] = useState(BASELINE_FORM);
  const [resetCount, setResetCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const log = useDecisionLog();
  const { balances, operatingDate } = data;

  const scenario = useMemo(() => toScenario(form), [form]);
  const active = !isBaseline(form);
  // Re-planned only when the balances or the scenario change, never on an unrelated render.
  const whatIf = useMemo(
    () => (active ? runScenario(balances, scenario) : null),
    [balances, scenario, active],
  );
  // At the defaults the server's own plan is shown, not a recomputation.
  const baseline: ScenarioOutcome = useMemo(
    () => ({ balances, plan: data.plan, clamped: [] }),
    [balances, data.plan],
  );
  const shown = whatIf ?? baseline;

  const depots = useMemo(
    () =>
      balances
        .filter((b) => b.kind === 'depot')
        .map((b) => ({ id: b.depotId, name: b.depotName }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [balances],
  );
  const nameOf = (id: string): string => depots.find((d) => d.id === id)?.name ?? id;
  const scenarioSummary = active ? summariseScenario(form, nameOf) : null;
  const maxKm = effectiveMaxTransferKm(scenario, data.rebalanceParams.maxTransferKm);

  const book = useMemo(() => decisionsFor(log.events, operatingDate), [log.events, operatingDate]);
  const trail = useMemo(
    () => decisionTrail(log.events, operatingDate),
    [log.events, operatingDate],
  );
  const rows = transferRows(shown.plan, shown.balances, decisionKindsFor(book, scenarioSummary));
  const geometry = useMemo(() => mapGeometry(shown.balances, shown.plan), [shown]);
  const depotRows = useMemo(() => balanceRows(shown.balances), [shown]);
  const summary = planSummary(shown.plan);
  const uncovered = uncoveredRows(shown.plan, shown.balances, maxKm);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function reset(): void {
    setForm(BASELINE_FORM);
    setResetCount((n) => n + 1);
  }

  return (
    <>
      {data.stale || state.error ? <StaleStrip since={data.feedNow} /> : null}
      <div className="mb-4 flex min-w-0 flex-col gap-2">
        <p className="depot-prose max-w-3xl">
          Live: each depot&apos;s fleet, buses off road and buses available come from the latest
          feed snapshot. Modelled: the feed carries no network timetable, so each depot&apos;s
          requirement is modelled by a stated rule (a depot whose buses are more on the road than
          its peers&apos; is assumed stretched, one with many standing buses to have slack) plus a
          spare margin of {Math.round(data.requirementParams.spareRatio * PERCENT * 10) / 10}% of
          peak need, so every transfer below is a modelled recommendation.
        </p>
        {data.source === 'fixture' ? (
          <p className="depot-prose max-w-3xl text-alert-amber">
            This is the sample fixture, about three buses per depot: the sample is too small for
            these figures to mean anything.
          </p>
        ) : null}
      </div>

      <div
        data-testid="rebalance-notice"
        className="sticky top-14 z-30 mb-6 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 border-y border-alert-amber/50 bg-depot-page py-2"
      >
        <p className="font-mono text-[13px] text-alert-amber">{RECOMMENDATION_ONLY}</p>
        {scenarioSummary ? (
          <>
            <p role="status" className="min-w-0 text-[13px] text-depot-ink">
              What-if scenario showing, not the modelled plan: {scenarioSummary}
            </p>
            <button type="button" className="depot-link text-[11px]" onClick={reset}>
              Reset to baseline
            </button>
          </>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-8">
        <BalanceSummary summary={summary} scenarioActive={active} />
        {whatIf ? (
          <ScenarioCompare
            delta={compareOutcomes(baseline, whatIf)}
            baseline={planSummary(baseline.plan)}
            scenario={summary}
          />
        ) : null}

        <section aria-labelledby="rebalance-map-heading" className="min-w-0">
          <h2 id="rebalance-map-heading" className="depot-section-label">
            Recommended transfers
          </h2>
          <TransferMap
            geometry={geometry}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />
          <div className="mt-3">
            <TransferMapLegend maxBuses={rows.reduce((m, r) => Math.max(m, r.buses), 0)} />
          </div>
          <p role="status" className="depot-prose mb-2 mt-4 text-xs">
            {selected
              ? `Selected: ${busesWord(selected.buses)} from ${selected.fromName} to ${selected.toName}. Its line and both depots are highlighted on the map.`
              : 'Select a transfer to highlight it on the map.'}
          </p>
          {rows.length ? (
            <TransferTable
              rows={rows}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onDecide={(row, decision, note) =>
                log.record(
                  decisionEvent({
                    transferId: row.id,
                    fromDepotId: row.fromDepotId,
                    fromDepotName: row.fromName,
                    toDepotId: row.toDepotId,
                    toDepotName: row.toName,
                    buses: row.buses,
                    operatingDate,
                    scenario: scenarioSummary,
                    note,
                    decision,
                  }),
                )
              }
            />
          ) : (
            <EmptyState>
              {summary.before.totalDeficit === 0
                ? 'No transfers are recommended: no depot is short of buses on the modelled requirement.'
                : 'No transfers are possible: no depot short of buses can be reached from one with spare buses. The shortfall is listed below.'}
            </EmptyState>
          )}
        </section>

        <BalanceTable rows={depotRows} />

        <section aria-labelledby="rebalance-uncovered-heading">
          <h2 id="rebalance-uncovered-heading" className="depot-section-label">
            Shortfall the plan cannot cover
          </h2>
          {uncovered.length ? (
            <ul className="depot-prose flex flex-col gap-1">
              {uncovered.map((u) => (
                <li key={u.depotId}>{u.sentence}</li>
              ))}
            </ul>
          ) : (
            <p className="depot-prose">
              Every modelled shortfall is covered by the transfers above.
            </p>
          )}
        </section>

        <ScenarioPanel
          key={resetCount}
          form={form}
          onChange={setForm}
          onReset={reset}
          depots={depots}
          clamped={shown.clamped}
        />
        <DecisionTrail
          trail={trail}
          operatingDate={operatingDate}
          onUndo={(item) => log.record(undoEvent(item))}
        />
      </div>
    </>
  );
}
