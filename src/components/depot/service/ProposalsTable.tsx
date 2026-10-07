'use client';

import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { Notice } from '@/components/depot/shell/Notice';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { TableGrouping } from '@/components/depot/shell/tableGroups';
import { useWidthTier } from '@/components/depot/shell/useWidthTier';
import { pageRange } from '@/lib/depot/listPaging';
import {
  PROPOSAL_COLUMN_WIDTHS,
  PROPOSAL_TIERS,
  hasPastBand,
  orderProposals,
  proposalColumnKeys,
  proposalGroup,
  proposalRow,
  type ProposalColumnKey,
  type ProposalRow,
} from '@/lib/depot/service/servicePageModel';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import type { Proposal, RouteHourFigures } from '@/lib/depot/service/types';
import { ProposalDecisionTrail } from './ProposalDecisionTrail';
import { ProposalDetail } from './ProposalDetail';
import { PRINT_KEEP_ATTR } from './ServicePrintRule';
import { useProposalDecisions, type ProposalDecisions } from './useProposalDecisions';

const TITLE_ID = 'service-proposals';
/** Printed beside the daily brief where the brief is on the page (`ServicePrintRule`). */
const PRINT_MARK = { [PRINT_KEEP_ATTR]: '' };
const W = PROPOSAL_COLUMN_WIDTHS;
/** The band's figures are its hours' means, said once in each header. */
const MEAN = SERVICE_TEXT.bandMean;

const COLUMNS: Readonly<Record<ProposalColumnKey, Column<ProposalRow>>> = {
  // Not sortable: the rows come grouped and in start-hour order, and a sort would split the groups.
  band: { key: 'band', header: 'Hour band', width: W.band, render: (r) => r.band },
  change: { key: 'change', header: 'Change', width: W.change, render: (r) => r.change, title: (r) => r.changeTitle },
  deployed: {
    key: 'deployed',
    header: 'Deployed',
    unit: MEAN,
    align: 'right',
    width: W.deployed,
    render: (r) => r.deployed,
  },
  scheduled: {
    key: 'scheduled',
    header: 'Scheduled',
    unit: MEAN,
    align: 'right',
    width: W.scheduled,
    render: (r) => r.scheduled,
    title: (r) => r.scheduledTitle,
  },
  needed: {
    key: 'needed',
    header: 'Needed',
    unit: MEAN,
    tag: 'modelled',
    align: 'right',
    width: W.needed,
    render: (r) => r.needed,
  },
  source: {
    key: 'source',
    header: 'Source',
    width: W.source,
    // Capped inside the column (its width less the cell's 24px of padding) so a long depot
    // name truncates rather than widening the table past its frame.
    render: (r) => <span className="block max-w-[120px] truncate">{r.source}</span>,
    title: (r) => r.sourceTitle,
  },
  impact: {
    key: 'impact',
    header: 'Impact',
    tag: 'modelled',
    align: 'right',
    width: W.impact,
    render: (r) => r.impact,
    title: (r) => r.impactTitle,
  },
  restsOn: { key: 'restsOn', header: 'Rests on', width: W.restsOn, render: (r) => r.restsOn, title: (r) => r.restsOnTitle },
};

/** Changes (add, hold) first, then the timetable findings, each printed once as a group row. */
const GROUP: TableGrouping<ProposalRow> = { key: (r) => proposalGroup(r.proposal) };

export interface ProposalsTableProps {
  readonly proposals: readonly Proposal[];
  /** The route's day, for an add's hourly range. */
  readonly hours?: readonly RouteHourFigures[];
  /** The feed clock's hour, to say when a band is already past; null without a feed clock. */
  readonly currentHour?: number | null;
  /** The date decisions are recorded under; without it the proposals' own date is used. */
  readonly operatingDate?: string | null;
  /** The route whose decisions the trail lists; null (the default) lists every route's. */
  readonly trailRoute?: string | null;
}

/**
 * The proposals: the recommendation notice, the table at this width, the pager, the status
 * line of the last decision and the trail of decisions kept in this browser. Without a
 * date (no proposals and none given) there is nothing to decide and no trail.
 */
export function ProposalsTable(props: ProposalsTableProps) {
  const date = props.operatingDate ?? props.proposals[0]?.operatingDate ?? null;
  if (date === null) return <ProposalsView {...props} decisions={null} />;
  return <DecidedProposals {...props} operatingDate={date} />;
}

function DecidedProposals(props: ProposalsTableProps & { readonly operatingDate: string }) {
  const decisions = useProposalDecisions(props.operatingDate, props.trailRoute ?? null);
  return <ProposalsView {...props} decisions={decisions} />;
}

function ProposalsView({
  proposals,
  hours = [],
  currentHour = null,
  operatingDate = null,
  decisions,
}: ProposalsTableProps & { readonly decisions: ProposalDecisions | null }) {
  const tier = useWidthTier(PROPOSAL_TIERS);
  const [page, setPage] = useState(0);
  const rows = useMemo(
    () => orderProposals(proposals).map((p) => proposalRow(p, hours)),
    [proposals, hours],
  );
  const shownKeys = proposalColumnKeys(tier);
  const columns = useMemo(() => proposalColumnKeys(tier).map((key) => COLUMNS[key]), [tier]);
  const range = pageRange(page, rows.length);
  return (
    <section
      aria-labelledby={TITLE_ID}
      className="min-w-0"
      data-testid="service-proposals"
      {...PRINT_MARK}
    >
      <SectionLabel id={TITLE_ID} label={SERVICE_TEXT.proposalsTitle} />
      <div className="mb-3">
        <Notice status="info" word="Recommendation only">
          {SERVICE_TEXT.recommendation}
        </Notice>
      </div>
      {rows.length === 0 ? (
        <StatePanel kind="empty" compact tone="ok" sentence={SERVICE_TEXT.noProposals} />
      ) : (
        <>
          {hasPastBand(proposals, currentHour) ? (
            <p className="depot-note mb-2">{SERVICE_TEXT.pastBands}</p>
          ) : null}
          <DataTable
            columns={columns}
            rows={rows.slice(range.start, range.end)}
            rowKey={(r) => r.id}
            rowLabel={(r) => `${r.band} ${r.change}`}
            caption={SERVICE_TEXT.proposalsCaption}
            fixedRows
            renderExpanded={(r) => (
              <ProposalDetail row={r} shown={shownKeys} decisions={decisions} />
            )}
            group={GROUP}
            multipleExpanded
          />
          <div className="print:hidden">
            <Pager page={range.page} total={rows.length} onPage={setPage} />
          </div>
        </>
      )}
      {decisions && operatingDate !== null ? (
        <>
          <p
            role="status"
            data-testid="proposal-status"
            className="depot-prose mt-2 min-h-5 text-[13px] print:hidden"
          >
            {decisions.announcement}
          </p>
          <ProposalDecisionTrail
            items={decisions.trail}
            operatingDate={operatingDate}
            onUndo={decisions.undo}
            capacityNote={decisions.capacityNote}
            stateNote={decisions.stateNote}
            canClear={decisions.canClear}
            onClear={decisions.clear}
          />
        </>
      ) : null}
    </section>
  );
}
