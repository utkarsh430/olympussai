'use client';

import { useId, useState, type ReactNode } from 'react';
import {
  RationalePanel,
  RationaleToggle,
  useRationale,
} from '@/components/depot/copilot/RationaleButton';
import { formatCount } from '@/lib/depot/format';
import { samePlaceNote } from '@/lib/depot/rebalance/pageLayout';
import { decisionStatusText } from '@/lib/depot/rebalance/decisionWording';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import { spareBeforeAfter } from '@/lib/depot/rebalance/transferColumns';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';
import { TransferDecisionControls } from './TransferDecisionControls';

export interface TransferRowViewProps {
  readonly row: TransferRow;
  readonly selected: boolean;
  readonly onSelect: (transferId: string | null) => void;
  /** Records a decision; it changes nothing but the record. */
  readonly onDecide: (row: TransferRow, decision: TransferDecisionKind, note: string) => void;
  /** Only rows of the server's own plan have a written rationale. */
  readonly withRationale: boolean;
  /** Columns in the table, so the "Why?" row spans all of them. */
  readonly columns: number;
}

/** A full-width row under a transfer: it may wrap, unlike the 36px data rows. */
const DETAIL_CELL = '!h-auto !max-w-none !whitespace-normal !py-3';

/** One transfer: its data row and, once "Why?" is open, a full-width "Why?" row. */
export function TransferRowView(props: TransferRowViewProps) {
  return props.withRationale ? <RationaleRows {...props} /> : <PlainRows {...props} />;
}

/** The server plan: "Why?" also asks for the written rationale. */
function RationaleRows(props: TransferRowViewProps) {
  const { row } = props;
  const rationale = useRationale(row.id, row.buses);
  return (
    <Rows
      {...props}
      expanded={rationale.expanded}
      toggle={
        <RationaleToggle
          expanded={rationale.expanded}
          onToggle={rationale.toggle}
          panelId={rationale.panelId}
          label={`${row.fromName} to ${row.toName}`}
          status={rationale.status}
        />
      }
      rationale={
        <RationalePanel
          id={rationale.panelId}
          expanded={rationale.expanded}
          state={rationale.state}
          onRetry={rationale.retry}
        />
      }
      detailId={undefined}
    />
  );
}

/** A what-if: "Why?" opens the figures and the decision, with no written rationale. */
function PlainRows(props: TransferRowViewProps) {
  const { row } = props;
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  return (
    <Rows
      {...props}
      expanded={expanded}
      toggle={
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={expanded ? detailId : undefined}
          aria-label={`Why? ${row.fromName} to ${row.toName}`}
          className="hud-button px-2 py-0.5"
        >
          Why?
        </button>
      }
      rationale={null}
      detailId={detailId}
    />
  );
}

function Rows(
  props: TransferRowViewProps & {
    readonly expanded: boolean;
    readonly toggle: ReactNode;
    readonly rationale: ReactNode;
    readonly detailId: string | undefined;
  },
) {
  const { row, selected, onSelect, onDecide, columns, expanded, toggle, rationale } = props;
  const samePlace = samePlaceNote(row);
  const status = decisionStatusText(row.decision, row.buses);
  return (
    <>
      <tr className={selected ? 'depot-row-selected' : undefined} title={samePlace ?? undefined}>
        <td>
          <button
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : row.id)}
            className="depot-link block max-w-full truncate text-left"
            title={`${row.fromName} to ${row.toName}`}
          >
            {row.fromName} → {row.toName}
          </button>
        </td>
        <td className="depot-align-right">{formatCount(row.buses)}</td>
        <td className="depot-align-right" title={samePlace ?? undefined}>
          {row.distanceKm.toFixed(1)}
        </td>
        <td className="depot-align-right">{row.busKm.toFixed(1)}</td>
        <td title={status}>{status}</td>
        <td>{toggle}</td>
      </tr>
      {expanded ? (
        <tr data-testid={`transfer-detail-${row.id}`}>
          <td colSpan={columns} className={DETAIL_CELL}>
            <div id={props.detailId} className="max-w-[62ch]">
              {samePlace ? <p className="depot-prose mb-2 text-[13px]">{samePlace}</p> : null}
              <p className="depot-prose mb-2 text-[13px]" data-testid="transfer-spare">
                {spareBeforeAfter(row)}
              </p>
            </div>
            {rationale}
            <TransferDecisionControls row={row} onDecide={onDecide} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
