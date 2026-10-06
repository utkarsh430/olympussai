'use client';

import { useMemo } from 'react';
import type { DepotDistributionResponse } from '@/lib/depot/api';
import type { AuditEvent } from '@/lib/audit/auditLog';
import type { DecisionTrail } from '@/lib/depot/rebalance/decisionEvents';
import {
  decisionTrail,
  decisionsFor,
  rowDecisionsFor,
} from '@/lib/depot/rebalance/decisionReducers';
import { compareOutcomes, runScenario } from '@/lib/depot/optimise/scenario';
import type { ScenarioDelta, ScenarioOutcome } from '@/lib/depot/optimise/types';
import { mapGeometry, type MapGeometry } from '@/lib/depot/rebalance/mapGeometry';
import {
  balanceRows,
  planSummary,
  type BalanceRow,
  type PlanSummary,
} from '@/lib/depot/rebalance/rebalanceModel';
import { describeClamp } from '@/lib/depot/rebalance/scenarioFields';
import {
  isBaseline,
  scenarioKey,
  toScenario,
  type ScenarioFormState,
} from '@/lib/depot/rebalance/scenarioForm';
import { effectiveMaxTransferKm, summariseScenario } from '@/lib/depot/rebalance/scenarioSummary';
import {
  transferRows,
  uncoveredRows,
  type TransferRow,
  type UncoveredRow,
} from '@/lib/depot/rebalance/transferModel';

export interface DepotOption {
  readonly id: string;
  readonly name: string;
}

export interface DistributionView {
  readonly depots: readonly DepotOption[];
  /** Null on the server plan; otherwise the scenario's identity and its sentence. */
  readonly key: string | null;
  readonly sentence: string | null;
  readonly baselineSummary: PlanSummary;
  readonly summary: PlanSummary;
  readonly delta: ScenarioDelta | null;
  readonly rows: readonly TransferRow[];
  readonly geometry: MapGeometry;
  readonly depotRows: readonly BalanceRow[];
  readonly uncovered: readonly UncoveredRow[];
  readonly clampNotes: readonly string[];
  readonly trail: DecisionTrail;
}

/**
 * Everything the page renders, derived from the server response, the
 * committed form and the stored decisions. At the defaults the server's own
 * plan is shown; only a changed form re-plans, and only when it changes.
 */
export function useDistributionView(
  data: DepotDistributionResponse,
  form: ScenarioFormState,
  events: readonly AuditEvent[],
): DistributionView {
  const { balances, operatingDate } = data;
  const scenario = useMemo(() => toScenario(form), [form]);
  const active = !isBaseline(form);
  const whatIf = useMemo(
    () => (active ? runScenario(balances, scenario) : null),
    [balances, scenario, active],
  );
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
  const names = useMemo(() => new Map(depots.map((d) => [d.id, d.name])), [depots]);
  const nameOf = (id: string): string => names.get(id) ?? id;
  const key = scenarioKey(form);
  const book = useMemo(() => decisionsFor(events, operatingDate), [events, operatingDate]);
  const trail = useMemo(() => decisionTrail(events, operatingDate), [events, operatingDate]);
  const geometry = useMemo(() => mapGeometry(shown.balances, shown.plan), [shown]);
  const depotRows = useMemo(() => balanceRows(shown.balances), [shown]);
  const maxKm = effectiveMaxTransferKm(scenario, data.rebalanceParams.maxTransferKm);
  return {
    depots,
    key,
    sentence: active ? summariseScenario(form, nameOf) : null,
    baselineSummary: planSummary(baseline.plan),
    summary: planSummary(shown.plan),
    delta: whatIf ? compareOutcomes(baseline, whatIf) : null,
    rows: transferRows(shown.plan, shown.balances, rowDecisionsFor(book, key)),
    geometry,
    depotRows,
    uncovered: uncoveredRows(shown.plan, shown.balances, maxKm),
    clampNotes: shown.clamped.map((note) => describeClamp(note, nameOf)),
    trail,
  };
}
