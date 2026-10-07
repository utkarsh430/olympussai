'use client';

import { ProposalRationaleButton } from '@/components/depot/copilot/RationaleButton';
import { meaningTextClass } from '@/lib/depot/palette';
import { hiddenFigures, type ProposalRow } from '@/lib/depot/service/servicePageModel';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import { ProposalDecisionControls } from './ProposalDecisionControls';
import type { ProposalDecisions } from './useProposalDecisions';

export interface ProposalDetailProps {
  readonly row: ProposalRow;
  /** The column keys the table shows at this width; the others are said here. */
  readonly shown: readonly string[];
  /** The decisions kept in this browser; null where the table records none. */
  readonly decisions: ProposalDecisions | null;
}

/**
 * The expanded row: the full reason, the peak, the band means the table at this width
 * hides, where the buses come from and what the proposal rests on, then the impact as a
 * 2×2 grid and the net a day (a loss in the worse tone, said in words), the copilot's
 * explanation of the proposal on request, and the decision on it.
 */
export function ProposalDetail({ row, shown, decisions }: ProposalDetailProps) {
  const figures = hiddenFigures(row, shown);
  const lines = [
    ...(row.peak ? [row.peak] : []),
    ...(figures ? [figures] : []),
    row.sourceTitle,
    row.restsOnTitle,
    ...(row.maybeCovered ? [SERVICE_TEXT.maybeCovered] : []),
  ];
  return (
    <div className="space-y-1 py-2" data-testid="proposal-detail">
      <p className="depot-prose">{row.reason}</p>
      {lines.map((line) => (
        <p key={line} className="depot-note">{line}</p>
      ))}
      {row.impactPairs.length > 0 ? (
        <>
          <dl
            className="depot-note grid w-fit grid-cols-[max-content_auto] gap-x-4 gap-y-0.5 pt-1 sm:grid-cols-[max-content_auto_max-content_auto]"
            aria-label="Modelled impact ranges"
          >
            {row.impactPairs.map(([label, value]) => (
              <div key={label} className="contents">
                <dt>{label}</dt>
                <dd className="tabular-nums text-depot-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {row.net ? (
            <p className={`depot-note ${row.net.loss ? meaningTextClass('worse') : 'text-depot-ink'}`}>
              {row.net.text}
            </p>
          ) : null}
        </>
      ) : (
        <p className="depot-note">{SERVICE_TEXT.noImpact}</p>
      )}
      <div className="pt-2 print:hidden">
        <ProposalRationaleButton
          proposalId={row.proposal.id}
          routeName={row.proposal.routeName}
          label={`${row.band} ${row.change}`}
        />
      </div>
      {decisions ? (
        <div className="pt-3">
          <ProposalDecisionControls
            proposal={row.proposal}
            label={`${row.proposal.routeName} ${row.band} ${row.change}`}
            decision={decisions.book.get(row.proposal.id) ?? null}
            onDecide={decisions.decide}
            onUndo={decisions.undoFor(row.proposal.id)}
          />
        </div>
      ) : null}
    </div>
  );
}

