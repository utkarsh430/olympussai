'use client';

import { useEffect, useRef, useState } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { ErrorPanel, LoadingBlock, StaleStrip } from '@/components/depot/shell/DataStates';
import { useDepotDistribution, type DepotDistributionState } from '@/hooks/useDepotDistribution';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';
import type { DepotDistributionResponse } from '@/lib/depot/api';
import { decisionEvent, undoEvent, type TrailItem } from '@/lib/depot/rebalance/decisionEvents';
import { isRepeatDecision, undoableFor } from '@/lib/depot/rebalance/decisionReducers';
import { trailCapacityNote } from '@/lib/depot/rebalance/decisionStore';
import { decisionAnnouncement, undoAnnouncement } from '@/lib/depot/rebalance/decisionWording';
import { busesWord, type TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import { serverInForce } from '@/lib/depot/rebalance/fieldsInForce';
import { BASELINE_FORM } from '@/lib/depot/rebalance/scenarioForm';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';
import { BalanceSummary } from './BalanceSummary';
import { BalanceTable } from './BalanceTable';
import { DecisionTrail } from './DecisionTrail';
import { CollapsedSection } from '@/components/depot/shell/CollapsedSection';
import { RecommendationNotice, WhatIfStrip } from './PageIntro';
import { RebalanceMethod } from './RebalanceMethod';
import { ScenarioCompare } from './ScenarioCompare';
import { ScenarioPanel } from './ScenarioPanel';
import { TransferMap } from './TransferMap';
import { TransferMapLegend } from './TransferMapLegend';
import { TransferSection } from './TransferSection';
import { useDecisionLog } from './useDecisionLog';
import { useDistributionView } from './useDistributionView';

export const RESET_ANNOUNCEMENT = 'Reset to the server plan';
const STORAGE_REFUSED =
  'The decision could not be recorded: this browser refused to store it, and no audit event exists.';

const UNDO_REFUSED =
  'The undo could not be recorded: this browser refused to store it, and no audit event exists.';

/** The fleet distribution page: live supply, modelled need, and the plan between them. */
export function RebalancePage() {
  const state = useDepotDistribution();
  if (state.loading) return <LoadingBlock rows={10} label="Loading fleet distribution" />;
  if (!state.data) {
    return (
      <ErrorPanel
        title="Could not load rebalancing"
        message={state.error ?? DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={state.refresh}
      />
    );
  }
  return <Distribution data={state.data} state={state} />;
}

export function Distribution({
  data,
  state,
}: {
  readonly data: DepotDistributionResponse;
  readonly state: Pick<DepotDistributionState, 'error'>;
}) {
  const [form, setForm] = useState(BASELINE_FORM);
  const [resetCount, setResetCount] = useState(0);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const log = useDecisionLog();
  const view = useDistributionView(data, form, log.slice.events);
  const selected = view.rows.find((r) => r.id === selectedId) ?? null;

  // The sandbox remounts on reset (its fields hold typed text), so focus is put back here.
  useEffect(() => {
    if (resetCount > 0) headingRef.current?.focus();
  }, [resetCount]);

  function reset(): void {
    setForm(BASELINE_FORM);
    setSandboxOpen(true);
    setResetCount((n) => n + 1);
    setAnnouncement(RESET_ANNOUNCEMENT);
  }

  function decide(row: TransferRow, kind: TransferDecisionKind, note: string): void {
    if (isRepeatDecision(row.decision, kind, row.buses)) return;
    const recorded = log.record(
      decisionEvent({
        transferId: row.id,
        fromDepotId: row.fromDepotId,
        fromDepotName: row.fromName,
        toDepotId: row.toDepotId,
        toDepotName: row.toName,
        buses: row.buses,
        operatingDate: data.operatingDate,
        scenario: view.key,
        scenarioLabel: view.sentence,
        note,
        decision: kind,
      }),
    );
    const said = decisionAnnouncement(kind, row.buses, row.fromName, row.toName);
    setAnnouncement(recorded ? said : STORAGE_REFUSED);
  }

  function undo(item: TrailItem): void {
    const recorded = log.record(undoEvent(item));
    const said = undoAnnouncement(item.decision, item.buses, item.fromDepotName, item.toDepotName);
    setAnnouncement(recorded ? said : UNDO_REFUSED);
  }

  function undoFor(row: TransferRow): (() => void) | null {
    const item = undoableFor(view.trail, row.id, view.key);
    return item ? () => undo(item) : null;
  }

  const maxBuses = view.rows.reduce((m, r) => Math.max(m, r.buses), 0);
  return (
    <div className="flex min-w-0 flex-col">
      {data.stale || state.error ? <StaleStrip since={data.feedNow} /> : null}
      <RecommendationNotice fixture={data.source === 'fixture'} />
      <WhatIfStrip sentence={view.sentence} onReset={reset} />
      <BalanceSummary summary={view.summary} scenarioActive={view.key !== null} />
      {view.delta ? (
        <ScenarioCompare delta={view.delta} baseline={view.baselineSummary} scenario={view.summary} />
      ) : null}
      <section aria-labelledby="rebalance-map-heading" className="mb-8 min-w-0">
        <SectionLabel
          id="rebalance-map-heading"
          label="Recommended transfers"
          count={view.rows.length}
          tag="modelled"
          note="Largest first; select one to see why and to decide"
        />
        <div className="flex min-w-0 flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] xl:items-start">
          <div className="order-1 min-w-0 xl:order-2">
            <TransferSection
              view={view}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onDecide={decide}
              undoFor={undoFor}
            />
            <p
              role="status"
              data-testid="rebalance-status"
              className="depot-prose mt-2 min-h-5 text-[13px]"
            >
              {announcement}
            </p>
          </div>
          <div className="order-2 min-w-0 xl:order-1">
            <TransferMap
              geometry={view.geometry}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
            <p role="status" className="depot-prose mt-2 min-h-4 text-xs">
              {selected
                ? `Selected: ${busesWord(selected.buses)} from ${selected.fromName} to ${selected.toName}. Its line and both depots are highlighted on the map.`
                : ''}
            </p>
            <div className="mt-3">
              <TransferMapLegend maxBuses={maxBuses} />
            </div>
          </div>
        </div>
      </section>
      <div className="flex min-w-0 flex-col gap-8">
        <CollapsedSection
          label="What-if sandbox"
          note="Recomputed in this browser; nothing is sent"
          open={sandboxOpen}
          onToggle={setSandboxOpen}
          headingId="rebalance-sandbox-heading"
          headingRef={headingRef}
          keepMounted
        >
          <ScenarioPanel
            key={resetCount}
            form={form}
            onChange={(update) => setForm((current) => update(current))}
            inForce={serverInForce(data)}
            depots={view.depots}
            clampNotes={view.clampNotes}
          />
        </CollapsedSection>
        <BalanceTable rows={view.depotRows} />
        <DecisionTrail
          trail={view.trail}
          operatingDate={data.operatingDate}
          onUndo={undo}
          capacityNote={trailCapacityNote(log.slice)}
        />
        <RebalanceMethod spareRatio={data.requirementParams.spareRatio} />
      </div>
    </div>
  );
}
