'use client';

import { useMemo, useState } from 'react';
import { ProposalRationaleButton } from '@/components/depot/copilot/RationaleButton';
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
  hiddenFigures,
  orderProposals,
  proposalColumnKeys,
  proposalGroup,
  proposalRow,
  type ProposalColumnKey,
  type ProposalRow,
} from '@/lib/depot/service/servicePageModel';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import { meaningTextClass } from '@/lib/depot/palette';
import type { Proposal, RouteHourFigures } from '@/lib/depot/service/types';

const TITLE_ID = 'service-proposals';
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

/**
 * The expanded row: the full reason, the peak, the band means the table at this width
 * hides, where the buses come from and what the proposal rests on, then the impact as a
 * 2×2 grid and the net a day (a loss in the worse tone, said in words), and the copilot's
 * explanation of the proposal on request.
 */
function ProposalDetail({ row, shown }: { readonly row: ProposalRow; readonly shown: readonly string[] }) {
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
      <div className="pt-2">
        <ProposalRationaleButton
          proposalId={row.proposal.id}
          routeName={row.proposal.routeName}
          label={`${row.band} ${row.change}`}
        />
      </div>
    </div>
  );
}

export interface ProposalsTableProps {
  readonly proposals: readonly Proposal[];
  /** The route's day, for an add's hourly range. */
  readonly hours?: readonly RouteHourFigures[];
  /** The feed clock's hour, to say when a band is already past; null without a feed clock. */
  readonly currentHour?: number | null;
}

/** The route's proposals: the recommendation notice, the table at this width, the pager. */
export function ProposalsTable({ proposals, hours = [], currentHour = null }: ProposalsTableProps) {
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
    <section aria-labelledby={TITLE_ID} className="min-w-0" data-testid="service-proposals">
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
            renderExpanded={(r) => <ProposalDetail row={r} shown={shownKeys} />}
            group={GROUP}
            multipleExpanded
          />
          <Pager page={range.page} total={rows.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}
