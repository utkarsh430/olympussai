'use client';

import { useMemo } from 'react';
import { BriefingCard } from '@/components/depot/copilot/BriefingCard';
import { useDecisionLog } from '@/components/depot/rebalance/useDecisionLog';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { CopilotApiRequest, CopilotScope } from '@/lib/depot/copilot/wire';
import {
  proposalDecisionCounts,
  proposalDecisionsFor,
} from '@/lib/depot/rebalance/proposalDecisionReducers';
import { decisionCountsSentence } from '@/lib/depot/rebalance/proposalDecisionWording';
import type { Proposal } from '@/lib/depot/service/types';
import { PRINT_BRIEF_ATTR, ServicePrintRule } from './ServicePrintRule';

const TITLE_ID = 'service-daily-brief';
/** The question the copilot's router reads as the daily brief. */
export const BRIEF_QUESTION = 'The daily brief';
const NETWORK: CopilotScope = { kind: 'network' };
/** Module-level, so the card's request body keeps one identity across polls. */
const BRIEF_REQUEST: CopilotApiRequest = { task: 'ask', question: BRIEF_QUESTION, scope: NETWORK };

export interface DailyBriefCardProps {
  /** The date the decisions are counted for; null without a feed date. */
  readonly operatingDate: string | null;
  /** The proposals shown, to count the decisions on them; null where there are none to count. */
  readonly proposals: readonly Pick<Proposal, 'id'>[] | null;
  /** The page's feed time, so the footer can say when the page has moved on. */
  readonly currentFeedTime?: string | null;
}

/** The decisions kept in this browser on the proposals shown; null until one is kept. */
function useDecisionCounts(
  operatingDate: string | null,
  proposals: readonly Pick<Proposal, 'id'>[] | null,
): string | null {
  const { slice } = useDecisionLog();
  return useMemo(() => {
    if (operatingDate === null || proposals === null) return null;
    const book = proposalDecisionsFor(slice.events, operatingDate);
    if (book.size === 0) return null;
    return decisionCountsSentence(proposalDecisionCounts(proposals, book), operatingDate);
  }, [slice.events, operatingDate, proposals]);
}

/**
 * The daily brief at the top of the network's service page: the copilot's written brief
 * of the day (asked for on a press, never on mount, as every briefing is), embedded under
 * the section's own heading, then the count of decisions kept in this browser on the
 * proposals shown. The decisions are counted here, not by the copilot: they never leave
 * this browser. On paper, the brief and the proposals are what the page prints.
 */
export function DailyBriefCard({ operatingDate, proposals, currentFeedTime }: DailyBriefCardProps) {
  const counts = useDecisionCounts(operatingDate, proposals);
  const printMark = { [PRINT_BRIEF_ATTR]: '' };
  return (
    <section
      aria-labelledby={TITLE_ID}
      className="min-w-0"
      data-testid="daily-brief"
      {...printMark}
    >
      <ServicePrintRule />
      <SectionLabel
        id={TITLE_ID}
        label="Daily brief"
        note="Advisory: it describes, it does not instruct"
      />
      <BriefingCard
        scope={NETWORK}
        request={BRIEF_REQUEST}
        title="Daily brief"
        currentFeedTime={currentFeedTime}
        embedded
      />
      {counts ? (
        <p className="depot-note mt-2" data-testid="daily-brief-decisions">
          {counts}
        </p>
      ) : null}
    </section>
  );
}
